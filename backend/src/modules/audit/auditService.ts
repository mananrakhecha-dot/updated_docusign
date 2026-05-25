import { query } from '../../db/pool';

interface AuditEvent {
  envelopeId?: string;
  recipientEmail?: string;
  eventType: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
}

export async function logEvent(event: AuditEvent): Promise<void> {
  await query(
    `INSERT INTO audit_events (envelope_id, recipient_email, event_type, ip_address, user_agent, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      event.envelopeId || null,
      event.recipientEmail || null,
      event.eventType,
      event.ipAddress || null,
      event.userAgent || null,
      JSON.stringify(event.metadata || {}),
    ]
  );
}
