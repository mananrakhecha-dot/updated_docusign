import React from 'react';

interface AuditEvent {
  id: string;
  event_type: string;
  recipient_email?: string;
  ip_address?: string;
  metadata?: any;
  created_at: string;
}

const eventConfig: Record<string, { icon: string; label: string; color: string }> = {
  envelope_created: { icon: '📄', label: 'Envelope Created', color: 'text-gray-600' },
  envelope_sent: { icon: '📨', label: 'Sent to Recipient', color: 'text-blue-600' },
  signing_link_opened: { icon: '👁', label: 'Document Viewed', color: 'text-purple-600' },
  edisclosure_accepted: { icon: '✅', label: 'eDisclosure Accepted', color: 'text-green-600' },
  identity_verified: { icon: '🔐', label: 'Identity Verified', color: 'text-green-600' },
  pre_sign_hash: { icon: '🔒', label: 'Document Hash Captured', color: 'text-gray-500' },
  signed: { icon: '✍️', label: 'Document Signed', color: 'text-green-700' },
  envelope_completed: { icon: '🎉', label: 'Envelope Completed', color: 'text-green-700' },
  envelope_declined: { icon: '❌', label: 'Signing Declined', color: 'text-red-600' },
  envelope_voided: { icon: '🚫', label: 'Envelope Voided', color: 'text-gray-500' },
  download: { icon: '⬇️', label: 'Document Downloaded', color: 'text-blue-500' },
  certificate_generated: { icon: '📜', label: 'Certificate Generated', color: 'text-green-600' },
  otp_sent: { icon: '📱', label: 'OTP Sent', color: 'text-blue-500' },
  otp_verified: { icon: '📱', label: 'OTP Verified', color: 'text-green-600' },
  id_upload: { icon: '🪪', label: 'ID Uploaded', color: 'text-blue-600' },
  id_approved: { icon: '✅', label: 'ID Approved', color: 'text-green-600' },
  id_rejected: { icon: '❌', label: 'ID Rejected', color: 'text-red-600' },
};

export function Timeline({ events }: { events: AuditEvent[] }) {
  if (!events?.length) {
    return <p className="text-gray-400 text-sm text-center py-8">No events yet</p>;
  }

  return (
    <div className="flow-root">
      <ul className="-mb-8">
        {events.map((event, idx) => {
          const config = eventConfig[event.event_type] || { icon: '•', label: event.event_type, color: 'text-gray-500' };
          return (
            <li key={event.id}>
              <div className="relative pb-8">
                {idx !== events.length - 1 && (
                  <span className="absolute left-4 top-4 -ml-px h-full w-0.5 bg-gray-200" aria-hidden="true" />
                )}
                <div className="relative flex space-x-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white border-2 border-gray-200 text-sm flex-shrink-0">
                    {config.icon}
                  </div>
                  <div className="flex min-w-0 flex-1 justify-between space-x-4 pt-1">
                    <div>
                      <p className={`text-sm font-medium ${config.color}`}>{config.label}</p>
                      {event.recipient_email && (
                        <p className="text-xs text-gray-400">{event.recipient_email}</p>
                      )}
                      {event.ip_address && (
                        <p className="text-xs text-gray-400">IP: {event.ip_address}</p>
                      )}
                    </div>
                    <div className="whitespace-nowrap text-right text-xs text-gray-400">
                      {new Date(event.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                    </div>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
