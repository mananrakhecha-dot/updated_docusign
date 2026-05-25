import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getStorageKey(): Buffer {
  const keyHex = process.env.STORAGE_ENCRYPTION_KEY!;
  return Buffer.from(keyHex, 'hex');
}

export function encryptFile(plainBuffer: Buffer): Buffer {
  const key = getStorageKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  // Prepend IV (16 bytes) to ciphertext
  return Buffer.concat([iv, encrypted]);
}

export function decryptFile(encryptedBuffer: Buffer): Buffer {
  const key = getStorageKey();
  const iv = encryptedBuffer.slice(0, 16);
  const ciphertext = encryptedBuffer.slice(16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function saveFile(subdir: string, filename: string, data: Buffer, encrypt = true): string {
  const dir = path.join(UPLOAD_DIR, subdir);
  ensureDir(dir);
  const filePath = path.join(dir, filename);
  const toWrite = encrypt ? encryptFile(data) : data;
  fs.writeFileSync(filePath, toWrite);
  return filePath;
}

export function readFile(filePath: string, encrypted = true): Buffer {
  const raw = fs.readFileSync(filePath);
  return encrypted ? decryptFile(raw) : raw;
}

export function computeSHA256(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export { UPLOAD_DIR };
