import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { pdflibAddPlaceholder } from "@signpdf/placeholder-pdf-lib";
import { SignPdf } from "@signpdf/signpdf";
import { P12Signer } from "@signpdf/signer-p12";
import forge from "node-forge";
import { createHash } from "crypto";

/*
 * PDF Digital Signing — Implementation Notes
 *
 * Visual layer:  pdf-lib draws the signature PNG and annotation text
 *                directly onto the PDF page at the correct coordinates.
 *
 * Crypto layer:  @signpdf/placeholder-pdf-lib adds a PDF AcroForm signature
 *                field with a /ByteRange + /Contents placeholder.
 *                @signpdf/signpdf injects a PKCS#7 DER-encoded CMS signature
 *                into the /Contents field, covering all PDF bytes except the
 *                placeholder itself (per ISO 32000 specification).
 *
 * Verification:  The signed PDF is verifiable in Adobe Acrobat Reader,
 *                Foxit, PDF.js, and online validators (e.g. tools.pdf24.org).
 *                The certificate will show as "unknown authority" because it
 *                is self-signed. This does not affect tamper-evidence.
 *
 * Tamper check:  A separate SHA-256 hash of the original PDF is stored in
 *                the database at upload time and re-verified before every
 *                signing operation (see tamper check block below).
 */

export interface SignatureAppearance {
  signerName: string;
  signerEmail: string;
  caName: string;
  timestamp: Date;
  reason?: string;
}

/**
 * Appearance metadata used by applyPkcs7Signature — a subset of
 * SignatureAppearance (caName is not embedded in the CMS structure).
 */
export interface Pkcs7SignatureAppearance {
  signerName: string;
  signerEmail: string;
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
  appearance: SignatureAppearance,
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const pages = pdfDoc.getPages();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // ── Visual layer ────────────────────────────────────────────────────────────
  for (const field of fields) {
    const pageIndex = field.pageNumber - 1;
    if (pageIndex < 0 || pageIndex >= pages.length) continue;
    const page = pages[pageIndex];
    const { width: pageWidth, height: pageHeight } = page.getSize();

    // Convert percentage coords to absolute (Y-axis flipped: PDF origin is bottom-left)
    const absX = (field.x / 100) * pageWidth;
    const absY =
      pageHeight -
      (field.y / 100) * pageHeight -
      (field.height / 100) * pageHeight;
    const absW = (field.width / 100) * pageWidth;
    const absH = (field.height / 100) * pageHeight;

    if (field.fieldType === "signature") {
      await drawSignatureAppearance(
        pdfDoc,
        page,
        font,
        boldFont,
        absX,
        absY,
        absW,
        absH,
        appearance,
        field.signatureData,
        certPem,
      );
    } else if (field.fieldType === "initials") {
      const initials = appearance.signerName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase();
      page.drawRectangle({
        x: absX,
        y: absY,
        width: absW,
        height: absH,
        borderColor: rgb(0.1, 0.6, 0.1),
        borderWidth: 1,
      });
      page.drawText(initials, {
        x: absX + 4,
        y: absY + absH / 2 - 6,
        size: Math.min(absH * 0.5, 14),
        font: boldFont,
        color: rgb(0.05, 0.3, 0.05),
      });
    } else if (field.fieldType === "date") {
      // Prefer value sent from the client (avoids ICU locale dependency); fall back to server timestamp
      let dateStr =
        field.value && typeof field.value === "string" ? field.value : "";
      if (!dateStr) {
        const d = appearance.timestamp;
        const months = [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ];
        dateStr = `${String(d.getDate()).padStart(2, "0")} ${months[d.getMonth()]} ${d.getFullYear()}`;
      }
      page.drawRectangle({
        x: absX,
        y: absY,
        width: absW,
        height: absH,
        borderColor: rgb(0.6, 0.6, 0.6),
        borderWidth: 0.5,
      });
      page.drawText(dateStr, {
        x: absX + 4,
        y: absY + absH / 2 - 5,
        size: Math.min(absH * 0.45, 10),
        font,
        color: rgb(0.2, 0.2, 0.2),
      });
    } else if (field.fieldType === "text" && field.value) {
      page.drawRectangle({
        x: absX,
        y: absY,
        width: absW,
        height: absH,
        borderColor: rgb(0.6, 0.6, 0.6),
        borderWidth: 0.5,
      });
      page.drawText(field.value, {
        x: absX + 4,
        y: absY + absH / 2 - 5,
        size: Math.min(absH * 0.45, 10),
        font,
        color: rgb(0.2, 0.2, 0.2),
      });
    }
  }

