import { PDFDocument, rgb, StandardFonts, PDFPage } from 'pdf-lib';
import QRCode from 'qrcode';
import { query } from '../../db/pool';
import { saveFile, readFile, computeSHA256 } from '../storage';
import { logEvent } from '../audit/auditService';
import { embedSignatureIntoPDF } from '../signing/pdfSigner';
import { getIntermediateCA } from '../../ca/caStore';
import { decryptPrivateKey } from '../../ca/certIssuer';

export async function generateCertificateOfCompletion(envelopeId: string): Promise<void> {
  const { rows: envs } = await query<any>(
    `SELECT e.*, u.full_name as sender_name, u.email as sender_email
     FROM envelopes e JOIN users u ON e.sender_id=u.id WHERE e.id=$1`,
    [envelopeId]
  );
  if (!envs[0]) throw new Error('Envelope not found');
  const envelope = envs[0];

  const { rows: docs } = await query<any>(
    'SELECT * FROM envelope_documents WHERE envelope_id=$1',
    [envelopeId]
  );
  const doc = docs[0];

  const { rows: recipients } = await query<any>(
    'SELECT * FROM envelope_recipients WHERE envelope_id=$1 ORDER BY order_index',
    [envelopeId]
  );

  const { rows: events } = await query<any>(
    'SELECT * FROM audit_events WHERE envelope_id=$1 ORDER BY created_at ASC',
    [envelopeId]
  );

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]); // A4
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const { width, height } = page.getSize();
  const margin = 50;
  let y = height - margin;

  const green = rgb(0.07, 0.53, 0.07);
  const darkGray = rgb(0.2, 0.2, 0.2);
  const lightGray = rgb(0.5, 0.5, 0.5);

  // Header
  page.drawRectangle({ x: 0, y: height - 80, width, height: 80, color: green });
  page.drawText('CERTIFICATE OF COMPLETION', { x: margin, y: height - 50, size: 20, font: boldFont, color: rgb(1, 1, 1) });
  page.drawText('Digital Document Signing Platform', { x: margin, y: height - 70, size: 11, font, color: rgb(0.9, 1, 0.9) });
  y = height - 110;

  // Envelope info
  drawSection(page, boldFont, 'ENVELOPE DETAILS', margin, y, width - margin * 2, green);
  y -= 25;
  drawField(page, font, boldFont, 'Envelope ID:', envelopeId, margin, y, darkGray, lightGray);
  y -= 18;
  drawField(page, font, boldFont, 'Subject:', envelope.subject, margin, y, darkGray, lightGray);
  y -= 18;
  drawField(page, font, boldFont, 'Sender:', `${envelope.sender_name} <${envelope.sender_email}>`, margin, y, darkGray, lightGray);
  y -= 18;
  drawField(page, font, boldFont, 'Completed At:', new Date(envelope.completed_at).toUTCString(), margin, y, darkGray, lightGray);
  y -= 18;
  if (doc) {
    drawField(page, font, boldFont, 'Document:', doc.file_name, margin, y, darkGray, lightGray);
    y -= 18;
    drawField(page, font, boldFont, 'Final Hash (SHA-256):', doc.sha256_hash, margin, y, darkGray, lightGray);
    y -= 18;
  }

  // Recipients
  y -= 10;
  drawSection(page, boldFont, 'SIGNERS', margin, y, width - margin * 2, green);
  y -= 25;

  for (const r of recipients) {
    const signerEvents = events.filter((e: any) => e.recipient_email === r.user_email);
    const viewedEvent = signerEvents.find((e: any) => e.event_type === 'signing_link_opened');
    const signedEvent = signerEvents.find((e: any) => e.event_type === 'signed');
    const idEvent = signerEvents.find((e: any) => e.event_type === 'identity_verified');

    page.drawRectangle({ x: margin, y: y - 80, width: width - margin * 2, height: 85, color: rgb(0.97, 0.97, 0.97), borderColor: rgb(0.85, 0.85, 0.85), borderWidth: 1 });

    drawField(page, font, boldFont, 'Name:', r.full_name, margin + 8, y - 8, darkGray, lightGray);
    drawField(page, font, boldFont, 'Email:', r.user_email, margin + 8, y - 24, darkGray, lightGray);
    drawField(page, font, boldFont, 'Identity Level:', r.auth_required, margin + 8, y - 40, darkGray, lightGray);
    drawField(page, font, boldFont, 'Status:', r.status, margin + 8, y - 56, darkGray, r.status === 'SIGNED' ? green : lightGray);
    if (viewedEvent) drawField(page, font, boldFont, 'Viewed:', new Date(viewedEvent.created_at).toUTCString(), margin + 8, y - 72, darkGray, lightGray);
    if (signedEvent) drawField(page, font, boldFont, 'Signed:', new Date(signedEvent.created_at).toUTCString(), margin + 220, y - 72, darkGray, green);

    y -= 100;
    if (y < 200) break; // Guard — could paginate
  }

  // Legal statement
  y -= 10;
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, color: lightGray, thickness: 0.5 });
  y -= 20;
  page.drawText(
    'This certificate constitutes the legally binding audit record of the above transaction.',
    { x: margin, y, size: 9, font: boldFont, color: darkGray }
  );
  y -= 14;
  page.drawText(
    'The digital signatures embedded in the signed document are verifiable using the PKI chain of trust.',
    { x: margin, y, size: 8, font, color: lightGray }
  );

  // QR code
  const verifyUrl = `${process.env.APP_BASE_URL}/api/verify/${envelopeId}`;
  const qrDataUrl = await QRCode.toDataURL(verifyUrl, { width: 100, margin: 1 });
  const qrImageBytes = Buffer.from(qrDataUrl.split(',')[1], 'base64');
  const qrImage = await pdfDoc.embedPng(qrImageBytes);
  page.drawImage(qrImage, { x: width - margin - 80, y: margin, width: 80, height: 80 });
  page.drawText('Scan to verify', { x: width - margin - 68, y: margin - 12, size: 7, font, color: lightGray });

  const pdfBytes = await pdfDoc.save();
  const pdfBuffer = Buffer.from(pdfBytes);

  const certFilename = `cert-${envelopeId}.pdf.enc`;
  const certPath = saveFile('certificates', certFilename, pdfBuffer, true);

  await query('UPDATE envelopes SET completion_cert_path=$1 WHERE id=$2', [certPath, envelopeId]);
  await logEvent({ envelopeId, eventType: 'certificate_generated', metadata: { certPath } });
}

