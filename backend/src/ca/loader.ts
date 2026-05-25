import forge from 'node-forge';
import { loadEncryptedPem, loadPlainPem, setIntermediateCA, caExists } from './caStore';
import { bootstrapCA } from './bootstrap';

export async function loadCA(): Promise<void> {
  if (!caExists()) {
    console.log('[CA] No CA found, bootstrapping...');
    await bootstrapCA();
  }

  const intKeyPem = loadEncryptedPem('intermediate-ca.enc', process.env.INTERMEDIATE_CA_PASSPHRASE!);
  const intCertPem = loadPlainPem('intermediate-ca-cert.pem');

  if (!intKeyPem || !intCertPem) {
    throw new Error('[CA] Failed to load Intermediate CA files');
  }

  const cert = forge.pki.certificateFromPem(intCertPem);
  const privateKey = forge.pki.privateKeyFromPem(intKeyPem) as forge.pki.rsa.PrivateKey;

  setIntermediateCA({ cert, privateKey, certPem: intCertPem, keyPem: intKeyPem });
  console.log('[CA] Intermediate CA loaded. Subject:', cert.subject.getField('CN')?.value);
}
