import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { requireAuth } from '../../middleware/auth';
import {
  createEnvelope, updateRecipients, saveFields,
  sendEnvelope, voidEnvelope, listEnvelopes, getEnvelopeDetail
} from './envelopeService';
import { query } from '../../db/pool';
import { readFile } from '../storage';
import path from 'path';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'));
  },
});

router.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const envelopes = await listEnvelopes(req.user!.userId);
    res.json(envelopes);
  } catch (err) { next(err); }
});

router.post('/', requireAuth, upload.single('document'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'PDF file required' }); return; }
    const { subject, message } = req.body;
    if (!subject) { res.status(400).json({ error: 'subject required' }); return; }
    const result = await createEnvelope(
      req.user!.userId, subject, message || '',
      req.file.buffer, req.file.originalname
    );
    res.status(201).json(result);
  } catch (err) { next(err); }
});

router.get('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const detail = await getEnvelopeDetail(req.params.id, req.user!.userId);
    res.json(detail);
  } catch (err) { next(err); }
});

router.patch('/:id/recipients', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { recipients } = req.body;
    if (!Array.isArray(recipients)) { res.status(400).json({ error: 'recipients array required' }); return; }
    await updateRecipients(req.params.id, req.user!.userId, recipients);
    res.json({ message: 'Recipients updated' });
  } catch (err) { next(err); }
});

router.patch('/:id/fields', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { fields } = req.body;
    if (!Array.isArray(fields)) { res.status(400).json({ error: 'fields array required' }); return; }
    await saveFields(req.params.id, req.user!.userId, fields);
    res.json({ message: 'Fields saved' });
  } catch (err) { next(err); }
});

router.post('/:id/send', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await sendEnvelope(req.params.id, req.user!.userId);
    res.json({ message: 'Envelope sent' });
  } catch (err) { next(err); }
});

router.post('/:id/void', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { reason } = req.body;
    if (!reason) { res.status(400).json({ error: 'reason required' }); return; }
    await voidEnvelope(req.params.id, req.user!.userId, reason);
    res.json({ message: 'Envelope voided' });
  } catch (err) { next(err); }
});

router.get('/:id/history', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await query(
      'SELECT * FROM audit_events WHERE envelope_id=$1 ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/:id/status', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows: env } = await query<any>('SELECT status, completed_at FROM envelopes WHERE id=$1', [req.params.id]);
    const { rows: recipients } = await query<any>(
      'SELECT user_email, full_name, status, signed_at, viewed_at, auth_required FROM envelope_recipients WHERE envelope_id=$1 ORDER BY order_index',
      [req.params.id]
    );
    res.json({ status: env[0]?.status, completed_at: env[0]?.completed_at, recipients });
  } catch (err) { next(err); }
});

// Download signed PDF
router.get('/:id/download', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await query<any>(
      `SELECT ed.* FROM envelope_documents ed
       JOIN envelopes e ON ed.envelope_id=e.id
       WHERE ed.envelope_id=$1
       LIMIT 1`,
      [req.params.id]
    );
    if (!rows[0]) { res.status(404).json({ error: 'Document not found' }); return; }
    const buf = readFile(rows[0].file_path, true);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${rows[0].file_name}"`);
    res.send(buf);
  } catch (err) { next(err); }
});

// Download Certificate of Completion
router.get('/:id/certificate', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await query<any>('SELECT completion_cert_path FROM envelopes WHERE id=$1', [req.params.id]);
    if (!rows[0]?.completion_cert_path) { res.status(404).json({ error: 'Certificate not available yet' }); return; }
    const buf = readFile(rows[0].completion_cert_path, true);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="certificate-of-completion.pdf"');
    res.send(buf);
  } catch (err) { next(err); }
});

export default router;
