import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { signingApi } from '../api/envelopes';
import { SignatureCaptureModal } from '../components/SignatureCaptureModal';
import toast from 'react-hot-toast';

type SigningStep = 'loading' | 'edisclosure' | 'view' | 'done' | 'error' | 'already-signed';

export function SigningCeremony() {
  const { token } = useParams<{ token: string }>();
  const [step, setStep] = useState<SigningStep>('loading');
  const [context, setContext] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [signatureData, setSignatureData] = useState<Record<string, string>>({});
  const [captureFieldId, setCaptureFieldId] = useState<string | null>(null);
  const [declineMode, setDeclineMode] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [otpRequired, setOtpRequired] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;
    signingApi.getContext(token)
      .then(res => {
        setContext(res.data);
        if (res.data.recipient?.status === 'SIGNED') {
          setStep('already-signed');
        } else if (!res.data.userRecord?.edisclosure_accepted) {
          setStep('edisclosure');
        } else if (!res.data.identityGate?.canSign) {
          setStep('error');
          setErrorMsg(`This document requires ${res.data.identityGate?.required} identity verification. Please complete verification first.`);
        } else {
          setStep('view');
        }
      })
      .catch(err => {
        setStep('error');
        setErrorMsg(err.response?.data?.error || 'Failed to load signing session');
      });
  }, [token]);

  const needsCapture = (field: any) => field.field_type === 'signature' || field.field_type === 'initials';

  const handleCaptureConfirm = useCallback((base64: string) => {
    if (!captureFieldId) return;
    setSignatureData(prev => ({ ...prev, [captureFieldId]: base64 }));
    toast.success('Signature captured');
    setCaptureFieldId(null);
  }, [captureFieldId]);

  const handleComplete = async () => {
    if (!token) return;
    const fields: any[] = context?.fields || [];
    const sigFields = fields.filter(needsCapture);
    const missing = sigFields.filter((f: any) => !signatureData[f.id]);
    if (missing.length > 0) {
      toast.error(`Please sign all ${missing.length} required field(s)`);
      return;
    }
    setSubmitting(true);
    try {
      await signingApi.complete(token, signatureData, otpRequired ? otpCode : undefined);
      setStep('done');
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Signing failed';
      if (msg.includes('OTP') || msg.includes('AES')) {
        setOtpRequired(true);
        toast.error('Please enter OTP to complete AES signing');
      } else {
        toast.error(msg);
      }
    } finally { setSubmitting(false); }
  };

  const handleDecline = async () => {
    if (!token || !declineReason) return;
    try {
      await signingApi.decline(token, declineReason);
      setStep('done');
      toast('You have declined to sign this document.');
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed to decline'); }
  };

  if (step === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-brand-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500">Loading signing session...</p>
        </div>
      </div>
    );
  }

  if (step === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="card max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Cannot Sign</h2>
          <p className="text-gray-500 mb-6">{errorMsg}</p>
          <a href="/verify-identity" className="btn-primary">Complete Identity Verification</a>
        </div>
      </div>
    );
  }

  if (step === 'already-signed') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="card max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Already Signed</h2>
          <p className="text-gray-500">You have already signed this document.</p>
        </div>
      </div>
    );
  }

  if (step === 'done') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="card max-w-md w-full text-center">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Signing Complete!</h2>
          <p className="text-gray-500 mb-2">Your digital signature has been applied to the document using PKI cryptography.</p>
          <p className="text-xs text-gray-400 mb-6">Verified by: DocuSign Internal CA</p>
          <a href="/dashboard" className="btn-primary">View Dashboard</a>
        </div>
      </div>
    );
  }

  if (step === 'edisclosure') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="card max-w-lg w-full">
          <h2 className="text-xl font-bold text-gray-900 mb-2">Electronic Signature Consent</h2>
          <p className="text-sm text-gray-500 mb-4">Before signing, please review and accept the eDisclosure.</p>
          <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600 max-h-48 overflow-y-auto mb-4 border border-gray-200">
            <p className="font-semibold text-gray-800 mb-2">Electronic Records & Signatures Disclosure</p>
            <p>You are about to electronically sign a legally binding document. By clicking "Accept & Continue", you consent to the use of electronic signatures and records. Your electronic signature has the same legal effect as a handwritten signature. You confirm that you have read the document and agree to sign electronically.</p>
          </div>
          <div className="flex gap-3">
            <button className="btn-danger flex-shrink-0" onClick={() => { setDeclineMode(true); setStep('view'); }}>Decline</button>
            <button className="btn-primary flex-1" onClick={async () => {
              try {
                const api = await import('../api/client');
                await api.default.post('/auth/edisclosure');
                setStep('view');
                toast.success('eDisclosure accepted');
              } catch { toast.error('Failed to accept eDisclosure'); }
            }}>Accept & Continue</button>
          </div>
        </div>
      </div>
    );
  }

  const fields: any[] = context?.fields || [];
  const docUrl = signingApi.getDocumentUrl(token!);
  const captureFields = fields.filter(needsCapture);
  const allSigned = captureFields.every((f: any) => signatureData[f.id]);
  const captureField = captureFieldId ? fields.find((f: any) => f.id === captureFieldId) : null;

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="font-semibold text-gray-900 text-sm">{context?.envelope?.subject}</h1>
            <p className="text-xs text-gray-400">Signing for: {context?.recipient?.user_email}</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-secondary text-sm" onClick={() => setDeclineMode(!declineMode)}>Decline</button>
            {otpRequired && (
              <input className="input text-sm py-1.5 w-28" placeholder="OTP Code"
                value={otpCode} onChange={e => setOtpCode(e.target.value)} maxLength={6} />
            )}
            <button className="btn-primary text-sm" onClick={handleComplete} disabled={!allSigned || submitting}>
              {submitting ? 'Submitting...' : allSigned ? 'Finish Signing' : `Sign ${captureFields.length - Object.keys(signatureData).length} more`}
            </button>
          </div>
        </div>
      </div>

      {/* Decline form */}
      {declineMode && (
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div className="card bg-red-50 border-red-200">
            <h3 className="font-semibold text-red-800 mb-3">Decline to Sign</h3>
            <input className="input mb-3" type="text" placeholder="Reason for declining..."
              value={declineReason} onChange={e => setDeclineReason(e.target.value)} />
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={() => setDeclineMode(false)}>Cancel</button>
              <button className="btn-danger" onClick={handleDecline} disabled={!declineReason}>Confirm Decline</button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* PDF Viewer */}
        <div className="lg:col-span-2">
          <div className="card p-4">
            <h2 className="font-semibold text-gray-900 mb-3">Document</h2>
            <div className="bg-gray-200 rounded-lg overflow-hidden" style={{ minHeight: '600px' }}>
              <iframe src={docUrl} className="w-full" style={{ height: '700px', border: 'none' }} title="Document for signing" />
            </div>
            <p className="text-xs text-gray-400 mt-2">SHA-256: {context?.documents?.[0]?.sha256_hash || 'Calculating...'}</p>
          </div>
        </div>

        {/* Signature fields panel */}
        <div className="space-y-4">
          <div className="card">
            <h2 className="font-semibold text-gray-900 mb-3">Your Fields</h2>
            <div className="space-y-3">
              {fields.map((field: any) => {
                const isCaptureType = needsCapture(field);
                const confirmed = signatureData[field.id];
                const hasPrefill = field.preview_data && !confirmed;

                return (
                  <div key={field.id} className={`border-2 rounded-lg p-3 transition-colors ${confirmed ? 'border-green-400 bg-green-50' : 'border-gray-300 bg-white'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-gray-600 uppercase">{field.field_type}</span>
                      <span className="text-xs text-gray-400">Pg {field.page_number}</span>
                    </div>

                    {isCaptureType && confirmed && (
                      <div>
                        <img src={confirmed} alt={field.field_type} className="h-12 w-full object-contain mb-1" />
                        <div className="flex gap-2">
                          <button className="text-xs text-red-400 hover:text-red-600"
                            onClick={() => setSignatureData(p => { const n = { ...p }; delete n[field.id]; return n; })}>
                            Clear
                          </button>
                          <button className="text-xs text-brand-600 hover:text-brand-700"
                            onClick={() => setCaptureFieldId(field.id)}>
                            Change
                          </button>
                        </div>
                      </div>
                    )}

                    {isCaptureType && hasPrefill && (
                      <div>
                        <img src={field.preview_data} alt="pre-filled signature" className="h-12 w-full object-contain mb-2 opacity-70" />
                        <div className="flex gap-2">
                          <button className="btn-primary text-xs py-1 px-2 flex-1"
                            onClick={() => setSignatureData(p => ({ ...p, [field.id]: field.preview_data }))}>
                            Use this signature
                          </button>
                          <button className="btn-secondary text-xs py-1 px-2"
                            onClick={() => setCaptureFieldId(field.id)}>
                            Change
                          </button>
                        </div>
                      </div>
                    )}

                    {isCaptureType && !confirmed && !hasPrefill && (
                      <button className="text-sm text-brand-600 font-medium hover:underline w-full text-left"
                        onClick={() => setCaptureFieldId(field.id)}>
                        Click to sign →
                      </button>
                    )}

                    {field.field_type === 'date' && (
                      <p className="text-sm text-gray-600">{new Date().toLocaleDateString('en-IN')}</p>
                    )}
                  </div>
                );
              })}
              {fields.length === 0 && (
                <p className="text-gray-400 text-sm text-center py-4">No fields assigned to you</p>
              )}
            </div>
          </div>

          {/* Identity info */}
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Identity</h3>
            <div className="text-xs space-y-1">
              <p><span className="text-gray-500">Level:</span> <span className="font-medium text-green-700">{context?.identityGate?.current}</span></p>
              <p><span className="text-gray-500">Required:</span> <span className="font-medium">{context?.identityGate?.required}</span></p>
              <p><span className="text-gray-500">CA:</span> DocuSign Internal CA</p>
            </div>
          </div>
        </div>
      </div>

      {/* Signature Capture Modal */}
      {captureFieldId && captureField && (
        <SignatureCaptureModal
          fieldType={captureField.field_type === 'initials' ? 'initials' : 'signature'}
          onConfirm={handleCaptureConfirm}
          onCancel={() => setCaptureFieldId(null)}
        />
      )}
    </div>
  );
}
