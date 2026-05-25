import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { requireAuth, requireAdmin } from '../../middleware/auth';
import { query } from '../../db/pool';
import { saveFile, readFile } from '../storage';
import { promoteToAES } from '../auth/otpService';
import { logEvent } from '../audit/auditService';
import { AppError } from '../../middleware/errorHandler';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/jpg'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG/PNG images allowed for ID upload'));
  },
});

// Upload government ID
router.post('/id-upload', requireAuth, upload.single('id_document'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'Image file required' }); return; }

    const filename = `${crypto.randomUUID()}${path.extname(req.file.originalname)}`;
    const filePath = saveFile('id-uploads', filename, req.file.buffer, true);

    const { rows } = await query<{ id: string }>(
      `INSERT INTO id_uploads (user_id, file_path, file_name) VALUES ($1, $2, $3) RETURNING id`,
      [req.user!.userId, filePath, req.file.originalname]
    );

    await logEvent({ eventType: 'id_upload', recipientEmail: req.user!.email, metadata: { uploadId: rows[0].id } });
    res.status(201).json({ message: 'ID uploaded for review', uploadId: rows[0].id });
  } catch (err) { next(err); }
});

// List pending ID reviews (admin only)
router.get('/id-reviews', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await query<any>(
      `SELECT idu.*, u.email, u.full_name, u.phone_verified, u.identity_level
       FROM id_uploads idu JOIN users u ON idu.user_id=u.id
       WHERE idu.status='PENDING' ORDER BY idu.created_at ASC`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// Serve ID image for admin review
router.get('/id-reviews/:uploadId/image', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await query<any>('SELECT * FROM id_uploads WHERE id=$1', [req.params.uploadId]);
    if (!rows[0]) { res.status(404).json({ error: 'Upload not found' }); return; }
    const buf = readFile(rows[0].file_path, true);
    const ext = path.extname(rows[0].file_name).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.send(buf);
  } catch (err) { next(err); }
});

// Approve ID
router.post('/id-reviews/:uploadId/approve', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await query<any>(
      `UPDATE id_uploads SET status='APPROVED', reviewed_by=$1, reviewed_at=now()
       WHERE id=$2 RETURNING user_id`,
      [req.user!.userId, req.params.uploadId]
    );
    if (!rows[0]) throw new AppError('Upload not found', 404);

    // Check if phone is also verified — if so, promote to AES
    const { rows: users } = await query<any>(
      'SELECT phone_verified FROM users WHERE id=$1',
      [rows[0].user_id]
    );
    if (users[0]?.phone_verified) {
      await promoteToAES(rows[0].user_id);
    }
    await logEvent({ eventType: 'id_approved', metadata: { uploadId: req.params.uploadId, reviewedBy: req.user!.userId } });
    res.json({ message: 'ID approved' });
  } catch (err) { next(err); }
});

// Reject ID
router.post('/id-reviews/:uploadId/reject', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { reason } = req.body;
    await query(
      `UPDATE id_uploads SET status='REJECTED', reviewed_by=$1, reviewed_at=now(), reject_reason=$2
       WHERE id=$3`,
      [req.user!.userId, reason || 'Rejected by admin', req.params.uploadId]
    );
    await logEvent({ eventType: 'id_rejected', metadata: { uploadId: req.params.uploadId, reason } });
    res.json({ message: 'ID rejected' });
  } catch (err) { next(err); }
});

// List all users (admin)
router.get('/users', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await query<any>(
      'SELECT id, email, full_name, role, identity_level, phone_verified, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) { next(err); }
});

export default router;
