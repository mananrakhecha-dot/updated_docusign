import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { query } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function sendOTP(userId: string, phoneNumber: string): Promise<void> {
  const otp = generateOTP();
  const otpHash = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await query(
    `INSERT INTO otp_sessions (user_id, phone_number, otp_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, phoneNumber, otpHash, expiresAt]
  );

  await query('UPDATE users SET phone_number=$1, updated_at=now() WHERE id=$2', [phoneNumber, userId]);

  if (process.env.NODE_ENV === 'development' || !process.env.TWILIO_ACCOUNT_SID) {
    console.log(`[OTP] Code for ${phoneNumber}: ${otp}`);
    return;
  }

  const twilio = await import('twilio');
  const client = twilio.default(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
  await client.messages.create({
    body: `Your DocuSign verification code is: ${otp}. Valid for 10 minutes.`,
    from: process.env.TWILIO_PHONE_NUMBER!,
    to: phoneNumber,
  });
}

export async function verifyOTP(userId: string, otpCode: string): Promise<void> {
  const { rows } = await query<any>(
    `SELECT * FROM otp_sessions
     WHERE user_id=$1 AND verified=false AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );

  if (rows.length === 0) throw new AppError('No active OTP session found', 400);
  const session = rows[0];

  if (session.attempts >= 3) throw new AppError('Too many OTP attempts', 429);

  await query('UPDATE otp_sessions SET attempts=attempts+1 WHERE id=$1', [session.id]);

  const valid = await bcrypt.compare(otpCode, session.otp_hash);
  if (!valid) throw new AppError('Invalid OTP code', 400);

  await query('UPDATE otp_sessions SET verified=true WHERE id=$1', [session.id]);
  await query('UPDATE users SET phone_verified=true, updated_at=now() WHERE id=$1', [userId]);
}

export async function promoteToAES(userId: string): Promise<void> {
  // Called after OTP verified + ID approved
  await query(
    `UPDATE users SET identity_level='AES', updated_at=now() WHERE id=$1`,
    [userId]
  );
}
