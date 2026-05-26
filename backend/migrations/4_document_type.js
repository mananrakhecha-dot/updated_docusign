/* eslint-disable camelcase */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql("ALTER TABLE envelope_documents ADD COLUMN IF NOT EXISTS document_type VARCHAR(32) DEFAULT 'original';");
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE envelope_documents DROP COLUMN IF EXISTS document_type;');
};
