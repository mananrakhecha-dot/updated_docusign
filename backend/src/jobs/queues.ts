import { Queue, Worker, QueueEvents } from 'bullmq';
import { sendSigningInvitation, sendCompletionEmail } from './emailService';
import { generateCRL } from '../ca/crl';
import { checkAndRenewCertificates } from '../ca/certIssuer';

const connection = {
  host: process.env.REDIS_URL?.replace('redis://', '').split(':')[0] || 'localhost',
  port: parseInt(process.env.REDIS_URL?.split(':').pop() || '6379'),
};

export const emailQueue = new Queue('email', { connection });
export const crlQueue = new Queue('crl-refresh', { connection });
export const cocQueue = new Queue('certificate-of-completion', { connection });

let workersInitialized = false;

export function initWorkers(): void {
  if (workersInitialized) return;
  workersInitialized = true;

  // Email worker
  new Worker('email', async (job) => {
    const { type, data } = job.data;
    switch (type) {
      case 'signing-invitation':
        await sendSigningInvitation(
          data.recipientEmail, data.recipientName, data.senderName,
          data.subject, data.message, data.signingToken
        );
        break;
      case 'completion':
        await sendCompletionEmail(data.email, data.name, data.subject, data.envelopeId);
        break;
    }
  }, { connection });

  // CRL refresh worker
  new Worker('crl-refresh', async () => {
    console.log('[CRL] Refreshing CRL...');
    await generateCRL();
    await checkAndRenewCertificates();
    console.log('[CRL] Refresh complete');
  }, { connection });

  // Certificate of Completion worker
  new Worker('certificate-of-completion', async (job) => {
    const { envelopeId } = job.data;
    const { generateCertificateOfCompletion } = await import('../modules/completion/completionService');
    await generateCertificateOfCompletion(envelopeId);
  }, { connection });

  console.log('[Jobs] Workers initialized');
}

export async function scheduleRecurringJobs(): Promise<void> {
  // CRL refresh every 24 hours
  await crlQueue.add('refresh', {}, {
    repeat: { every: 24 * 60 * 60 * 1000 },
    jobId: 'crl-daily-refresh',
  });
  console.log('[Jobs] CRL refresh scheduled (24h)');
}
