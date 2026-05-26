/* eslint-disable camelcase */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE envelope_recipients ADD COLUMN IF NOT EXISTS signing_ip VARCHAR(64);');
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE envelope_recipients DROP COLUMN IF EXISTS signing_ip;');
};
