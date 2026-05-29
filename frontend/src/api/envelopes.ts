import api from "./client";

export interface Envelope {
  id: string;
  sender_id: string;
  sender_name: string;
  subject: string;
  message: string;
  status:
    | "DRAFT"
    | "SENT"
    | "DELIVERED"
    | "COMPLETED"
    | "DECLINED"
    | "VOIDED"
    | "TAMPERED";
  created_at: string;
  completed_at?: string;
  recipient_count?: number;
  signed_count?: number;
}

export interface EnvelopeDetail extends Envelope {
  documents: EnvelopeDocument[];
  recipients: Recipient[];
  sender: { full_name: string; email: string };
}

export interface EnvelopeDocument {
  id: string;
  envelope_id: string;
  file_name: string;
  file_path: string;
  sha256_hash: string;
  page_count: number;
}

export interface Recipient {
  id: string;
  envelope_id: string;
  user_email: string;
  full_name: string;
  order_index: number;
  status: string;
  auth_required: "SES" | "AES";
  signed_at?: string;
  viewed_at?: string;
}

export interface SignatureField {
  id?: string;
  envelope_document_id: string;
  recipient_id: string;
  page_number: number;
  x: number;
  y: number;
  width: number;
  height: number;
  field_type: "signature" | "initials" | "date" | "text";
  preview_data?: string | null;
}

export const envelopeApi = {
  list: () => api.get<Envelope[]>("/envelopes"),

  create: (formData: FormData) =>
    api.post<{ envelopeId: string; documentId: string; pageCount: number }>(
      "/envelopes",
      formData,
      {
        headers: { "Content-Type": "multipart/form-data" },
      },
    ),

  get: (id: string) => api.get<EnvelopeDetail>(`/envelopes/${id}`),

  updateRecipients: (id: string, recipients: any[]) =>
    api.patch(`/envelopes/${id}/recipients`, { recipients }),

  saveFields: (id: string, fields: SignatureField[]) =>
    api.patch(`/envelopes/${id}/fields`, { fields }),

  send: (id: string) => api.post(`/envelopes/${id}/send`),

  void: (id: string, reason: string) =>
    api.post(`/envelopes/${id}/void`, { reason }),

  history: (id: string) => api.get(`/envelopes/${id}/history`),

  status: (id: string) => api.get(`/envelopes/${id}/status`),

  downloadPdf: (id: string, preview = false) =>
    api.get(`/envelopes/${id}/download`, {
      params: preview ? { preview: "true" } : undefined,
      responseType: "arraybuffer",
    }),

  downloadCertificate: (id: string) =>
    api.get(`/envelopes/${id}/certificate`, { responseType: "arraybuffer" }),
};

export const signingApi = {
  getContext: (token: string) => api.get(`/sign/${token}`),
  getDocumentUrl: (token: string) => `/api/sign/${token}/document`,
  complete: (
    token: string,
    signatureData: Record<string, string>,
    otpCode?: string,
  ) =>
    api.post(`/sign/${token}/complete`, {
      signature_data: signatureData,
      otp_code: otpCode,
    }),
  decline: (token: string, reason: string) =>
    api.post(`/sign/${token}/decline`, { reason }),
};

export const adminApi = {
  uploadId: (file: File) => {
    const fd = new FormData();
    fd.append("id_document", file);
    return api.post("/admin/id-upload", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  listReviews: () => api.get("/admin/id-reviews"),
  imageUrl: (uploadId: string) => `/api/admin/id-reviews/${uploadId}/image`,
  approve: (uploadId: string) =>
    api.post(`/admin/id-reviews/${uploadId}/approve`),
  reject: (uploadId: string, reason: string) =>
    api.post(`/admin/id-reviews/${uploadId}/reject`, { reason }),
  listUsers: () => api.get("/admin/users"),
};

export const verifyApi = {
  verify: (envelopeId: string) => api.get(`/verify/${envelopeId}`),
};
