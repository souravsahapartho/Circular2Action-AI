-- 0006: sponsored posts (demo plan) and web push notifications (plan v1.5).

-- A sponsorship promotes one published opportunity to the people it fits. Plan "demo" is free: no payment is taken
-- until a payment provider is approved by the owner. Staff decide each request.
CREATE TABLE sponsorships (
  id BIGINT PRIMARY KEY AUTO_RANDOM(5, 54),
  opportunity_id BIGINT NOT NULL,
  owner_user_id BIGINT NULL,
  plan VARCHAR(16) NOT NULL DEFAULT 'demo',
  days INT NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'pending',      -- pending | active | rejected | ended
  note VARCHAR(300) NULL,
  starts_at DATETIME(3) NULL,
  ends_at DATETIME(3) NULL,
  decided_by BIGINT NULL,
  decided_at DATETIME(3) NULL,
  impressions INT NOT NULL DEFAULT 0,
  clicks INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY ix_sp_status (status, ends_at),
  KEY ix_sp_opp (opportunity_id, status),
  KEY ix_sp_owner (owner_user_id, status),
  CONSTRAINT fk_sp_opp FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE
);

-- One row per browser or phone that agreed to push notifications.
CREATE TABLE push_subscriptions (
  id BIGINT PRIMARY KEY AUTO_RANDOM(5, 54),
  user_id BIGINT NOT NULL,
  endpoint_hash BINARY(32) NOT NULL,
  endpoint VARCHAR(1000) NOT NULL,
  p256dh VARCHAR(200) NOT NULL,
  auth VARCHAR(100) NOT NULL,
  user_agent VARCHAR(200) NULL,
  failures INT NOT NULL DEFAULT 0,
  last_ok_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_ps_endpoint (endpoint_hash),
  KEY ix_ps_user (user_id),
  CONSTRAINT fk_ps_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- When a notification was sent as a push (NULL: not yet or not wanted).
ALTER TABLE notifications ADD COLUMN pushed_at DATETIME(3) NULL;
