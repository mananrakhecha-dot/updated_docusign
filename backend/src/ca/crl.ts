import forge from 'node-forge';
import { getIntermediateCA } from './caStore';
import { query } from '../db/pool';

let cachedCrlDer: Buffer | null = null;
let crlGeneratedAt: Date | null = null;

function dateToGeneralizedTime(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '') + 'Z';
}

export async function generateCRL(): Promise<Buffer> {
  const intermediateCA = getIntermediateCA();
  const { rows } = await query<{ serial_number: string; revoked_at: string }>(
    'SELECT serial_number, revoked_at FROM revoked_certificates ORDER BY revoked_at DESC'
  );

  const now = new Date();
  const nextUpdate = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Build minimal CRL ASN.1 structure
  const issuerAsn1 = forge.pki.distinguishedNameToAsn1({ attributes: intermediateCA.cert.subject.attributes } as any);

  const revokedList: forge.asn1.Asn1[] = rows.map(r => {
    const revDate = new Date(r.revoked_at);
    return forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false,
        forge.util.hexToBytes(r.serial_number.length % 2 ? '0' + r.serial_number : r.serial_number)),
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.GENERALIZEDTIME, false,
        dateToGeneralizedTime(revDate)),
    ]);
  });

  const tbsCrlContents: forge.asn1.Asn1[] = [
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false,
        forge.asn1.oidToDer(forge.pki.oids['sha256WithRSAEncryption']).getBytes()),
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.NULL, false, ''),
    ]),
    issuerAsn1,
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.GENERALIZEDTIME, false, dateToGeneralizedTime(now)),
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.GENERALIZEDTIME, false, dateToGeneralizedTime(nextUpdate)),
  ];

  if (revokedList.length > 0) {
    tbsCrlContents.push(
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, revokedList)
    );
  }

  const tbsCrl = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, tbsCrlContents);

  const tbsDer = forge.asn1.toDer(tbsCrl);
  const md = forge.md.sha256.create();
  md.update(tbsDer.getBytes());
  const sigBytes = intermediateCA.privateKey.sign(md);

  const crlAsn1 = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    tbsCrl,
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false,
        forge.asn1.oidToDer(forge.pki.oids['sha256WithRSAEncryption']).getBytes()),
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.NULL, false, ''),
    ]),
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.BITSTRING, false, '\x00' + sigBytes),
  ]);

  cachedCrlDer = Buffer.from(forge.asn1.toDer(crlAsn1).getBytes(), 'binary');
  crlGeneratedAt = new Date();
  return cachedCrlDer;
}

export function getCachedCRL(): Buffer | null {
  if (!cachedCrlDer || !crlGeneratedAt) return null;
  const ageMs = Date.now() - crlGeneratedAt.getTime();
  if (ageMs > 25 * 60 * 60 * 1000) return null;
  return cachedCrlDer;
}

export async function handleOCSP(_requestBody: Buffer): Promise<Buffer> {
  return Buffer.from([0x30, 0x03, 0x0a, 0x01, 0x00]);
}
