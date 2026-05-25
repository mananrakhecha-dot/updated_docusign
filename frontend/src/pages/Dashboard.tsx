import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { StatusBadge } from '../components/StatusBadge';
import { envelopeApi, Envelope } from '../api/envelopes';
import { useAuth } from '../hooks/useAuth';
import { useSocket } from '../hooks/useSocket';
import toast from 'react-hot-toast';

export function Dashboard() {
  const { user } = useAuth();
  const { joinDashboard, on } = useSocket();
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEnvelopes = useCallback(async () => {
    try {
      const res = await envelopeApi.list();
      setEnvelopes(res.data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchEnvelopes();
  }, [fetchEnvelopes]);

  useEffect(() => {
    if (!user) return;
    joinDashboard(user.id);
    const off = on('envelope:update', () => {
      fetchEnvelopes();
      toast('Envelope status updated');
    });
    return off;
  }, [user, joinDashboard, on, fetchEnvelopes]);

  const statusCounts = envelopes.reduce((acc, e) => {
    acc[e.status] = (acc[e.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
            <p className="text-gray-500 text-sm mt-1">Welcome back, {user?.full_name}</p>
          </div>
          <Link to="/envelopes/new" className="btn-primary">
            + New Envelope
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Total', count: envelopes.length, color: 'bg-gray-50 text-gray-700' },
            { label: 'Sent', count: (statusCounts.SENT || 0) + (statusCounts.DELIVERED || 0), color: 'bg-blue-50 text-blue-700' },
            { label: 'Completed', count: statusCounts.COMPLETED || 0, color: 'bg-green-50 text-green-700' },
            { label: 'Pending', count: statusCounts.DRAFT || 0, color: 'bg-yellow-50 text-yellow-700' },
          ].map(stat => (
            <div key={stat.label} className={`${stat.color} rounded-xl p-4`}>
              <p className="text-3xl font-bold">{stat.count}</p>
              <p className="text-sm font-medium mt-1">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Envelope table */}
        <div className="card p-0 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">All Envelopes</h2>
          </div>
          {loading ? (
            <div className="p-8 text-center text-gray-400">Loading...</div>
          ) : envelopes.length === 0 ? (
            <div className="p-12 text-center">
              <svg className="w-12 h-12 text-gray-300 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-gray-500">No envelopes yet. Create your first one!</p>
              <Link to="/envelopes/new" className="btn-primary mt-4 inline-flex">Create Envelope</Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Subject</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Recipients</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                    <th className="px-6 py-3"></th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {envelopes.map(envelope => (
                    <tr key={envelope.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4">
                        <p className="font-medium text-gray-900 truncate max-w-xs">{envelope.subject}</p>
                        <p className="text-xs text-gray-400 font-mono">{envelope.id.slice(0, 8)}...</p>
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={envelope.status} />
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {envelope.signed_count || 0} / {envelope.recipient_count || 0} signed
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {new Date(envelope.created_at).toLocaleDateString('en-IN')}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Link to={`/envelopes/${envelope.id}`} className="text-brand-600 hover:text-brand-700 text-sm font-medium">
                          View →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
