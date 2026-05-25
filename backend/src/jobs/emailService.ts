import nodemailer from 'nodemailer';

let transporter: nodemailer.Transporter;

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'localhost',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      auth: process.env.SMTP_USER ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      } : undefined,
    });
  }
  return transporter;
}

export async function sendVerificationEmail(email: string, name: string, token: string): Promise<string> {
  const verifyUrl = `${process.env.APP_BASE_URL}/api/auth/verify-email?token=${token}`;
  const html = `
    <h2>Welcome to DocuSign, ${name}!</h2>
    <p>Please verify your email address by clicking the button below:</p>
    <a href="${verifyUrl}" style="background:#2563eb;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;">Verify Email</a>
    <p>This link expires in 24 hours.</p>
  `;

  if (process.env.NODE_ENV === 'development') {
    console.log(`[EMAIL] Verification email to ${email}: ${verifyUrl}`);
    return verifyUrl;
  }

  await getTransporter().sendMail({
    from: `"DocuSign" <noreply@${process.env.APP_BASE_URL?.replace(/https?:\/\//, '') || 'digsign.app'}>`,
    to: email,
    subject: 'Verify your email address',
    html,
  });
  return verifyUrl;
}

export async function sendSigningInvitation(
  recipientEmail: string,
  recipientName: string,
  senderName: string,
  subject: string,
  message: string,
  signingToken: string
): Promise<void> {
  const signingUrl = `${process.env.FRONTEND_URL}/sign/${signingToken}`;
  const html = `
    <h2>You have a document to sign</h2>
    <p><strong>${senderName}</strong> has sent you a document for your signature.</p>
    <h3>${subject}</h3>
    ${message ? `<p>${message}</p>` : ''}
    <p>Click the button below to review and sign the document:</p>
    <a href="${signingUrl}" style="background:#16a34a;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;">Review & Sign</a>
    <p>This link expires in 7 days.</p>
  `;

  if (process.env.NODE_ENV === 'development') {
    console.log(`[EMAIL] Signing invitation to ${recipientEmail}: ${signingUrl}`);
    return;
  }

  await getTransporter().sendMail({
    from: `"DocuSign via ${senderName}" <noreply@digsign.app>`,
    to: recipientEmail,
    subject: `Please sign: ${subject}`,
    html,
  });
}

export async function sendCompletionEmail(
  email: string,
  name: string,
  subject: string,
  envelopeId: string
): Promise<void> {
  const downloadUrl = `${process.env.FRONTEND_URL}/envelopes/${envelopeId}`;
  const html = `
    <h2>Document Signing Complete</h2>
    <p>Hello ${name},</p>
    <p>All parties have signed the document: <strong>${subject}</strong></p>
    <p>You can now download the signed document and Certificate of Completion:</p>
    <a href="${downloadUrl}" style="background:#16a34a;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;">Download Documents</a>
  `;

  if (process.env.NODE_ENV === 'development') {
    console.log(`[EMAIL] Completion email to ${email}: ${downloadUrl}`);
    return;
  }

  await getTransporter().sendMail({
    from: '"DocuSign" <noreply@digsign.app>',
    to: email,
    subject: `Signing complete: ${subject}`,
    html,
  });
}
