import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { query } from '../../db/pool';
import { issueLeafCertificate } from '../../ca/certIssuer';
import { AppError } from '../../middleware/errorHandler';

const BCRYPT_ROUNDS = 12;

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: string;
  identity_level: string;
  edisclosure_accepted: boolean;
  phone_verified: boolean;
}

export async function registerUser(email: string, password: string, fullName: string, edisclosure = false): Promise<User> {
  const existing = await query('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
  if (existing.rows.length > 0) throw new AppError('Email already registered', 409);

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const verifyToken = crypto.randomUUID();
  const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const { rows } = await query<User>(
    `INSERT INTO users (email, password_hash, full_name, email_verify_token, email_verify_expires,
       edisclosure_accepted, edisclosure_accepted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, email, full_name, role, identity_level, edisclosure_accepted, phone_verified`,
    [email.toLowerCase(), passwordHash, fullName, verifyToken, verifyExpires,
     edisclosure, edisclosure ? new Date() : null]
  );

  return { ...rows[0], _verifyToken: verifyToken } as any;
}

export async function verifyEmail(token: string): Promise<void> {
  const { rows } = await query(
    `UPDATE users SET email_verified=true, identity_level=CASE WHEN edisclosure_accepted THEN 'SES' ELSE identity_level END,
     email_verify_token=NULL, updated_at=now()
     WHERE email_verify_token=$1 AND email_verify_expires > now() RETURNING id`,
    [token]
  );
  if (rows.length === 0) throw new AppError('Invalid or expired verification token', 400);
}

export async function loginUser(email: string, password: string): Promise<{ user: User; accessToken: string; refreshToken: string }> {
  const { rows } = await query<any>(
    'SELECT * FROM users WHERE email=$1',
    [email.toLowerCase()]
  );
  const user = rows[0];
  if (!user) throw new AppError('Invalid credentials', 401);

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw new AppError('Invalid credentials', 401);

  if (!user.email_verified) throw new AppError('Please verify your email first', 403);

  // Issue cert if not present and email is verified
  if (!user.cert_pem && user.identity_level !== 'NONE') {
    await issueLeafCertificate(user.id, user.email, user.full_name);
  }

  const accessToken = generateAccessToken(user);
  const refreshToken = await generateRefreshToken(user.id);

  return {
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      identity_level: user.identity_level,
      edisclosure_accepted: user.edisclosure_accepted,
      phone_verified: user.phone_verified,
    },
    accessToken,
    refreshToken,
  };
}

export async function acceptEDisclosure(userId: string): Promise<void> {
  await query(
    `UPDATE users SET edisclosure_accepted=true, edisclosure_accepted_at=now(),
     identity_level=CASE WHEN email_verified=true THEN 'SES' ELSE identity_level END,
     updated_at=now() WHERE id=$1`,
    [userId]
  );

  const { rows } = await query<{ id: string; email: string; full_name: string; cert_pem: string }>(
    'SELECT id, email, full_name, cert_pem FROM users WHERE id=$1',
    [userId]
  );
  if (rows[0] && !rows[0].cert_pem) {
    await issueLeafCertificate(rows[0].id, rows[0].email, rows[0].full_name);
  }
}

function generateAccessToken(user: any): string {
  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role, identityLevel: user.identity_level },
    process.env.JWT_SECRET!,
    { expiresIn: '15m' }
  );
}

async function generateRefreshToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(48).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await query(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, tokenHash, expiresAt]
  );

  return token;
}

export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string }> {
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const { rows } = await query<any>(
    `SELECT rt.*, u.id as uid, u.email, u.role, u.identity_level, u.full_name
     FROM refresh_tokens rt JOIN users u ON rt.user_id=u.id
     WHERE rt.token_hash=$1 AND rt.expires_at > now()`,
    [tokenHash]
  );
  if (rows.length === 0) throw new AppError('Invalid or expired refresh token', 401);

  const user = rows[0];
  const accessToken = generateAccessToken({ id: user.uid, email: user.email, role: user.role, identity_level: user.identity_level });
  return { accessToken };
}

export async function logoutUser(refreshToken: string): Promise<void> {
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  await query('DELETE FROM refresh_tokens WHERE token_hash=$1', [tokenHash]);
}
