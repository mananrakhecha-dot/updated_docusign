import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { query } from '../../db/pool';
import { readFile, saveFile, computeSHA256 } from '../storage';
import { decryptPrivateKey } from '../../ca/certIssuer';
import { embedSignatureIntoPDF } from './pdfSigner';
import { logEvent } from '../audit/auditService';
import { emailQueue, cocQueue } from '../../jobs/queues';
import { AppError } from '../../middleware/errorHandler';
import { getIntermediateCA } from '../../ca/caStore';

interface SigningTokenPayload {
  envelopeId: string;
  recipientId: string;
  email: string;
}

export function decodeSigningToken(token: string): SigningTokenPayload {
  try {
    return jwt.verify(token, process.env.SIGNING_LINK_SECRET!) as SigningTokenPayload;
  } catch {
    throw new AppError('Invalid or expired signing link', 401);
  }
}

export async function getSigningContext(token: string, ipAddress: string, userAgent: string): Promise<any> {
  const payload = decodeSigningToken(token);

  const { rows: recipients } = await query<any>(
    `SELECT er.*, e.subject, e.message, e.status as envelope_status, e.sender_id
     FROM envelope_recipients er
     JOIN envelopes e ON er.envelope_id=e.id
     WHERE er.id=$1 AND e.id=$2`,
    [payload.recipientId, payload.envelopeId]
  );

  if (!recipients[0]) throw new AppError('Signing session not found', 404);
  const recipient = recipients[0];

  if (recipient.envelope_status === 'VOIDED') throw new AppError('This envelope has been voided', 410);
  if (recipient.status === 'SIGNED') throw new AppError('You have already signed this document', 409);
  if (recipient.status === 'DECLINED') throw new AppError('You have declined this document', 410);

  // Check identity gate
  const { rows: users } = await query<any>(
    'SELECT identity_level, edisclosure_accepted, cert_pem FROM users WHERE email=$1',
    [payload.email]
  );
  const userRecord = users[0];

  // Mark as viewed
  if (!recipient.viewed_at) {
    await query(
      'UPDATE envelope_recipients SET viewed_at=now(), ip_address=$1, user_agent=$2 WHERE id=$3',
      [ipAddress, userAgent, recipient.id]
    );
    await logEvent({
      envelopeId: payload.envelopeId,
      recipientEmail: payload.email,
      eventType: 'signing_link_opened',
      ipAddress,
      userAgent,
    });
    await checkAndUpdateDelivered(payload.envelopeId);
  }

  // Get document + fields
  const { rows: docs } = await query<any>(
    'SELECT * FROM envelope_documents WHERE envelope_id=$1',
    [payload.envelopeId]
  );
  const { rows: fields } = await query<any>(
    `SELECT sf.*, er.user_email FROM signature_fields sf
     JOIN envelope_recipients er ON sf.recipient_id=er.id
     WHERE er.id=$1`,
    [payload.recipientId]
  );

  return {
    recipient,
    envelope: { id: payload.envelopeId, subject: recipient.subject },
    userRecord,
    documents: docs,
    fields,
    identityGate: {
      required: recipient.auth_required,
      current: userRecord?.identity_level || 'NONE',
      canSign: canSign(userRecord?.identity_level, recipient.auth_required),
    },
  };
}

function canSign(currentLevel: string, required: string): boolean {
  const levels = { NONE: 0, SES: 1, AES: 2 };
  return (levels[currentLevel as keyof typeof levels] || 0) >= (levels[required as keyof typeof levels] || 0);
}

