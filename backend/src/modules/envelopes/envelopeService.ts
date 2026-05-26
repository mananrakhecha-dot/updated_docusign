import { PDFDocument } from 'pdf-lib';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import path from 'path';
import { query } from '../../db/pool';
import { saveFile, computeSHA256 } from '../storage';
import { emailQueue } from '../../jobs/queues';
import { AppError } from '../../middleware/errorHandler';
import { logEvent } from '../audit/auditService';

export async function createEnvelope(
  senderId: string,
  subject: string,
  message: string,
  fileBuffer: Buffer,
  originalName: string
): Promise<{ envelopeId: string; documentId: string; pageCount: number }> {
  // Compute hash of original PDF
  const sha256 = computeSHA256(fileBuffer);

  // Get page count from PDF
  const pdfDoc = await PDFDocument.load(fileBuffer);
  const pageCount = pdfDoc.getPageCount();

  // Save encrypted
  const filename = `${crypto.randomUUID()}.pdf.enc`;
  const filePath = saveFile('documents', filename, fileBuffer, true);

  // Create envelope
  const envResult = await query<{ id: string }>(
    `INSERT INTO envelopes (sender_id, subject, message) VALUES ($1, $2, $3) RETURNING id`,
    [senderId, subject, message]
  );
  const envelopeId = envResult.rows[0].id;

  // Create document record
  const docResult = await query<{ id: string }>(
    `INSERT INTO envelope_documents (envelope_id, file_name, file_path, sha256_hash, page_count)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [envelopeId, originalName, filePath, sha256, pageCount]
  );

  await logEvent({ envelopeId, eventType: 'envelope_created', metadata: { subject, senderId } });

  return { envelopeId, documentId: docResult.rows[0].id, pageCount };
}

export async function addRecipient(
  envelopeId: string,
  userEmail: string,
  fullName: string,
  orderIndex: number,
  authRequired: 'SES' | 'AES'
): Promise<string> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO envelope_recipients (envelope_id, user_email, full_name, order_index, auth_required)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [envelopeId, userEmail.toLowerCase(), fullName, orderIndex, authRequired]
  );
  return rows[0].id;
}

export async function updateRecipients(
  envelopeId: string,
  senderId: string,
  recipients: Array<{ email: string; full_name: string; order_index: number; auth_required: 'SES' | 'AES' }>
): Promise<void> {
  const env = await getEnvelopeOrThrow(envelopeId, senderId);
  if (env.status !== 'DRAFT') throw new AppError('Can only edit DRAFT envelopes', 400);

  await query('DELETE FROM envelope_recipients WHERE envelope_id=$1', [envelopeId]);
  for (const r of recipients) {
    await addRecipient(envelopeId, r.email, r.full_name, r.order_index, r.auth_required);
  }
}

export async function saveFields(
  envelopeId: string,
  senderId: string,
  fields: Array<{
    envelope_document_id: string;
    recipient_id: string;
    page_number: number;
    x: number; y: number; width: number; height: number;
    field_type: string;
    preview_data?: string | null;
  }>
): Promise<void> {
  const env = await getEnvelopeOrThrow(envelopeId, senderId);
  if (env.status !== 'DRAFT') throw new AppError('Can only edit DRAFT envelopes', 400);

  // Remove old fields for this envelope's documents
  const { rows: docs } = await query<{ id: string }>(
    'SELECT id FROM envelope_documents WHERE envelope_id=$1',
    [envelopeId]
  );
  for (const doc of docs) {
    await query('DELETE FROM signature_fields WHERE envelope_document_id=$1', [doc.id]);
  }

  for (const field of fields) {
    await query(
      `INSERT INTO signature_fields (envelope_document_id, recipient_id, page_number, x, y, width, height, field_type, preview_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [field.envelope_document_id, field.recipient_id, field.page_number, field.x, field.y, field.width, field.height, field.field_type, field.preview_data ?? null]
    );
  }
}

