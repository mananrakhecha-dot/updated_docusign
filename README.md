# DocuSign — Full-Stack Digital Document Signing Platform

A complete, production-grade digital document signing platform implementing every layer of DocuSign's internal architecture.

## Features

- **Three-tier PKI** — Root CA → Intermediate CA → per-user Leaf Certificates (node-forge, RSA-4096/2048)
- **Tamper-evident signing** — SHA-256 document hashing, PKCS#7 cryptographic signatures embedded in PDF
- **Visual trust indicator** — Green checkmark badge with signer details embedded in signed PDF
- **Multi-factor identity** — SES (email) and AES (phone OTP + government ID review) levels
- **Envelope workflow** — Upload → Tag fields → Add recipients → Send → Sign → Complete
- **Real-time tracking** — Socket.IO live status updates on the dashboard
- **Full audit trail** — 15+ event types logged to PostgreSQL with IP, user-agent, timestamp
- **Certificate of Completion** — Auto-generated PDF with QR code linking to public verify endpoint
- **CRL + OCSP** — Certificate revocation endpoints, 24h auto-refresh via BullMQ cron
- **Security hardening** — AES-256 at-rest encryption, JWT + refresh tokens, Helmet.js, rate limiting

## Architecture

```
frontend/      React + TypeScript + Tailwind CSS
backend/
  ca/          Three-tier PKI (Root → Intermediate → Leaf certs)
  modules/
    auth/      Register, login, JWT, eDisclosure, OTP
    envelopes/ CRUD, PDF upload, field placement, send
    signing/   Signing ceremony, PKI signing, PDF embedding
    audit/     Event logging
    completion/Certificate of Completion, verify endpoint
    admin/     ID upload review queue
  jobs/        BullMQ workers (email, CRL refresh, CoC generation)
  db/          PostgreSQL pool + migrations
```

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 16
- Redis 7

### 1. Database & Redis

```bash
# Using Docker
docker compose up -d

# Or start services directly (Ubuntu/Debian)
service postgresql start
service redis-server start
```

### 2. Backend Setup

```bash
cd backend
cp ../.env.example .env
# Edit .env with your values

npm install

# Run migrations
DATABASE_URL=postgresql://digsign:digsign_secret@localhost:5432/digsign \
  npx node-pg-migrate up

# Bootstrap CA (generates Root + Intermediate CA)
npx tsx src/ca/bootstrap.ts

# Start server
npm run dev
```

### 3. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Visit http://localhost:5173

### 4. Create Admin User

```bash
# After registering, promote a user to admin
psql postgresql://digsign:digsign_secret@localhost:5432/digsign \
  -c "UPDATE users SET role='admin' WHERE email='your@email.com';"
```

## Environment Variables

See `.env.example` for the full list. Key variables:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | JWT access token secret (min 32 chars) |
| `REFRESH_TOKEN_SECRET` | Refresh token secret |
| `SIGNING_LINK_SECRET` | Signing link JWT secret |
| `STORAGE_ENCRYPTION_KEY` | 64-char hex key for AES-256 file encryption |
| `PRIVATE_KEY_ENCRYPTION_KEY` | 64-char hex key for private key encryption |
| `ROOT_CA_PASSPHRASE` | Root CA private key passphrase |
| `INTERMEDIATE_CA_PASSPHRASE` | Intermediate CA passphrase |
| `TWILIO_*` | Twilio credentials (OTP; logs to console in dev) |
| `SMTP_*` | Email credentials (logs to console in dev) |

## API Endpoints

### Authentication
- `POST /api/auth/register` — Register + sends verification email
- `GET /api/auth/verify-email?token=` — Verify email
- `POST /api/auth/login` — Login → access token + refresh cookie
- `POST /api/auth/refresh` — Refresh access token
- `POST /api/auth/edisclosure` — Accept eDisclosure consent
- `POST /api/auth/otp/send` — Send phone OTP
- `POST /api/auth/otp/verify` — Verify phone OTP

### Envelopes
- `POST /api/envelopes` — Create envelope + upload PDF
- `GET /api/envelopes` — List envelopes
- `GET /api/envelopes/:id` — Get envelope detail
- `PATCH /api/envelopes/:id/recipients` — Update recipients
- `PATCH /api/envelopes/:id/fields` — Save signature field positions
- `POST /api/envelopes/:id/send` — Send to recipients
- `POST /api/envelopes/:id/void` — Void envelope
- `GET /api/envelopes/:id/history` — Full audit log
- `GET /api/envelopes/:id/download` — Download signed PDF
- `GET /api/envelopes/:id/certificate` — Download Certificate of Completion

### Signing
- `GET /api/sign/:token` — Get signing context (document, fields, identity gate)
- `GET /api/sign/:token/document` — Stream decrypted PDF for viewing
- `POST /api/sign/:token/complete` — Complete signing ceremony
- `POST /api/sign/:token/decline` — Decline to sign

### CA & Verification
- `GET /api/ca/crl` — DER-encoded Certificate Revocation List
- `POST /api/ca/ocsp` — OCSP responder
- `GET /api/ca/root-cert` — Root CA certificate (PEM)
- `GET /api/ca/intermediate-cert` — Intermediate CA certificate (PEM)
- `GET /api/verify/:envelopeId` — Public verification endpoint (used by QR code)

### Admin
- `POST /api/admin/id-upload` — Upload government ID
- `GET /api/admin/id-reviews` — List pending ID reviews (admin only)
- `POST /api/admin/id-reviews/:id/approve` — Approve ID
- `POST /api/admin/id-reviews/:id/reject` — Reject ID

## Identity Levels

| Level | Requirements | Can Sign |
|---|---|---|
| NONE | Registered only | No |
| SES | Email verified + eDisclosure accepted | Standard documents |
| AES | SES + Phone OTP + Admin-approved ID | High-assurance documents |

## PKI Chain of Trust

```
Root CA (RSA-4096, 20 years, offline)
  └── Intermediate CA (RSA-2048, 5 years, loaded at startup)
        └── User Leaf Certs (RSA-2048, 1 year, auto-renewed)
```

All leaf certificates include `digitalSignature` and `nonRepudiation` key usage extensions.

## Security Controls

- **Encryption at rest**: All PDFs and ID images AES-256 encrypted on disk
- **Private keys**: Encrypted AES-256 in database, decrypted only during signing
- **Tamper detection**: SHA-256 hash comparison before every signing action
- **Rate limiting**: 5 auth attempts per 15 min, 3 OTP attempts per 10 min
- **JWT**: 15-minute access tokens, 7-day refresh tokens (httpOnly cookie)
- **Headers**: Helmet.js (CSP, HSTS, X-Frame-Options, CORP, etc.)
- **CORS**: Configured for frontend origin only
