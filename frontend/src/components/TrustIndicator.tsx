import React from 'react';

interface TrustIndicatorProps {
  signerName: string;
  signerEmail: string;
  caName: string;
  signedAt: string;
  identityLevel: string;
}

export function TrustIndicator({ signerName, signerEmail, caName, signedAt, identityLevel }: TrustIndicatorProps) {
  return (
    <div className="flex items-start gap-3 bg-green-50 border border-green-200 rounded-lg p-4">
      {/* Green checkmark badge */}
      <div className="flex-shrink-0 w-10 h-10 bg-green-600 rounded-full flex items-center justify-center">
        <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-green-800">Digitally Signed</p>
        <p className="text-sm text-green-700 font-medium truncate">{signerName}</p>
        <p className="text-xs text-green-600 truncate">{signerEmail}</p>
        <p className="text-xs text-gray-500 mt-1">
          {new Date(signedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
        </p>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-xs text-gray-400">Verified by: {caName}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${identityLevel === 'AES' ? 'bg-green-200 text-green-800' : 'bg-blue-100 text-blue-700'}`}>
            {identityLevel}
          </span>
        </div>
      </div>
    </div>
  );
}
