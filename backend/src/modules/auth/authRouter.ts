import { Router, Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import {
  registerUser, loginUser, verifyEmail,
  refreshAccessToken, logoutUser, acceptEDisclosure
} from './authService';
import { sendOTP, verifyOTP } from './otpService';
import { requireAuth } from '../../middleware/auth';
import { authLimiter, otpLimiter } from '../../middleware/rateLimiter';
import { sendVerificationEmail } from '../../jobs/emailService';

const router = Router();

router.post('/register', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, full_name } = req.body;
    if (!email || !password || !full_name) {
      res.status(400).json({ error: 'email, password, and full_name are required' });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }
    const user = await registerUser(email, password, full_name) as any;
    await sendVerificationEmail(user.email, user.full_name, user._verifyToken);
    res.status(201).json({ message: 'Registration successful. Please check your email to verify your account.' });
  } catch (err) { next(err); }
});

router.get('/verify-email', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.query as { token: string };
    if (!token) { res.status(400).json({ error: 'Token required' }); return; }
    await verifyEmail(token);
    res.redirect(`${process.env.FRONTEND_URL}/login?verified=1`);
  } catch (err) { next(err); }
});

router.post('/login', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) { res.status(400).json({ error: 'email and password required' }); return; }
    const result = await loginUser(email, password);
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.json({ user: result.user, accessToken: result.accessToken });
  } catch (err) { next(err); }
});

router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) { res.status(401).json({ error: 'No refresh token' }); return; }
    const result = await refreshAccessToken(refreshToken);
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/logout', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (refreshToken) await logoutUser(refreshToken);
    res.clearCookie('refreshToken');
    res.json({ message: 'Logged out' });
  } catch (err) { next(err); }
});

router.post('/edisclosure', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await acceptEDisclosure(req.user!.userId);
    res.json({ message: 'eDisclosure accepted' });
  } catch (err) { next(err); }
});

router.post('/otp/send', requireAuth, otpLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { phone_number } = req.body;
    if (!phone_number) { res.status(400).json({ error: 'phone_number required' }); return; }
    await sendOTP(req.user!.userId, phone_number);
    res.json({ message: 'OTP sent' });
  } catch (err) { next(err); }
});

router.post('/otp/verify', requireAuth, otpLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { otp_code } = req.body;
    if (!otp_code) { res.status(400).json({ error: 'otp_code required' }); return; }
    await verifyOTP(req.user!.userId, otp_code);
    res.json({ message: 'Phone verified' });
  } catch (err) { next(err); }
});

router.get('/me', requireAuth, async (req: Request, res: Response) => {
  const { rows } = await (await import('../../db/pool')).query(
    'SELECT id, email, full_name, role, identity_level, edisclosure_accepted, phone_verified, phone_number FROM users WHERE id=$1',
    [req.user!.userId]
  );
  res.json(rows[0] || null);
});

export default router;
