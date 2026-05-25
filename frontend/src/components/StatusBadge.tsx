import React from 'react';

const statusConfig: Record<string, { label: string; className: string }> = {
  DRAFT: { label: 'Draft', className: 'bg-gray-100 text-gray-700' },
  SENT: { label: 'Sent', className: 'bg-blue-100 text-blue-700' },
  DELIVERED: { label: 'Delivered', className: 'bg-purple-100 text-purple-700' },
  COMPLETED: { label: 'Completed', className: 'bg-green-100 text-green-700' },
  DECLINED: { label: 'Declined', className: 'bg-red-100 text-red-700' },
  VOIDED: { label: 'Voided', className: 'bg-gray-100 text-gray-500' },
  TAMPERED: { label: 'Tampered', className: 'bg-red-200 text-red-800 font-bold' },
  PENDING: { label: 'Pending', className: 'bg-yellow-100 text-yellow-700' },
  SIGNED: { label: 'Signed', className: 'bg-green-100 text-green-700' },
};

export function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] || { label: status, className: 'bg-gray-100 text-gray-700' };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.className}`}>
      {config.label}
    </span>
  );
}

export function IdentityBadge({ level }: { level: string }) {
  const config: Record<string, { label: string; className: string }> = {
    NONE: { label: 'Unverified', className: 'bg-gray-100 text-gray-500' },
    SES: { label: 'SES Verified', className: 'bg-blue-100 text-blue-700' },
    AES: { label: 'AES Verified', className: 'bg-green-100 text-green-700' },
  };
  const c = config[level] || config.NONE;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${c.className}`}>
      {c.label}
    </span>
  );
}
