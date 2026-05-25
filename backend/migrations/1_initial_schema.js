/* eslint-disable camelcase */
exports.shorthands = undefined;

exports.up = (pgm) => {
  // Users
  pgm.createTable('users', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    email: { type: 'varchar(255)', notNull: true, unique: true },
    password_hash: { type: 'text', notNull: true },
    full_name: { type: 'varchar(255)', notNull: true },
    phone_number: { type: 'varchar(20)' },
    phone_verified: { type: 'boolean', default: false },
    identity_level: { type: 'varchar(10)', default: pgm.func("'NONE'"), notNull: true },
    edisclosure_accepted: { type: 'boolean', default: false },
    edisclosure_accepted_at: { type: 'timestamptz' },
    email_verified: { type: 'boolean', default: false },
    email_verify_token: { type: 'varchar(64)' },
    email_verify_expires: { type: 'timestamptz' },
    role: { type: 'varchar(20)', default: pgm.func("'user'"), notNull: true },
    cert_pem: { type: 'text' },
    encrypted_private_key: { type: 'text' },
    cert_serial: { type: 'varchar(64)' },
    cert_expires_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', default: pgm.func('now()'), notNull: true },
    updated_at: { type: 'timestamptz', default: pgm.func('now()'), notNull: true },
  });

  // OTP sessions
  pgm.createTable('otp_sessions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: { type: 'uuid', notNull: true, references: '"users"', onDelete: 'CASCADE' },
    phone_number: { type: 'varchar(20)', notNull: true },
    otp_hash: { type: 'text', notNull: true },
    attempts: { type: 'integer', default: 0 },
    verified: { type: 'boolean', default: false },
    expires_at: { type: 'timestamptz', notNull: true },
    created_at: { type: 'timestamptz', default: pgm.func('now()'), notNull: true },
  });

  // Government ID uploads
  pgm.createTable('id_uploads', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: { type: 'uuid', notNull: true, references: '"users"', onDelete: 'CASCADE' },
    file_path: { type: 'text', notNull: true },
    file_name: { type: 'varchar(255)', notNull: true },
    status: { type: 'varchar(20)', default: pgm.func("'PENDING'"), notNull: true },
    reviewed_by: { type: 'uuid', references: '"users"' },
    reviewed_at: { type: 'timestamptz' },
    reject_reason: { type: 'text' },
    created_at: { type: 'timestamptz', default: pgm.func('now()'), notNull: true },
  });

  // Envelopes
  pgm.createTable('envelopes', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    sender_id: { type: 'uuid', notNull: true, references: '"users"', onDelete: 'RESTRICT' },
    subject: { type: 'varchar(500)', notNull: true },
    message: { type: 'text' },
    status: { type: 'varchar(20)', default: pgm.func("'DRAFT'"), notNull: true },
    void_reason: { type: 'text' },
    completed_at: { type: 'timestamptz' },
    completion_cert_path: { type: 'text' },
    created_at: { type: 'timestamptz', default: pgm.func('now()'), notNull: true },
    updated_at: { type: 'timestamptz', default: pgm.func('now()'), notNull: true },
  });

  // Envelope documents
  pgm.createTable('envelope_documents', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    envelope_id: { type: 'uuid', notNull: true, references: '"envelopes"', onDelete: 'CASCADE' },
    file_name: { type: 'varchar(255)', notNull: true },
    file_path: { type: 'text', notNull: true },
    sha256_hash: { type: 'varchar(64)', notNull: true },
    page_count: { type: 'integer', notNull: true },
    upload_time: { type: 'timestamptz', default: pgm.func('now()'), notNull: true },
  });

  // Envelope recipients
  pgm.createTable('envelope_recipients', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    envelope_id: { type: 'uuid', notNull: true, references: '"envelopes"', onDelete: 'CASCADE' },
    user_email: { type: 'varchar(255)', notNull: true },
    full_name: { type: 'varchar(255)', notNull: true },
    order_index: { type: 'integer', default: 1, notNull: true },
    status: { type: 'varchar(20)', default: pgm.func("'PENDING'"), notNull: true },
    auth_required: { type: 'varchar(10)', default: pgm.func("'SES'"), notNull: true },
    signing_token: { type: 'text' },
    token_used: { type: 'boolean', default: false },
    signed_at: { type: 'timestamptz' },
    viewed_at: { type: 'timestamptz' },
    ip_address: { type: 'varchar(45)' },
    user_agent: { type: 'text' },
    decline_reason: { type: 'text' },
  });

  // Signature fields
  pgm.createTable('signature_fields', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    envelope_document_id: { type: 'uuid', notNull: true, references: '"envelope_documents"', onDelete: 'CASCADE' },
    recipient_id: { type: 'uuid', notNull: true, references: '"envelope_recipients"', onDelete: 'CASCADE' },
    page_number: { type: 'integer', notNull: true },
    x: { type: 'decimal(8,4)', notNull: true },
    y: { type: 'decimal(8,4)', notNull: true },
    width: { type: 'decimal(8,4)', notNull: true },
    height: { type: 'decimal(8,4)', notNull: true },
    field_type: { type: 'varchar(20)', notNull: true },
    value: { type: 'text' },
  });

  // Audit events
  pgm.createTable('audit_events', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    envelope_id: { type: 'uuid', references: '"envelopes"', onDelete: 'SET NULL' },
    recipient_email: { type: 'varchar(255)' },
    event_type: { type: 'varchar(50)', notNull: true },
    ip_address: { type: 'varchar(45)' },
    user_agent: { type: 'text' },
    metadata: { type: 'jsonb', default: pgm.func("'{}'") },
    created_at: { type: 'timestamptz', default: pgm.func('now()'), notNull: true },
  });

  // Revoked certificates (CRL)
  pgm.createTable('revoked_certificates', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    serial_number: { type: 'varchar(64)', notNull: true, unique: true },
    user_id: { type: 'uuid', references: '"users"' },
    revocation_reason: { type: 'varchar(50)', notNull: true },
    revoked_at: { type: 'timestamptz', default: pgm.func('now()'), notNull: true },
  });

  // Refresh tokens
  pgm.createTable('refresh_tokens', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: { type: 'uuid', notNull: true, references: '"users"', onDelete: 'CASCADE' },
    token_hash: { type: 'text', notNull: true },
    expires_at: { type: 'timestamptz', notNull: true },
    created_at: { type: 'timestamptz', default: pgm.func('now()'), notNull: true },
  });

  // Indexes
  pgm.createIndex('audit_events', 'envelope_id');
  pgm.createIndex('audit_events', 'event_type');
  pgm.createIndex('audit_events', 'created_at');
  pgm.createIndex('envelope_recipients', 'envelope_id');
  pgm.createIndex('envelope_recipients', 'user_email');
  pgm.createIndex('signature_fields', 'envelope_document_id');
  pgm.createIndex('signature_fields', 'recipient_id');
  pgm.createIndex('users', 'email');
  pgm.createIndex('refresh_tokens', 'user_id');
};

exports.down = (pgm) => {
  pgm.dropTable('refresh_tokens');
  pgm.dropTable('revoked_certificates');
  pgm.dropTable('audit_events');
  pgm.dropTable('signature_fields');
  pgm.dropTable('envelope_recipients');
  pgm.dropTable('envelope_documents');
  pgm.dropTable('envelopes');
  pgm.dropTable('id_uploads');
  pgm.dropTable('otp_sessions');
  pgm.dropTable('users');
};
