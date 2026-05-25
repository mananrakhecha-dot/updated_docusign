import forge from 'node-forge';
import crypto from 'crypto';
import { getIntermediateCA } from './caStore';
import { query } from '../db/pool';

function generateSerial(): string {
  return forge.util.bytesToHex(forge.random.getBytesSync(16));
}

function encryptPrivateKey(pem: string): string {
  const keyHex = process.env.PRIVATE_KEY_ENCRYPTION_KEY!;
  const key = Buffer.from(keyHex, 'hex');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(pem, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

export function decryptPrivateKey(encrypted: string): string {
  const [ivHex, encHex] = encrypted.split(':');
  const keyHex = process.env.PRIVATE_KEY_ENCRYPTION_KEY!;
  const key = Buffer.from(keyHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}

export async function issueLeafCertificate(userId: string, email: string, fullName: string): Promise<void> {
  const intermediateCA = getIntermediateCA();
  const orgName = process.env.CA_ORG_NAME || 'MyOrg Digital Signing CA';
  const country = process.env.CA_COUNTRY || 'IN';

  const leafKeys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const serialHex = generateSerial();

  const cert = forge.pki.createCertificate();
  cert.publicKey = leafKeys.publicKey;
  cert.serialNumber = serialHex;
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

  const subject: forge.pki.CertificateField[] = [
    { name: 'commonName', value: fullName },
    { name: 'emailAddress', value: email },
    { name: 'organizationName', value: orgName },
    { name: 'countryName', value: country },
  ];

  cert.setSubject(subject);
  cert.setIssuer(intermediateCA.cert.subject.attributes);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false, critical: true },
    {
      name: 'keyUsage',
      digitalSignature: true,
      nonRepudiation: true,
      critical: true,
    },
    { name: 'extKeyUsage', emailProtection: true },
    { name: 'subjectKeyIdentifier' },
    { name: 'authorityKeyIdentifier', keyIdentifier: true },
  ]);

  cert.sign(intermediateCA.privateKey, forge.md.sha256.create());

  const certPem = forge.pki.certificateToPem(cert);
  const keyPem = forge.pki.privateKeyToPem(leafKeys.privateKey);
  const encryptedKey = encryptPrivateKey(keyPem);
  const expiresAt = cert.validity.notAfter;

  await query(
    `UPDATE users SET cert_pem=$1, encrypted_private_key=$2, cert_serial=$3, cert_expires_at=$4, updated_at=now()
     WHERE id=$5`,
    [certPem, encryptedKey, serialHex, expiresAt, userId]
  );
}

export async function revokeUserCertificate(userId: string, reason: string): Promise<void> {
  const { rows } = await query<{ cert_serial: string }>('SELECT cert_serial FROM users WHERE id=$1', [userId]);
  if (!rows[0]?.cert_serial) return;
  await query(
    `INSERT INTO revoked_certificates (serial_number, user_id, revocation_reason)
     VALUES ($1, $2, $3) ON CONFLICT (serial_number) DO NOTHING`,
    [rows[0].cert_serial, userId, reason]
  );
  await query('UPDATE users SET cert_pem=NULL, encrypted_private_key=NULL, cert_serial=NULL WHERE id=$1', [userId]);
}

export async function checkAndRenewCertificates(): Promise<void> {
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  const { rows } = await query<{ id: string; email: string; full_name: string }>(
    `SELECT id, email, full_name FROM users
     WHERE cert_expires_at < $1 AND identity_level IN ('SES','AES')`,
    [thirtyDaysFromNow]
  );

  for (const user of rows) {
    console.log(`[CA] Renewing certificate for ${user.email}`);
    await issueLeafCertificate(user.id, user.email, user.full_name);
  }
}
