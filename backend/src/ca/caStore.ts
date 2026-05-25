import forge from 'node-forge';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface CAKeys {
  cert: forge.pki.Certificate;
  privateKey: forge.pki.rsa.PrivateKey;
  certPem: string;
  keyPem: string;
}

const CA_DIR = process.env.CA_DIR || './ca-store';

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function encryptPem(pem: string, passphrase: string): string {
  const key = crypto.scryptSync(passphrase, 'digsign-ca-salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(pem, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decryptPem(encrypted: string, passphrase: string): string {
  const [ivHex, encHex] = encrypted.split(':');
  const key = crypto.scryptSync(passphrase, 'digsign-ca-salt', 32);
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}

export function saveEncryptedPem(filename: string, pem: string, passphrase: string): void {
  ensureDir(CA_DIR);
  const enc = encryptPem(pem, passphrase);
  fs.writeFileSync(path.join(CA_DIR, filename), enc, 'utf8');
}

export function loadEncryptedPem(filename: string, passphrase: string): string | null {
  const filePath = path.join(CA_DIR, filename);
  if (!fs.existsSync(filePath)) return null;
  const enc = fs.readFileSync(filePath, 'utf8');
  return decryptPem(enc, passphrase);
}

export function savePlainPem(filename: string, pem: string): void {
  ensureDir(CA_DIR);
  fs.writeFileSync(path.join(CA_DIR, filename), pem, 'utf8');
}

export function loadPlainPem(filename: string): string | null {
  const filePath = path.join(CA_DIR, filename);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
}

export function caExists(): boolean {
  return (
    fs.existsSync(path.join(CA_DIR, 'root-ca.enc')) &&
    fs.existsSync(path.join(CA_DIR, 'intermediate-ca.enc'))
  );
}

let _intermediateCA: CAKeys | null = null;

export function setIntermediateCA(ca: CAKeys): void {
  _intermediateCA = ca;
}

export function getIntermediateCA(): CAKeys {
  if (!_intermediateCA) throw new Error('Intermediate CA not loaded');
  return _intermediateCA;
}

export function getRootCertPem(): string {
  const pem = loadPlainPem('root-ca-cert.pem');
  if (!pem) throw new Error('Root CA cert not found');
  return pem;
}
