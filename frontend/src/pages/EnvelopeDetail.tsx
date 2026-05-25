import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { StatusBadge } from '../components/StatusBadge';
import { Timeline } from '../components/Timeline';
import { TrustIndicator } from '../components/TrustIndicator';
import { envelopeApi, EnvelopeDetail as EnvDetail } from '../api/envelopes';
import { useSocket } from '../hooks/useSocket';
import toast from 'react-hot-toast';

export function EnvelopeDetail() {
  const { id } = useParams<{ id: string }>();
  const { joinEnvelope, on } = useSocket();
  const [envelope, setEnvelope] = useState<EnvDetail | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [voidReason, setVoidReason] = useState('');
  const [showVoid, setShowVoid] = useState(false);

  const fetchData = async () => {
    if (!id) return;
    try {
      const [envRes, histRes] = await Promise.all([
        envelopeApi.get(id),
        envelopeApi.history(id),
      ]);
      setEnvelope(envRes.data);
      setEvents(histRes.data);
    } catch { toast.error('Failed to load envelope'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [id]);

  useEffect(() => {
    if (!id) return;
    joinEnvelope(id);
    const off1 = on('envelope:recipient_signed', () => { fetchData(); toast('A recipient has signed!'); });
    const off2 = on('envelope:completed', () => { fetchData(); toast.success('All parties have signed! Envelope completed.'); });
    return () => { off1(); off2(); };
  }, [id]);

  const handleVoid = async () => {
    if (!id || !voidReason) return;
    try {
      await envelopeApi.void(id, voidReason);
      toast.success('Envelope voided');
      fetchData();
      setShowVoid(false);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed to void'); }
  };

  if (loading) return <Layout><div className="text-center py-16 text-gray-400">Loading...</div></Layout>;
  if (!envelope) return <Layout><div className="text-center py-16 text-gray-400">Envelope not found</div></Layout>;

  const intCA = 'DocuSign Internal CA'; // Could fetch from server

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Link to="/dashboard" className="text-gray-400 hover:text-gray-600 text-sm">← Dashboard</Link>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">{envelope.subject}</h1>
            <div className="flex items-center gap-3 mt-2">
              <StatusBadge status={envelope.status} />
              <span className="text-sm text-gray-400">ID: {envelope.id.slice(0, 8)}...</span>
              <span className="text-sm text-gray-400">{new Date(envelope.created_at).toLocaleDateString('en-IN')}</span>
            </div>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {envelope.status === 'COMPLETED' && (
              <>
                <a href={envelopeApi.downloadUrl(id!)} className="btn-secondary text-sm">⬇ Download PDF</a>
                <a href={envelopeApi.certificateUrl(id!)} className="btn-primary text-sm">📜 Certificate</a>
              </>
            )}
            {['DRAFT', 'SENT', 'DELIVERED'].includes(envelope.status) && (
              <button className="btn-danger text-sm" onClick={() => setShowVoid(!showVoid)}>
                Void Envelope
              </button>
            )}
          </div>
        </div>

        {showVoid && (
          <div className="card bg-red-50 border-red-200">
            <h3 className="font-semibold text-red-800 mb-3">Void Envelope</h3>
            <input className="input mb-3" type="text" placeholder="Reason for voiding..."
              value={voidReason} onChange={e => setVoidReason(e.target.value)} />
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={() => setShowVoid(false)}>Cancel</button>
              <button className="btn-danger" onClick={handleVoid} disabled={!voidReason}>Void</button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Recipients */}
          <div className="lg:col-span-2 space-y-4">
            <div className="card">
              <h2 className="font-semibold text-gray-900 mb-4">Recipients</h2>
              <div className="space-y-3">
                {envelope.recipients.map((r) => (
                  <div key={r.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="font-medium text-gray-900">{r.full_name}</p>
                        <p className="text-sm text-gray-500">{r.user_email}</p>
                      </div>
                      <StatusBadge status={r.status} />
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs text-gray-500">
                      <div>
                        <p className="font-medium text-gray-600">Sent</p>
                        <p>{envelope.status !== 'DRAFT' ? '✓' : '—'}</p>
                      </div>
                      <div>
                        <p className="font-medium text-gray-600">Viewed</p>
                        <p>{r.viewed_at ? new Date(r.viewed_at).toLocaleDateString('en-IN') : '—'}</p>
                      </div>
                      <div>
                        <p className="font-medium text-gray-600">Signed</p>
                        <p>{r.signed_at ? new Date(r.signed_at).toLocaleDateString('en-IN') : '—'}</p>
                      </div>
                    </div>
                    {r.status === 'SIGNED' && (
                      <div className="mt-3">
                        <TrustIndicator
                          signerName={r.full_name}
                          signerEmail={r.user_email}
                          caName={intCA}
                          signedAt={r.signed_at!}
                          identityLevel={r.auth_required}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Documents */}
            <div className="card">
              <h2 className="font-semibold text-gray-900 mb-3">Document</h2>
              {envelope.documents.map((doc) => (
                <div key={doc.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="text-2xl">📄</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">{doc.file_name}</p>
                    <p className="text-xs text-gray-400 font-mono truncate">SHA-256: {doc.sha256_hash}</p>
                    <p className="text-xs text-gray-400">{doc.page_count} pages</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Timeline */}
          <div className="card">
            <h2 className="font-semibold text-gray-900 mb-4">Audit Trail</h2>
            <Timeline events={events} />
          </div>
        </div>
      </div>
    </Layout>
  );
}
