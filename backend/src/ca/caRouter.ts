import { Router, Request, Response, NextFunction } from 'express';
import { generateCRL, getCachedCRL, handleOCSP } from './crl';
import { loadPlainPem } from './caStore';
import { requireAuth, requireAdmin } from '../middleware/auth';

const router = Router();

// Download Root CA cert
router.get('/root-cert', (req: Request, res: Response) => {
  const pem = loadPlainPem('root-ca-cert.pem');
  if (!pem) { res.status(404).json({ error: 'Root CA not found' }); return; }
  res.setHeader('Content-Type', 'application/x-pem-file');
  res.send(pem);
});

// Download Intermediate CA cert
router.get('/intermediate-cert', (req: Request, res: Response) => {
  const pem = loadPlainPem('intermediate-ca-cert.pem');
  if (!pem) { res.status(404).json({ error: 'Intermediate CA not found' }); return; }
  res.setHeader('Content-Type', 'application/x-pem-file');
  res.send(pem);
});

// CRL endpoint
router.get('/crl', async (req: Request, res: Response, next: NextFunction) => {
  try {
    let crl = getCachedCRL();
    if (!crl) crl = await generateCRL();
    res.setHeader('Content-Type', 'application/pkix-crl');
    res.send(crl);
  } catch (err) { next(err); }
});

// OCSP endpoint
router.post('/ocsp', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const response = await handleOCSP(req.body);
    res.setHeader('Content-Type', 'application/ocsp-response');
    res.send(response);
  } catch (err) { next(err); }
});

export default router;
