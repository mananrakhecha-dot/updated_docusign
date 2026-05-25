import api from './client';

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: string;
  identity_level: 'NONE' | 'SES' | 'AES';
  edisclosure_accepted: boolean;
  phone_verified: boolean;
  phone_number?: string;
}

export const authApi = {
  register: (email: string, password: string, full_name: string) =>
    api.post('/auth/register', { email, password, full_name }),

  login: (email: string, password: string) =>
    api.post<{ user: User; accessToken: string }>('/auth/login', { email, password }),

  logout: () => api.post('/auth/logout'),

  me: () => api.get<User>('/auth/me'),

  refresh: () => api.post<{ accessToken: string }>('/auth/refresh'),

  acceptEDisclosure: () => api.post('/auth/edisclosure'),

  sendOTP: (phone_number: string) => api.post('/auth/otp/send', { phone_number }),

  verifyOTP: (otp_code: string) => api.post('/auth/otp/verify', { otp_code }),
};
