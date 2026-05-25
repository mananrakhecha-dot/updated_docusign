import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { authApi } from '../api/auth';
import { adminApi } from '../api/envelopes';
import toast from 'react-hot-toast';
import { Layout } from '../components/Layout';
import { IdentityBadge } from '../components/StatusBadge';

type Step = 'overview' | 'phone' | 'otp' | 'id-upload' | 'pending';

export function VerifyIdentity() {
  const { user, refreshUser } = useAuth();
  const [step, setStep] = useState<Step>('overview');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [idFile, setIdFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  const sendOTP = async () => {
    if (!phone.match(/^\+[1-9]\d{6,14}$/)) {
      toast.error('Enter phone in international format: +91XXXXXXXXXX');
      return;
    }
    setLoading(true);
    try {
      await authApi.sendOTP(phone);
      toast.success('OTP sent! Check your phone (or server console in dev mode)');
      setStep('otp');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to send OTP');
    } finally { setLoading(false); }
  };

  const verifyOTP = async () => {
    setLoading(true);
    try {
      await authApi.verifyOTP(otp);
      toast.success('Phone verified!');
      await refreshUser();
      setStep('id-upload');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Invalid OTP');
    } finally { setLoading(false); }
  };

  const uploadID = async () => {
    if (!idFile) { toast.error('Please select an ID image'); return; }
    setLoading(true);
    try {
      await adminApi.uploadId(idFile);
      toast.success('ID uploaded! An admin will review your document.');
      setStep('pending');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Upload failed');
    } finally { setLoading(false); }
  };

  return (
    <Layout>
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Identity Verification</h1>
          <p className="text-gray-500 mt-1">Upgrade your identity level to sign documents with higher assurance.</p>
        </div>

        <div className="card mb-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-900">{user?.full_name}</p>
              <p className="text-sm text-gray-500">{user?.email}</p>
            </div>
            <IdentityBadge level={user?.identity_level || 'NONE'} />
          </div>
        </div>

        {step === 'overview' && (
          <div className="space-y-4">
            <div className="card">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-blue-700 font-bold text-sm">SES</span>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">Simple Electronic Signature</h3>
                  <p className="text-sm text-gray-500 mt-1">Email verification complete. You can sign standard documents.</p>
                  {user?.identity_level === 'SES' || user?.identity_level === 'AES' ? (
                    <span className="text-green-600 text-sm font-medium">✓ Completed</span>
                  ) : (
                    <span className="text-orange-500 text-sm">Verify email first</span>
                  )}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-green-700 font-bold text-sm">AES</span>
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900">Advanced Electronic Signature</h3>
                  <p className="text-sm text-gray-500 mt-1">Phone OTP verification + Government ID review by admin.</p>
                  {user?.identity_level === 'AES' ? (
                    <span className="text-green-600 text-sm font-medium">✓ Completed</span>
                  ) : (
                    <button className="btn-primary mt-3 text-sm" onClick={() => setStep('phone')}>
                      Start AES Verification →
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 'phone' && (
          <div className="card">
            <h3 className="font-semibold text-gray-900 mb-4">Step 1: Phone Verification</h3>
            <div className="space-y-4">
              <div>
                <label className="label">Phone Number (International format)</label>
                <input className="input" type="tel" placeholder="+91XXXXXXXXXX"
                  value={phone} onChange={e => setPhone(e.target.value)} />
                <p className="text-xs text-gray-400 mt-1">Example: +919876543210</p>
              </div>
              <div className="flex gap-3">
                <button className="btn-secondary" onClick={() => setStep('overview')}>Back</button>
                <button className="btn-primary" onClick={sendOTP} disabled={loading}>
                  {loading ? 'Sending...' : 'Send OTP'}
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 'otp' && (
          <div className="card">
            <h3 className="font-semibold text-gray-900 mb-4">Step 2: Enter OTP</h3>
            <p className="text-sm text-gray-500 mb-4">Enter the 6-digit code sent to {phone}</p>
            <div className="space-y-4">
              <div>
                <label className="label">OTP Code</label>
                <input className="input text-center text-2xl tracking-widest" type="text"
                  maxLength={6} placeholder="000000" value={otp}
                  onChange={e => setOtp(e.target.value.replace(/\D/g, ''))} />
              </div>
              <div className="flex gap-3">
                <button className="btn-secondary" onClick={() => setStep('phone')}>Back</button>
                <button className="btn-primary" onClick={verifyOTP} disabled={loading || otp.length !== 6}>
                  {loading ? 'Verifying...' : 'Verify OTP'}
                </button>
              </div>
              <button className="text-sm text-brand-600 hover:text-brand-700" onClick={sendOTP}>
                Resend OTP
              </button>
            </div>
          </div>
        )}

        {step === 'id-upload' && (
          <div className="card">
            <h3 className="font-semibold text-gray-900 mb-4">Step 3: Upload Government ID</h3>
            <p className="text-sm text-gray-500 mb-4">
              Upload a clear photo of your passport or driver's licence. This will be reviewed by an admin.
            </p>
            <div className="space-y-4">
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                <input type="file" accept="image/jpeg,image/png,image/jpg"
                  onChange={e => setIdFile(e.target.files?.[0] || null)}
                  className="hidden" id="id-file" />
                <label htmlFor="id-file" className="cursor-pointer">
                  {idFile ? (
                    <div>
                      <p className="text-green-600 font-medium">✓ {idFile.name}</p>
                      <p className="text-xs text-gray-400">{(idFile.size / 1024).toFixed(0)} KB</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-gray-500">Click to select JPEG/PNG of your ID</p>
                      <p className="text-xs text-gray-400 mt-1">Max 5MB</p>
                    </div>
                  )}
                </label>
              </div>
              <div className="flex gap-3">
                <button className="btn-secondary" onClick={() => setStep('otp')}>Back</button>
                <button className="btn-primary" onClick={uploadID} disabled={loading || !idFile}>
                  {loading ? 'Uploading...' : 'Submit for Review'}
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 'pending' && (
          <div className="card text-center">
            <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Under Review</h2>
            <p className="text-gray-500">Your ID has been submitted for review. Once approved, your identity level will be upgraded to AES.</p>
          </div>
        )}
      </div>
    </Layout>
  );
}
