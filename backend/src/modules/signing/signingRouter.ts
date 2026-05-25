import { Router, Request, Response, NextFunction } from 'express';
import { getSigningContext, completeSigningCeremony, declineEnvelope } from './signingService';
import { readFile } from '../storage';
import { query } from '../../db/pool';
import { logEvent } from '../audit/auditService';

const router = Router();

// Get signing context (document + fields for this recipient)
router.get('/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ip = req.ip || req.socket?.remoteAddress || '';
    const ua = req.headers['user-agent'] || '';
    const context = await getSigningContext(req.params.token, ip, ua);
    res.json(context);
  } catch (err) { next(err); }
});

// Serve the PDF for viewing (decrypted, streaming)
router.get('/:token/document', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { decodeSigningToken } = await import('./signingService');
    const payload = decodeSigningToken(req.params.token);
    const { rows } = await query<any>(
      'SELECT * FROM envelope_documents WHERE envelope_id=$1 LIMIT 1',
      [payload.envelopeId]
    );
    if (!rows[0]) { res.status(404).json({ error: 'Document not found' }); return; }
    const buf = readFile(rows[0].file_path, true);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', buf.length);
    res.send(buf);
  } catch (err) { next(err); }
});

// Complete signing ceremony
router.post('/:token/complete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ip = req.ip || req.socket?.remoteAddress || '';
    const ua = req.headers['user-agent'] || '';
    const { signature_data, otp_code } = req.body;
    await completeSigningCeremony(req.params.token, signature_data || {}, ip, ua, otp_code);
    res.json({ message: 'Document signed successfully' });
  } catch (err) { next(err); }
});

// Decline signing
router.post('/:token/decline', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ip = req.ip || req.socket?.remoteAddress || '';
    const { reason } = req.body;
    if (!reason) { res.status(400).json({ error: 'reason required' }); return; }
    await declineEnvelope(req.params.token, reason, ip);
    res.json({ message: 'Document declined' });
  } catch (err) { next(err); }
});

export default router;