export async function sendEnvelope(envelopeId: string, senderId: string): Promise<void> {
  const env = await getEnvelopeOrThrow(envelopeId, senderId);
  if (env.status !== 'DRAFT') throw new AppError('Envelope is not in DRAFT status', 400);

  // Validate all recipients have fields
  const { rows: recipients } = await query<any>(
    'SELECT * FROM envelope_recipients WHERE envelope_id=$1',
    [envelopeId]
  );
  if (recipients.length === 0) throw new AppError('No recipients added', 400);

  const { rows: sender } = await query<{ full_name: string; email: string }>(
    'SELECT full_name, email FROM users WHERE id=$1',
    [senderId]
  );

  for (const recipient of recipients) {
    const { rows: fields } = await query(
      `SELECT sf.id FROM signature_fields sf
       JOIN envelope_documents ed ON sf.envelope_document_id=ed.id
       WHERE ed.envelope_id=$1 AND sf.recipient_id=$2`,
      [envelopeId, recipient.id]
    );
    if (fields.length === 0) {
      throw new AppError(`Recipient ${recipient.user_email} has no signature fields assigned`, 400);
    }

    // Generate signing token
    const signingToken = jwt.sign(
      { envelopeId, recipientId: recipient.id, email: recipient.user_email },
      process.env.SIGNING_LINK_SECRET!,
      { expiresIn: '7d' }
    );

    await query(
      'UPDATE envelope_recipients SET signing_token=$1 WHERE id=$2',
      [signingToken, recipient.id]
    );

    // Queue invitation email
    await emailQueue.add('signing-invitation', {
      type: 'signing-invitation',
      data: {
        recipientEmail: recipient.user_email,
        recipientName: recipient.full_name,
        senderName: sender[0]?.full_name || 'DocuSign User',
        subject: env.subject,
        message: env.message || '',
        signingToken,
      },
    });

    await logEvent({
      envelopeId,
      recipientEmail: recipient.user_email,
      eventType: 'envelope_sent',
      metadata: { recipientName: recipient.full_name },
    });
  }

  await query(
    `UPDATE envelopes SET status='SENT', updated_at=now() WHERE id=$1`,
    [envelopeId]
  );
}

export async function voidEnvelope(envelopeId: string, senderId: string, reason: string): Promise<void> {
  await getEnvelopeOrThrow(envelopeId, senderId);
  await query(
    `UPDATE envelopes SET status='VOIDED', void_reason=$1, updated_at=now() WHERE id=$2`,
    [reason, envelopeId]
  );
  await logEvent({ envelopeId, eventType: 'envelope_voided', metadata: { reason } });
}

export async function getEnvelopeOrThrow(envelopeId: string, userId: string): Promise<any> {
  const { rows } = await query<any>(
    `SELECT e.* FROM envelopes e
     LEFT JOIN envelope_recipients er ON e.id=er.envelope_id AND er.user_email=(SELECT email FROM users WHERE id=$2)
     WHERE e.id=$1 AND (e.sender_id=$2 OR er.envelope_id IS NOT NULL)`,
    [envelopeId, userId]
  );
  if (!rows[0]) throw new AppError('Envelope not found or access denied', 404);
  return rows[0];
}

export async function listEnvelopes(userId: string): Promise<any[]> {
  const { rows } = await query<any>(
    `SELECT DISTINCT e.*, u.full_name as sender_name,
       (SELECT count(*) FROM envelope_recipients WHERE envelope_id=e.id) as recipient_count,
       (SELECT count(*) FROM envelope_recipients WHERE envelope_id=e.id AND status='SIGNED') as signed_count
     FROM envelopes e
     JOIN users u ON e.sender_id=u.id
     LEFT JOIN envelope_recipients er ON e.id=er.envelope_id AND er.user_email=(SELECT email FROM users WHERE id=$1)
     WHERE e.sender_id=$1 OR er.envelope_id IS NOT NULL
     ORDER BY e.created_at DESC`,
    [userId]
  );
  return rows;
}

export async function getEnvelopeDetail(envelopeId: string, userId: string): Promise<any> {
  const env = await getEnvelopeOrThrow(envelopeId, userId);
  const { rows: documents } = await query<any>(
    'SELECT * FROM envelope_documents WHERE envelope_id=$1',
    [envelopeId]
  );
  const { rows: recipients } = await query<any>(
    'SELECT * FROM envelope_recipients WHERE envelope_id=$1 ORDER BY order_index',
    [envelopeId]
  );
  const { rows: sender } = await query<any>(
    'SELECT full_name, email FROM users WHERE id=$1',
    [env.sender_id]
  );

  return { ...env, documents, recipients, sender: sender[0] };
}
