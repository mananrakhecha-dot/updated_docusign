import React, { useEffect, useState } from 'react';
import { Layout } from '../components/Layout';
import { adminApi } from '../api/envelopes';
import toast from 'react-hot-toast';

export function AdminIDReview() {
  const [reviews, setReviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const fetchReviews = async () => {
    try {
      const res = await adminApi.listReviews();
      setReviews(res.data);
    } catch { toast.error('Failed to load reviews'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchReviews(); }, []);

  const handleApprove = async (uploadId: string) => {
    try {
      await adminApi.approve(uploadId);
      toast.success('ID approved. User promoted to AES if phone is also verified.');
      fetchReviews();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Approval failed'); }
  };

  const handleReject = async (uploadId: string) => {
    if (!rejectReason) { toast.error('Please enter a rejection reason'); return; }
    try {
      await adminApi.reject(uploadId, rejectReason);
      toast.success('ID rejected');
      setSelected(null);
      setRejectReason('');
      fetchReviews();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Rejection failed'); }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">ID Review Queue</h1>
          <p className="text-gray-500 mt-1">Review government ID uploads for AES verification.</p>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-400">Loading...</div>
        ) : reviews.length === 0 ? (
          <div className="card text-center py-12">
            <p className="text-gray-400 text-lg">No pending reviews</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {reviews.map(review => (
              <div key={review.id} className="card space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-gray-900">{review.full_name}</p>
                    <p className="text-sm text-gray-500">{review.email}</p>
                    <div className="flex gap-2 mt-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${review.phone_verified ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {review.phone_verified ? '✓ Phone verified' : '✗ Phone not verified'}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700">
                        Current: {review.identity_level}
                      </span>
                    </div>
                  </div>
                  <span className="text-xs text-gray-400">{new Date(review.created_at).toLocaleDateString('en-IN')}</span>
                </div>

                {/* ID Image */}
                <div className="bg-gray-100 rounded-lg overflow-hidden" style={{ maxHeight: 200 }}>
                  <img
                    src={adminApi.imageUrl(review.id)}
                    alt="Government ID"
                    className="w-full object-contain max-h-48"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
                <p className="text-xs text-gray-500">File: {review.file_name}</p>

                {/* Actions */}
                {selected === review.id ? (
                  <div className="space-y-2">
                    <input className="input text-sm" type="text" placeholder="Rejection reason..."
                      value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
                    <div className="flex gap-2">
                      <button className="btn-secondary text-sm flex-1" onClick={() => setSelected(null)}>Cancel</button>
                      <button className="btn-danger text-sm flex-1" onClick={() => handleReject(review.id)}>Confirm Reject</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button className="btn-danger text-sm flex-1" onClick={() => setSelected(review.id)}>Reject</button>
                    <button className="btn-primary text-sm flex-1" onClick={() => handleApprove(review.id)}>✓ Approve</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
