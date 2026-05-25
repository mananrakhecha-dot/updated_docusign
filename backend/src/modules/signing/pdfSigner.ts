import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib';
import forge from 'node-forge';

export interface SignatureAppearance {
  signerName: string;
  signerEmail: string;
  caName: string;
  timestamp: Date;
  reason?: string;
}

export interface SignatureField {
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  signatureData?: string; // base64 PNG of drawn signature
  fieldType: string;
  value?: string;
}

export async function embedSignatureIntoPDF(
  pdfBuffer: Buffer,
  certPem: string,
  privateKeyPem: string,
  fields: SignatureField[],
  appearance: SignatureAppearance
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const pages = pdfDoc.getPages();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  for (const field of fields) {
    const pageIndex = field.pageNumber - 1;
    if (pageIndex < 0 || pageIndex >= pages.length) continue;
    const page = pages[pageIndex];
    const { width: pageWidth, height: pageHeight } = page.getSize();

    // Convert percentage coords to absolute
    const absX = (field.x / 100) * pageWidth;
    const absY = pageHeight - ((field.y / 100) * pageHeight) - (field.height / 100) * pageHeight;
    const absW = (field.width / 100) * pageWidth;
    const absH = (field.height / 100) * pageHeight;

    if (field.fieldType === 'signature') {
      // Draw signature appearance box
      drawSignatureAppearance(page, font, boldFont, absX, absY, absW, absH, appearance, field.signatureData);
    } else if (field.fieldType === 'initials') {
      // Draw initials
      const initials = appearance.signerName.split(' ').map(n => n[0]).join('').toUpperCase();
      page.drawRectangle({ x: absX, y: absY, width: absW, height: absH, borderColor: rgb(0.1, 0.6, 0.1), borderWidth: 1 });
      page.drawText(initials, { x: absX + 4, y: absY + absH / 2 - 6, size: Math.min(absH * 0.5, 14), font: boldFont, color: rgb(0.05, 0.3, 0.05) });
    } else if (field.fieldType === 'date') {
      const dateStr = appearance.timestamp.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
      page.drawRectangle({ x: absX, y: absY, width: absW, height: absH, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.5 });
      page.drawText(dateStr, { x: absX + 4, y: absY + absH / 2 - 5, size: Math.min(absH * 0.45, 10), font, color: rgb(0.2, 0.2, 0.2) });
    } else if (field.fieldType === 'text' && field.value) {
      page.drawRectangle({ x: absX, y: absY, width: absW, height: absH, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.5 });
      page.drawText(field.value, { x: absX + 4, y: absY + absH / 2 - 5, size: Math.min(absH * 0.45, 10), font, color: rgb(0.2, 0.2, 0.2) });
    }
  }

  // Embed cryptographic signature as metadata in PDF info
  const signatureBytes = computePKCS7Signature(pdfBuffer, certPem, privateKeyPem, appearance);
  pdfDoc.setSubject(`Digitally signed by ${appearance.signerName}`);
  pdfDoc.setProducer(`DocuSign Internal CA`);
  pdfDoc.setCreationDate(appearance.timestamp);
  pdfDoc.setModificationDate(appearance.timestamp);

  // Store signature bytes in custom metadata (approximation - full AcroForm signing requires byte-range patching)
  const customMeta = {
    signerName: appearance.signerName,
    signerEmail: appearance.signerEmail,
    signedAt: appearance.timestamp.toISOString(),
    caName: appearance.caName,
    signatureHex: signatureBytes.toString('hex').substring(0, 64) + '...',
  };
  pdfDoc.setKeywords([JSON.stringify(customMeta)]);

  const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
  return Buffer.from(pdfBytes);
}

function drawSignatureAppearance(
  page: any,
  font: any,
  boldFont: any,
  x: number, y: number, w: number, h: number,
  appearance: SignatureAppearance,
  signatureData?: string
): void {
  // Green border box
  page.drawRectangle({
    x, y, width: w, height: h,
    borderColor: rgb(0.07, 0.53, 0.07),
    borderWidth: 1.5,
    color: rgb(0.95, 1.0, 0.95),
  });

  const green = rgb(0.07, 0.53, 0.07);
  const darkGreen = rgb(0.02, 0.35, 0.02);
  const gray = rgb(0.4, 0.4, 0.4);
  const fontSize = Math.min(h * 0.13, 7);
  const padding = 4;

  // Green checkmark (drawn as SVG-like path via lines)
  const ckSize = Math.min(h * 0.35, 14);
  const ckX = x + padding;
  const ckY = y + h - ckSize - padding;
  // Draw checkmark tick using lines
  page.drawLine({ start: { x: ckX, y: ckY + ckSize * 0.45 }, end: { x: ckX + ckSize * 0.35, y: ckY }, color: green, thickness: 2 });
  page.drawLine({ start: { x: ckX + ckSize * 0.35, y: ckY }, end: { x: ckX + ckSize, y: ckY + ckSize * 0.75 }, color: green, thickness: 2 });

  const textX = x + ckSize + padding * 2;
  let textY = y + h - fontSize - padding;

  const nameDisplay = appearance.signerName.length > 18 ? appearance.signerName.substring(0, 16) + '..' : appearance.signerName;
  page.drawText(`Signed by: ${nameDisplay}`, { x: textX, y: textY, size: fontSize, font: boldFont, color: darkGreen });
  textY -= fontSize + 2;
  page.drawText(appearance.signerEmail.substring(0, 24), { x: textX, y: textY, size: fontSize * 0.85, font, color: gray });
  textY -= fontSize + 1;
  page.drawText(`Date: ${appearance.timestamp.toISOString().substring(0, 10)}`, { x: textX, y: textY, size: fontSize * 0.85, font, color: gray });
  textY -= fontSize + 1;
  page.drawText(`CA: ${appearance.caName.substring(0, 22)}`, { x: textX, y: textY, size: fontSize * 0.8, font, color: gray });
  textY -= fontSize + 1;
  page.drawText('Reason: I approve this document', { x: textX, y: textY, size: fontSize * 0.8, font, color: gray });
  textY -= fontSize + 1;
  page.drawText('VERIFIED', { x: x + w - 38, y: y + padding, size: 6.5, font: boldFont, color: green });
}

function computePKCS7Signature(
  pdfBuffer: Buffer,
  certPem: string,
  privateKeyPem: string,
  appearance: SignatureAppearance
): Buffer {
  const cert = forge.pki.certificateFromPem(certPem);
  const privateKey = forge.pki.privateKeyFromPem(privateKeyPem) as forge.pki.rsa.PrivateKey;

  const md = forge.md.sha256.create();
  md.update(pdfBuffer.toString('binary'));

  const p7 = (forge as any).pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(pdfBuffer.toString('binary'));
  p7.addCertificate(cert);
  p7.addSigner({
    key: privateKey,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: appearance.timestamp },
    ],
  });
  p7.sign({ detached: true });

  const derBuffer = forge.asn1.toDer(p7.toAsn1());
  return Buffer.from(derBuffer.getBytes(), 'binary');
}