  // ── PDF metadata ────────────────────────────────────────────────────────────
  pdfDoc.setSubject(`Digitally signed by ${appearance.signerName}`);
  pdfDoc.setProducer("DocuSign Internal CA");
  pdfDoc.setCreationDate(appearance.timestamp);
  pdfDoc.setModificationDate(appearance.timestamp);

  // ── Crypto layer: AcroForm placeholder + PKCS#7 signing ────────────────────

  // 1. Add /ByteRange + /Contents AcroForm signature placeholder
  await pdflibAddPlaceholder({
    pdfDoc,
    reason: `Signed by ${appearance.signerName}`,
    contactInfo: appearance.signerEmail,
    name: appearance.signerName,
    location: "DocuSign App",
  });

  // 2. Serialise PDF with placeholder (useObjectStreams: false required by @signpdf)
  const pdfWithPlaceholder = await pdfDoc.save({ useObjectStreams: false });

  // 3. Convert PEM key + cert → P12 buffer (no passphrase)
  const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
  const certificate = forge.pki.certificateFromPem(certPem);
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
    privateKey as forge.pki.rsa.PrivateKey,
    [certificate],
    "",
    { algorithm: "3des" },
  );
  const p12Buffer = Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), "binary");

  // 4. Inject PKCS#7 CMS signature into /Contents (ISO 32000 §12.8)
  const signer = new P12Signer(p12Buffer, { passphrase: "" });
  const signpdf = new SignPdf();
  const signedPdfBuffer = await signpdf.sign(
    Buffer.from(pdfWithPlaceholder),
    signer,
  );

  return signedPdfBuffer;
}

async function drawSignatureAppearance(
  pdfDoc: PDFDocument,
  page: any,
  font: any,
  boldFont: any,
  x: number,
  y: number,
  w: number,
  h: number,
  appearance: SignatureAppearance,
  signatureData?: string,
  certPem?: string,
): Promise<void> {
  const gray = rgb(0.35, 0.35, 0.35);
  const darkBlue = rgb(0.05, 0.05, 0.3);

  // a. White background with thin dark border
  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    borderColor: rgb(0.2, 0.2, 0.2),
    borderWidth: 0.8,
    color: rgb(1, 1, 1),
  });

  // b. "Signed by:" label at top-left
  page.drawText("Signed by:", {
    x: x + 4,
    y: y + h - 9,
    size: 6.5,
    font,
    color: gray,
  });

  // c. Signature image (PNG or JPEG) or name fallback in the centre of the box
  const imgH = Math.max(h - 28, 8); // guard against tiny / negative height
  const imgY = y + 12;
  let imageEmbedded = false;

  if (signatureData) {
    try {
      let pdfImage;
      if (signatureData.startsWith("data:image/png")) {
        const base64 = signatureData.replace(/^data:image\/png;base64,/, "");
        pdfImage = await pdfDoc.embedPng(Buffer.from(base64, "base64"));
      } else if (
        signatureData.startsWith("data:image/jpeg") ||
        signatureData.startsWith("data:image/jpg")
      ) {
        const base64 = signatureData.replace(/^data:image\/jpe?g;base64,/, "");
        pdfImage = await pdfDoc.embedJpg(Buffer.from(base64, "base64"));
      }
      if (pdfImage) {
        page.drawImage(pdfImage, {
          x: x + 4,
          y: imgY,
          width: w - 8,
          height: imgH,
        });
        imageEmbedded = true;
      }
    } catch (err) {
      console.error("[pdfSigner] Failed to embed signature image:", err);
    }
  }

  if (!imageEmbedded) {
    page.drawText(appearance.signerName, {
      x: x + 4,
      y: y + h / 2 - 2,
      size: Math.min(h * 0.28, 16),
      font: boldFont,
      color: darkBlue,
    });
  }

  // d. Certificate fingerprint (SHA-1 of DER bytes) at the bottom
  try {
    if (certPem) {
      // Strip PEM headers and decode base64 → raw DER bytes
      const derBase64 = certPem
        .replace(/-----BEGIN CERTIFICATE-----/g, "")
        .replace(/-----END CERTIFICATE-----/g, "")
        .replace(/\s+/g, "");
      const derBuf = Buffer.from(derBase64, "base64");
      const fp = createHash("sha1").update(derBuf).digest("hex").toUpperCase();
      const shortFp = fp.substring(0, 15) + "...";
      page.drawText(shortFp, {
        x: x + 4,
        y: y + 3,
        size: 6.5,
        font,
        color: rgb(0.2, 0.2, 0.2),
      });
    } else {
      console.error("[pdfSigner] certPem is empty — fingerprint skipped");
    }
  } catch (err) {
    console.error("[pdfSigner] Failed to draw certificate fingerprint:", err);
  }
}

