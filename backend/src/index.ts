import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import fs from 'fs';

import { loadCA } from './ca/loader';
import { initWorkers, scheduleRecurringJobs } from './jobs/queues';
import { errorHandler } from './middleware/errorHandler';
import { apiLimiter } from './middleware/rateLimiter';

import authRouter from './modules/auth/authRouter';
import envelopeRouter from './modules/envelopes/envelopeRouter';
import signingRouter from './modules/signing/signingRouter';
import adminRouter from './modules/admin/adminRouter';
import caRouter from './ca/caRouter';
import { getVerificationData } from './modules/completion/completionService';

const app = express();
const httpServer = http.createServer(app);

// Socket.IO
export const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));

app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('dev'));
app.use(apiLimiter);

// Ensure upload dirs exist
['uploads/documents', 'uploads/certificates', 'uploads/id-uploads'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Routes
app.use('/api/auth', authRouter);
app.use('/api/envelopes', envelopeRouter);
app.use('/api/sign', signingRouter);
app.use('/api/admin', adminRouter);
app.use('/api/ca', caRouter);

// Public verification endpoint
app.get('/api/verify/:envelopeId', async (req, res, next) => {
  try {
    const data = await getVerificationData(req.params.envelopeId);
    if (!data) { res.status(404).json({ error: 'Envelope not found' }); return; }
    res.json(data);
  } catch (err) { next(err); }
});

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok', timestamp: new Date() }));

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  socket.on('join:envelope', (envelopeId: string) => {
    socket.join(`envelope:${envelopeId}`);
  });

  socket.on('join:dashboard', (userId: string) => {
    socket.join(`dashboard:${userId}`);
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });
});

// Emit helper (importable by services)
export function emitEnvelopeEvent(envelopeId: string, event: string, data: any): void {
  io.to(`envelope:${envelopeId}`).emit(event, data);
}

app.use(errorHandler);

const PORT = parseInt(process.env.PORT || '3000');

async function start(): Promise<void> {
  try {
    console.log('[App] Starting server...');

    // Load CA
    await loadCA();

    // Initialize BullMQ workers
    initWorkers();
    await scheduleRecurringJobs();

    httpServer.listen(PORT, () => {
      console.log(`[App] Server running on http://localhost:${PORT}`);
      console.log(`[App] Environment: ${process.env.NODE_ENV}`);
    });
  } catch (err) {
    console.error('[App] Failed to start:', err);
    process.exit(1);
  }
}

start();