export async function completeSigningCeremony(
  token: string,
  signatureDataMap: Record<string, string>, // fieldId -> base64 signature PNG
  ipAddress: string,
  userAgent: string,
  otpCode?: string,
  signingIp?: string
): Promise<void> {
  const payload = decodeSigningToken(token);

  // Capture signing IP before any other logic
  const capturedIp = signingIp || ipAddress || 'unknown';

  const { rows: recipients } = await query<any>(
    `SELECT er.*, e.subject, e.status as envelope_status
     FROM envelope_recipients er
     JOIN envelopes e ON er.envelope_id=e.id
     WHERE er.id=$1`,
    [payload.recipientId]
  );

  if (!recipients[0]) throw new AppError('Recipient not found', 404);
  const recipient = recipients[0];

  if (recipient.status === 'SIGNED') throw new AppError('Already signed', 409);
  if (recipient.envelope_status === 'VOIDED') throw new AppError('Envelope voided', 410);

  // Step 1 — Verify identity
  const { rows: users } = await query<any>(
    'SELECT * FROM users WHERE email=$1',
    [payload.email]
  );
  const user = users[0];

  if (!canSign(user?.identity_level, recipient.auth_required)) {
    throw new AppError(`Identity level ${recipient.auth_required} required to sign`, 403);
  }

  if (!user?.edisclosure_accepted) {
    throw new AppError('eDisclosure consent required before signing', 403);
  }

  // AES requires OTP re-verification
  if (recipient.auth_required === 'AES' && otpCode) {
    const { verifyOTP } = await import('../auth/otpService');
    await verifyOTP(user.id, otpCode);
    await logEvent({ envelopeId: payload.envelopeId, recipientEmail: payload.email, eventType: 'otp_verified', ipAddress });
  }

  // Step 2 — Compute document hash
  const { rows: docs } = await query<any>(
    'SELECT * FROM envelope_documents WHERE envelope_id=$1',
    [payload.envelopeId]
  );
  if (!docs[0]) throw new AppError('Document not found', 404);

  const docBuffer = readFile(docs[0].file_path, true);
  const preSignHash = computeSHA256(docBuffer);

  // Tamper check
  if (preSignHash !== docs[0].sha256_hash) {
    await query("UPDATE envelopes SET status='TAMPERED' WHERE id=$1", [payload.envelopeId]);
    await logEvent({ envelopeId: payload.envelopeId, eventType: 'envelope_voided', metadata: { reason: 'TAMPERED' } });
    throw new AppError('Document has been tampered with. Signing blocked.', 409);
  }

  await logEvent({
    envelopeId: payload.envelopeId,
    recipientEmail: payload.email,
    eventType: 'pre_sign_hash',
    metadata: { hash: preSignHash },
  });

  // Step 3 — Get recipient's cert + key
  if (!user?.cert_pem || !user?.encrypted_private_key) {
    throw new AppError('Signer certificate not found. Please complete identity verification.', 403);
  }
  const privateKeyPem = decryptPrivateKey(user.encrypted_private_key);

  // Step 4 — Get fields for this recipient
  const { rows: signatureFields } = await query<any>(
    `SELECT sf.* FROM signature_fields sf
     JOIN envelope_documents ed ON sf.envelope_document_id=ed.id
     WHERE ed.envelope_id=$1 AND sf.recipient_id=$2`,
    [payload.envelopeId, payload.recipientId]
  );

  const orgName = process.env.CA_ORG_NAME || 'MyOrg Digital Signing CA';
  const intCA = getIntermediateCA();

  const fieldsForEmbed = signatureFields.map((f: any) => ({
    pageNumber: f.page_number,
    x: parseFloat(f.x),
    y: parseFloat(f.y),
    width: parseFloat(f.width),
    height: parseFloat(f.height),
    fieldType: f.field_type,
    signatureData: signatureDataMap[f.id],
    value: signatureDataMap[f.id],
  }));

  // Step 4 — Embed into PDF
  const signedPdfBuffer = await embedSignatureIntoPDF(
    docBuffer,
    user.cert_pem,
    privateKeyPem,
    fieldsForEmbed,
    {
      signerName: user.full_name,
      signerEmail: user.email,
      caName: intCA.cert.subject.getField('CN')?.value || orgName,
      timestamp: new Date(),
      reason: 'I approve this document',
    }
  );

  // Save updated PDF (overwrite encrypted)
  const newHash = computeSHA256(signedPdfBuffer);
  saveFile('documents', docs[0].file_path.split('/').pop()!.replace('.enc', ''), signedPdfBuffer, false);
  // Update with re-encrypted version
  const newPath = docs[0].file_path;
  const { encryptFile } = await import('../storage');
  const { promises: fsPromises } = await import('fs');
  await fsPromises.writeFile(newPath, encryptFile(signedPdfBuffer));

  // Update hash in DB
  await query('UPDATE envelope_documents SET sha256_hash=$1 WHERE id=$2', [newHash, docs[0].id]);

  // Step 5 — Update state
  await query(
    `UPDATE envelope_recipients SET status='SIGNED', signed_at=now(), ip_address=$1, user_agent=$2, signing_ip=$3 WHERE id=$4`,
    [ipAddress, userAgent, capturedIp, payload.recipientId]
  );

  await logEvent({
    envelopeId: payload.envelopeId,
    recipientEmail: payload.email,
    eventType: 'signed',
    ipAddress,
    userAgent,
    metadata: { docHashAfter: newHash, signerName: user.full_name },
  });

  await logEvent({
    envelopeId: payload.envelopeId,
    recipientEmail: payload.email,
    eventType: 'identity_verified',
    ipAddress,
    metadata: { identityLevel: user.identity_level },
  });

  // Check if all signed
  const { rows: remaining } = await query<any>(
    `SELECT count(*) as cnt FROM envelope_recipients WHERE envelope_id=$1 AND status != 'SIGNED' AND status != 'DECLINED'`,
    [payload.envelopeId]
  );

  if (parseInt(remaining[0].cnt) === 0) {
    await query(
      `UPDATE envelopes SET status='COMPLETED', completed_at=now(), updated_at=now() WHERE id=$1`,
      [payload.envelopeId]
    );
    await logEvent({ envelopeId: payload.envelopeId, eventType: 'envelope_completed' });

    // Fire-and-forget certificate generation (never throws to client)
    import('./certificateGenerator').then(({ generateCompletionCertificate }) => {
      generateCompletionCertificate(payload.envelopeId).catch(err =>
        console.error('[CertGen] Certificate generation failed', { envelopeId: payload.envelopeId, err })
      );
    }).catch(() => {});

    // Queue completion emails and CoC
    const { rows: allRecipients } = await query<any>(
      'SELECT user_email, full_name FROM envelope_recipients WHERE envelope_id=$1',
      [payload.envelopeId]
    );
    const { rows: envelopes } = await query<any>('SELECT subject FROM envelopes WHERE id=$1', [payload.envelopeId]);
    const { rows: senders } = await query<any>(
      'SELECT full_name, email FROM users WHERE id=(SELECT sender_id FROM envelopes WHERE id=$1)',
      [payload.envelopeId]
    );

    for (const r of [...allRecipients, { user_email: senders[0]?.email, full_name: senders[0]?.full_name }]) {
      if (r.user_email) {
        await emailQueue.add('completion', {
          type: 'completion',
          data: {
            email: r.user_email,
            name: r.full_name,
            subject: envelopes[0]?.subject,
            envelopeId: payload.envelopeId,
          },
        });
      }
    }

    await cocQueue.add('generate', { envelopeId: payload.envelopeId });
  }
}

export async function declineEnvelope(token: string, reason: string, ipAddress: string): Promise<void> {
  const payload = decodeSigningToken(token);
  await query(
    `UPDATE envelope_recipients SET status='DECLINED', decline_reason=$1 WHERE id=$2`,
    [reason, payload.recipientId]
  );
  await query(
    `UPDATE envelopes SET status='DECLINED', updated_at=now() WHERE id=$1`,
    [payload.envelopeId]
  );
  await logEvent({
    envelopeId: payload.envelopeId,
    recipientEmail: payload.email,
    eventType: 'envelope_declined',
    ipAddress,
    metadata: { reason },
  });
}

async function checkAndUpdateDelivered(envelopeId: string): Promise<void> {
  const { rows } = await query<any>(
    `SELECT count(*) as total,
       sum(CASE WHEN viewed_at IS NOT NULL THEN 1 ELSE 0 END) as viewed
     FROM envelope_recipients WHERE envelope_id=$1`,
    [envelopeId]
  );
  if (rows[0] && parseInt(rows[0].total) > 0 && rows[0].total === rows[0].viewed) {
    await query(`UPDATE envelopes SET status='DELIVERED', updated_at=now() WHERE id=$1 AND status='SENT'`, [envelopeId]);
  }
}