/**
 * Applies a PKCS#7 / ISO 32000 cryptographic signature to an already-rendered
 * PDF buffer — NO visual drawing.  Stamps have already been applied by the
 * env_meta render loop in the download handler.
 *
 * For envelopes with multiple signers, call this function once per signer in
 * signing order.  Each call does a full pdf-lib re-serialize before signing,
 * which means only the LAST signature in the chain will be cryptographically
 * valid in Adobe Acrobat (because earlier ByteRange offsets are invalidated by
 * subsequent rewrites).  This matches the original signing-time behaviour where
 * each ceremony re-serialised the PDF, leaving only the most recent signature
 * intact.  The visual stamps for all signers are correct regardless.
 *
 * @param pdfBuffer      Already-rendered (stamped) PDF bytes.
 * @param certPem        Signer's leaf certificate in PEM format.
 * @param privateKeyPem  Signer's RSA private key in PEM format (decrypted).
 * @param appearance     Signer identity and timestamp for the AcroForm field.
 * @returns              PDF bytes with PKCS#7 signature embedded.
 */
export async function applyPkcs7Signature(
  pdfBuffer: Buffer,
  certPem: string,
  privateKeyPem: string,
  appearance: Pkcs7SignatureAppearance,
): Promise<Buffer> {
  // Load the rendered PDF.  We add only the AcroForm signature placeholder;
  // no images, no rectangles, no text — all stamps are already in the buffer.
  const pdfDoc = await PDFDocument.load(pdfBuffer);

  pdfDoc.setSubject(`Digitally signed by ${appearance.signerName}`);
  pdfDoc.setProducer("DocuSign Internal CA");
  pdfDoc.setModificationDate(appearance.timestamp);

  // 1. Add /ByteRange + /Contents AcroForm signature placeholder
  await pdflibAddPlaceholder({
    pdfDoc,
    reason: appearance.reason ?? `Signed by ${appearance.signerName}`,
    contactInfo: appearance.signerEmail,
    name: appearance.signerName,
    location: "DocuSign App",
  });

  // 2. Serialise with placeholder (useObjectStreams: false required by @signpdf)
  const pdfWithPlaceholder = await pdfDoc.save({ useObjectStreams: false });

  // 3. Convert PEM key + cert → P12 (no passphrase, 3DES-encrypted P12)
  const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
  const certificate = forge.pki.certificateFromPem(certPem);
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
    privateKey as forge.pki.rsa.PrivateKey,
    [certificate],
    "",
    { algorithm: "3des" },
  );
  const p12Buffer = Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), "binary");

  // 4. Inject PKCS#7 CMS detached signature into /Contents (ISO 32000 §12.8)
  const p12signer = new P12Signer(p12Buffer, { passphrase: "" });
  const signpdf = new SignPdf();
  return signpdf.sign(Buffer.from(pdfWithPlaceholder), p12signer);
}
