-- 0005: employers (recruiters) who post their own opportunities and handle the applications to them (plan v1.4).
CREATE TABLE employer_profiles (
  user_id BIGINT PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  contact_phone VARCHAR(30) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY ix_ep_org (organization_id),
  CONSTRAINT fk_ep_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ep_org FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

-- Who posted an opportunity. NULL for staff-entered ones. Cleared (not deleted) when the employer's account is deleted.
ALTER TABLE opportunities ADD COLUMN owner_user_id BIGINT NULL;
CREATE INDEX ix_opp_owner ON opportunities (owner_user_id, publication_status);
