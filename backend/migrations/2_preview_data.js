/* eslint-disable camelcase */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE signature_fields ADD COLUMN IF NOT EXISTS preview_data TEXT;');
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE signature_fields DROP COLUMN IF EXISTS preview_data;');
};
