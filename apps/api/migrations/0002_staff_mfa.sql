-- 0002: staff two-factor authentication (plan AUTH-MFA-01 .. 04, SEC-08).
-- users.totp_secret_enc already exists (encrypted at rest); this adds the confirmation time and recovery codes.
ALTER TABLE users ADD COLUMN totp_confirmed_at DATETIME(3) NULL;

-- Ten single-use recovery codes per staff account, stored only as SHA-256 hashes; shown once at enrolment.
CREATE TABLE mfa_recovery_codes (
  id BIGINT PRIMARY KEY AUTO_RANDOM(5, 54),
  user_id BIGINT NOT NULL,
  code_hash BINARY(32) NOT NULL,
  used_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_mrc_hash (code_hash),
  KEY ix_mrc_user (user_id),
  CONSTRAINT fk_mrc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
