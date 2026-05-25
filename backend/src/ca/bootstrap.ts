import forge from 'node-forge';
import dotenv from 'dotenv';
import { saveEncryptedPem, savePlainPem, caExists } from './caStore';

dotenv.config();

function generateSerial(): string {
  return forge.util.bytesToHex(forge.random.getBytesSync(16));
}

function buildCert(options: {
  subject: forge.pki.CertificateField[];
  issuer: forge.pki.CertificateField[];
  publicKey: forge.pki.PublicKey;
  signingKey: forge.pki.PrivateKey;
  serialHex: string;
  validityYears: number;
  extensions: any[];
}): forge.pki.Certificate {
  const cert = forge.pki.createCertificate();
  cert.publicKey = options.publicKey;
  cert.serialNumber = options.serialHex;
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + options.validityYears);
  cert.setSubject(options.subject);
  cert.setIssuer(options.issuer);
  cert.setExtensions(options.extensions);
  cert.sign(options.signingKey as any, forge.md.sha256.create());
  return cert;
}

export async function bootstrapCA(): Promise<void> {
  const rootPassphrase = process.env.ROOT_CA_PASSPHRASE!;
  const intermediatePassphrase = process.env.INTERMEDIATE_CA_PASSPHRASE!;
  const orgName = process.env.CA_ORG_NAME || 'MyOrg Digital Signing CA';
  const country = process.env.CA_COUNTRY || 'IN';

  console.log('[CA] Generating Root CA (RSA-4096, ~30s)...');
  const rootKeysRaw = forge.pki.rsa.generateKeyPair({ bits: 4096, e: 0x10001 });
  const rootKeys = { publicKey: rootKeysRaw.publicKey as forge.pki.rsa.PublicKey, privateKey: rootKeysRaw.privateKey as forge.pki.rsa.PrivateKey };

  const rootSubject: forge.pki.CertificateField[] = [
    { name: 'commonName', value: `${orgName} Root CA` },
    { name: 'organizationName', value: orgName },
    { name: 'countryName', value: country },
  ];

  const rootCert = buildCert({
    subject: rootSubject,
    issuer: rootSubject,
    publicKey: rootKeys.publicKey,
    signingKey: rootKeys.privateKey,
    serialHex: generateSerial(),
    validityYears: 20,
    extensions: [
      { name: 'basicConstraints', cA: true, pathLenConstraint: 2, critical: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
      { name: 'subjectKeyIdentifier' },
    ],
  });

  const rootCertPem = forge.pki.certificateToPem(rootCert);
  const rootKeyPem = forge.pki.privateKeyToPem(rootKeys.privateKey);

  saveEncryptedPem('root-ca.enc', rootKeyPem, rootPassphrase);
  savePlainPem('root-ca-cert.pem', rootCertPem);
  console.log('[CA] Root CA generated and stored.');

  console.log('[CA] Generating Intermediate CA (RSA-2048)...');
  const intKeysRaw = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const intKeys = { publicKey: intKeysRaw.publicKey as forge.pki.rsa.PublicKey, privateKey: intKeysRaw.privateKey as forge.pki.rsa.PrivateKey };

  const intSubject: forge.pki.CertificateField[] = [
    { name: 'commonName', value: `${orgName} Intermediate CA` },
    { name: 'organizationName', value: orgName },
    { name: 'countryName', value: country },
  ];

  const intCert = buildCert({
    subject: intSubject,
    issuer: rootSubject,
    publicKey: intKeys.publicKey,
    signingKey: rootKeys.privateKey,
    serialHex: generateSerial(),
    validityYears: 5,
    extensions: [
      { name: 'basicConstraints', cA: true, pathLenConstraint: 0, critical: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
      { name: 'subjectKeyIdentifier' },
      { name: 'authorityKeyIdentifier', keyIdentifier: true },
    ],
  });

  const intCertPem = forge.pki.certificateToPem(intCert);
  const intKeyPem = forge.pki.privateKeyToPem(intKeys.privateKey);

  saveEncryptedPem('intermediate-ca.enc', intKeyPem, intermediatePassphrase);
  savePlainPem('intermediate-ca-cert.pem', intCertPem);
  console.log('[CA] Intermediate CA generated and stored.');
  console.log('[CA] Bootstrap complete.');
}

if (require.main === module) {
  if (caExists()) {
    console.log('[CA] CA already exists. Delete ca-store/ to regenerate.');
    process.exit(0);
  }
  bootstrapCA().catch((err) => {
    console.error('[CA] Bootstrap failed:', err);
    process.exit(1);
  });
}
