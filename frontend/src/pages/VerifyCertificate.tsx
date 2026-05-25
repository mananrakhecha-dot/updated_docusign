import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { verifyApi } from '../api/envelopes';
import { StatusBadge } from '../components/StatusBadge';

export function VerifyCertificate() {
  const { envelopeId } = useParams<{ envelopeId: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!envelopeId) return;
    verifyApi.verify(envelopeId)
      .then(res => setData(res.data))
      .catch(() => setError('Envelope not found or verification failed'))
      .finally(() => setLoading(false));
  }, [envelopeId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-green-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500">Verifying certificate...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Verification Failed</h2>
          <p className="text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="bg-green-600 text-white rounded-t-xl p-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-xl font-bold">Certificate Verified</h1>
          </div>
          <p className="text-green-100 text-sm">This document has been digitally signed and verified by the DocuSign Internal CA.</p>
        </div>

        <div className="bg-white rounded-b-xl shadow-sm border border-gray-200 border-t-0 p-6 space-y-6">
          {/* Envelope Details */}
          <div>
            <h2 className="font-semibold text-gray-900 mb-3">Envelope Details</h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-gray-500">ID</p>
                <p className="font-mono text-gray-700 text-xs break-all">{data.envelopeId}</p>
              </div>
              <div>
                <p className="text-gray-500">Status</p>
                <StatusBadge status={data.status} />
              </div>
              <div>
                <p className="text-gray-500">Subject</p>
                <p className="font-medium text-gray-900">{data.subject}</p>
              </div>
              <div>
                <p className="text-gray-500">Completed</p>
                <p className="text-gray-700">{data.completedAt ? new Date(data.completedAt).toLocaleString('en-IN') : '—'}</p>
              </div>
            </div>
          </div>

          {/* Document integrity */}
          {data.document && (
            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Document Integrity</h3>
              <p className="text-sm text-gray-600 font-medium">{data.document.name}</p>
              <div className="mt-1">
                <p className="text-xs text-gray-500">SHA-256 Hash:</p>
                <p className="text-xs font-mono text-gray-700 break-all">{data.document.sha256Hash}</p>
              </div>
            </div>
          )}

          {/* Signers */}
          <div>
            <h2 className="font-semibold text-gray-900 mb-3">Signers</h2>
            <div className="space-y-3">
              {data.signers?.map((signer: any, i: number) => (
                <div key={i} className={`border rounded-lg p-4 ${signer.status === 'SIGNED' ? 'border-green-200 bg-green-50' : 'border-gray-200'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-medium text-gray-900">{signer.name}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${signer.status === 'SIGNED' ? 'bg-green-200 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                      {signer.status}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500">{signer.email}</p>
                  <div className="flex gap-4 mt-2 text-xs text-gray-500">
                    <span>Identity: <strong className="text-gray-700">{signer.identityLevel}</strong></span>
                    {signer.signedAt && <span>Signed: <strong className="text-gray-700">{new Date(signer.signedAt).toLocaleString('en-IN')}</strong></span>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sender */}
          <div className="border-t border-gray-200 pt-4 text-sm text-gray-500">
            <p>Sent by: <strong className="text-gray-700">{data.sender?.name}</strong> ({data.sender?.email})</p>
          </div>
        </div>
      </div>
    </div>
  );
}
