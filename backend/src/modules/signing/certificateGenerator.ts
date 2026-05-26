import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import path from 'path';
import { query } from '../../db/pool';
import { readFile, encryptFile, computeSHA256, UPLOAD_DIR } from '../storage';
import { logEvent } from '../audit/auditService';
import { sendCompletionCertificateEmail } from '../../jobs/emailService';
import fs from 'fs';

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function formatUtc(d: Date | string | null): string {
  if (!d) return 'N/A';
  return new Date(d).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

export async function generateCompletionCertificate(envelopeId: string): Promise<void> {
  // 1. Query all data
  const { rows: envRows } = await query<any>(
    `SELECT e.*, u.full_name as sender_name, u.email as sender_email
     FROM envelopes e JOIN users u ON e.sender_id=u.id WHERE e.id=$1`,
    [envelopeId]
  );
  if (!envRows[0]) throw new Error(`Envelope ${envelopeId} not found`);
  const envelope = envRows[0];

  const { rows: docs } = await query<any>(
    `SELECT * FROM envelope_documents WHERE envelope_id=$1 AND (document_type='original' OR document_type IS NULL) ORDER BY created_at ASC LIMIT 1`,
    [envelopeId]
  );
  const doc = docs[0];

  const { rows: recipients } = await query<any>(
    `SELECT er.*, u.full_name as user_full_name
     FROM envelope_recipients er
     LEFT JOIN users u ON u.email = er.user_email
     WHERE er.envelope_id=$1 ORDER BY order_index`,
    [envelopeId]
  );

  // Get fields per recipient
  const recipientFields: Record<string, string[]> = {};
  if (doc) {
    const { rows: fields } = await query<any>(
      `SELECT sf.field_type, sf.recipient_id
       FROM signature_fields sf
       JOIN envelope_documents ed ON sf.envelope_document_id = ed.id
       WHERE ed.envelope_id=$1`,
      [envelopeId]
    );
    for (const f of fields) {
      if (!recipientFields[f.recipient_id]) recipientFields[f.recipient_id] = [];
      if (!recipientFields[f.recipient_id].includes(f.field_type)) {
        recipientFields[f.recipient_id].push(f.field_type);
      }
    }
  }

  // 2. Integrity check
  let recomputedHash = 'N/A';
  let integrityStatus = 'Document not available';
  let integrityOk = false;

  if (doc) {
    try {
      const decrypted = readFile(doc.file_path, true);
      recomputedHash = computeSHA256(decrypted);
      integrityOk = recomputedHash === doc.sha256_hash;
      integrityStatus = integrityOk
        ? 'Integrity verified'
        : 'HASH MISMATCH — document may have been altered';
    } catch {
      integrityStatus = 'Could not read document for integrity check';
    }
  }

  // 3. Build PDF
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const PAGE_W = 595;
  const PAGE_H = 842;
  const MARGIN = 50;
  const LINE = 16;

  const black = rgb(0.05, 0.05, 0.05);
  const gray = rgb(0.45, 0.45, 0.45);
  const green = rgb(0.07, 0.55, 0.15);
  const red = rgb(0.75, 0.1, 0.1);
  const lightGray = rgb(0.85, 0.85, 0.85);
  const white = rgb(1, 1, 1);
  const sectionBg = rgb(0.13, 0.18, 0.35);

  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const drawText = (text: string, opts: { x?: number; size?: number; font?: any; color?: any; maxWidth?: number }) => {
    const x = opts.x ?? MARGIN;
    const size = opts.size ?? 10;
    const f = opts.font ?? font;
    const color = opts.color ?? black;
    if (opts.maxWidth) {
      // Truncate to fit
      let t = text;
      while (t.length > 4 && f.widthOfTextAtSize(t, size) > opts.maxWidth) {
        t = t.slice(0, -4) + '...';
      }
      page.drawText(t, { x, y, size, font: f, color });
    } else {
      page.drawText(text, { x, y, size, font: f, color });
    }
  };

  const drawHRule = (yPos: number) => {
    page.drawLine({ start: { x: MARGIN, y: yPos }, end: { x: PAGE_W - MARGIN, y: yPos }, color: lightGray, thickness: 0.5 });
  };

  const drawSectionHeader = (title: string) => {
    page.drawRectangle({ x: MARGIN, y: y - 4, width: PAGE_W - MARGIN * 2, height: 18, color: sectionBg });
    page.drawText(title, { x: MARGIN + 6, y: y, size: 9, font: boldFont, color: white });
    y -= 22;
  };

  // ── Header ──────────────────────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: PAGE_H - 70, width: PAGE_W, height: 70, color: sectionBg });
  page.drawText('Certificate of Completion', { x: MARGIN, y: PAGE_H - 32, size: 22, font: boldFont, color: white });
  page.drawText(envelope.subject || 'Untitled Envelope', { x: MARGIN, y: PAGE_H - 52, size: 11, font, color: rgb(0.75, 0.82, 1) });
  y = PAGE_H - 88;

  // Envelope metadata
  page.drawText('Envelope ID:', { x: MARGIN, y, size: 8, font: boldFont, color: gray });
  page.drawText(envelopeId, { x: MARGIN + 75, y, size: 8, font, color: black });
  y -= LINE;
  page.drawText('Generated at:', { x: MARGIN, y, size: 8, font: boldFont, color: gray });
  page.drawText(formatUtc(new Date()), { x: MARGIN + 75, y, size: 8, font, color: black });
  y -= LINE;
  page.drawText('Completed at:', { x: MARGIN, y, size: 8, font: boldFont, color: gray });
  page.drawText(formatUtc(envelope.completed_at), { x: MARGIN + 75, y, size: 8, font, color: black });
  y -= LINE;
  page.drawText('Sender:', { x: MARGIN, y, size: 8, font: boldFont, color: gray });
  page.drawText(`${envelope.sender_name} <${envelope.sender_email}>`, { x: MARGIN + 75, y, size: 8, font, color: black, maxWidth: PAGE_W - MARGIN - 75 - 10 });
  y -= LINE * 1.5;
  drawHRule(y);
  y -= LINE;

  // ── Document Integrity ──────────────────────────────────────────────────────
  drawSectionHeader('Document Integrity');

  page.drawText('Original SHA-256:', { x: MARGIN, y, size: 8, font: boldFont, color: gray });
  y -= LINE - 2;
  page.drawText(doc?.sha256_hash || 'N/A', { x: MARGIN + 10, y, size: 7, font, color: black, maxWidth: PAGE_W - MARGIN * 2 - 10 });
  y -= LINE;
  page.drawText('Signed document SHA-256:', { x: MARGIN, y, size: 8, font: boldFont, color: gray });
  y -= LINE - 2;
  page.drawText(recomputedHash, { x: MARGIN + 10, y, size: 7, font, color: black, maxWidth: PAGE_W - MARGIN * 2 - 10 });
  y -= LINE;
  page.drawText('Integrity status:', { x: MARGIN, y, size: 8, font: boldFont, color: gray });
  page.drawText(integrityStatus, { x: MARGIN + 90, y, size: 8, font: boldFont, color: integrityOk ? green : red });
  y -= LINE * 1.5;
  drawHRule(y);
  y -= LINE;

  // ── Signing Details ─────────────────────────────────────────────────────────
  drawSectionHeader('Signing Details');

  for (const r of recipients) {
    if (y < 140) break; // Guard against overflow
    const blockH = 72;
    page.drawRectangle({ x: MARGIN, y: y - blockH, width: PAGE_W - MARGIN * 2, height: blockH, color: rgb(0.97, 0.97, 0.98), borderColor: lightGray, borderWidth: 0.5 });

    const col2 = MARGIN + 250;
    page.drawText(r.full_name || r.user_full_name || 'Unknown', { x: MARGIN + 8, y: y - 12, size: 9, font: boldFont, color: black });
    page.drawText(r.user_email, { x: MARGIN + 8, y: y - 24, size: 8, font, color: gray });

    page.drawText('Signed at:', { x: MARGIN + 8, y: y - 38, size: 8, font: boldFont, color: gray });
    page.drawText(formatUtc(r.signed_at), { x: MARGIN + 60, y: y - 38, size: 8, font, color: black });

    page.drawText('IP address:', { x: col2, y: y - 38, size: 8, font: boldFont, color: gray });
    page.drawText(r.signing_ip || r.ip_address || 'N/A', { x: col2 + 58, y: y - 38, size: 8, font, color: black });

    const fieldList = (recipientFields[r.id] || []).join(', ') || 'N/A';
    page.drawText('Fields signed:', { x: MARGIN + 8, y: y - 52, size: 8, font: boldFont, color: gray });
    page.drawText(fieldList, { x: MARGIN + 72, y: y - 52, size: 8, font, color: black });

    const statusColor = r.status === 'SIGNED' ? green : r.status === 'DECLINED' ? red : gray;
    page.drawText('Status:', { x: col2, y: y - 52, size: 8, font: boldFont, color: gray });
    page.drawText(r.status, { x: col2 + 40, y: y - 52, size: 8, font: boldFont, color: statusColor });

    y -= blockH + 6;
  }

  // ── Footer ──────────────────────────────────────────────────────────────────
  y -= 6;
  drawHRule(y);
  y -= LINE;
  page.drawText('This certificate was generated automatically.', { x: MARGIN, y, size: 8, font, color: gray });
  y -= LINE - 2;
  page.drawText('Verify document integrity by recomputing the SHA-256 hash of the signed PDF.', { x: MARGIN, y, size: 8, font, color: gray });
  y -= LINE - 2;
  page.drawText('Document will show a valid digital signature in any PDF reader.', { x: MARGIN, y, size: 8, font, color: gray });

  // 4. Save
  const pdfBytes = await pdfDoc.save();
  const pdfBuffer = Buffer.from(pdfBytes);

  const certFilename = `cert-${envelopeId}.pdf`;
  const docsDir = path.join(UPLOAD_DIR, 'documents');
  ensureDir(docsDir);
  const certPath = path.join(docsDir, certFilename);
  fs.writeFileSync(certPath, encryptFile(pdfBuffer));

  // Insert into envelope_documents
  await query(
    `INSERT INTO envelope_documents (envelope_id, file_name, file_path, sha256_hash, page_count, document_type)
     VALUES ($1, $2, $3, $4, $5, 'certificate')
     ON CONFLICT DO NOTHING`,
    [envelopeId, `certificate-${envelopeId}.pdf`, certPath, computeSHA256(pdfBuffer), 1]
  );

  await logEvent({ envelopeId, eventType: 'certificate_generated', metadata: { certPath } });

  // 5. Email sender with cert attached
  try {
    await sendCompletionCertificateEmail(
      envelope.sender_email,
      envelope.sender_name,
      envelope.subject,
      envelopeId,
      pdfBuffer
    );
  } catch (err) {
    console.error('[CertGen] Failed to send cert email', err);
  }
}