function drawSection(page: PDFPage, font: any, title: string, x: number, y: number, w: number, color: any): void {
  page.drawRectangle({ x, y: y - 5, width: w, height: 20, color });
  page.drawText(title, { x: x + 8, y, size: 10, font, color: rgb(1, 1, 1) });
}

function drawField(page: PDFPage, font: any, boldFont: any, label: string, value: string, x: number, y: number, labelColor: any, valueColor: any): void {
  page.drawText(label, { x, y, size: 8, font: boldFont, color: labelColor });
  page.drawText(value.substring(0, 70), { x: x + 90, y, size: 8, font, color: valueColor });
}

export async function getVerificationData(envelopeId: string): Promise<any> {
  const { rows: envs } = await query<any>(
    `SELECT e.*, u.full_name as sender_name, u.email as sender_email
     FROM envelopes e JOIN users u ON e.sender_id=u.id WHERE e.id=$1`,
    [envelopeId]
  );
  if (!envs[0]) return null;
  const envelope = envs[0];

  const { rows: docs } = await query<any>('SELECT file_name, sha256_hash FROM envelope_documents WHERE envelope_id=$1', [envelopeId]);
  const { rows: recipients } = await query<any>(
    'SELECT user_email, full_name, status, signed_at, auth_required FROM envelope_recipients WHERE envelope_id=$1',
    [envelopeId]
  );

  return {
    envelopeId,
    status: envelope.status,
    subject: envelope.subject,
    sender: { name: envelope.sender_name, email: envelope.sender_email },
    completedAt: envelope.completed_at,
    document: docs[0] ? { name: docs[0].file_name, sha256Hash: docs[0].sha256_hash } : null,
    signers: recipients.map((r: any) => ({
      email: r.user_email,
      name: r.full_name,
      status: r.status,
      signedAt: r.signed_at,
      identityLevel: r.auth_required,
    })),
  };
}
