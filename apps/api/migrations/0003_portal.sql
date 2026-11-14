-- 0003: staff portal, in-site applications with tracking IDs, jobs fetched from the web (plan v1.2).
ALTER TABLE opportunities ADD COLUMN apply_mode VARCHAR(12) NOT NULL DEFAULT 'external';

-- An application made through this site. The tracking code is what the applicant uses to follow it.
CREATE TABLE site_applications (
  id BIGINT PRIMARY KEY AUTO_RANDOM(5, 54),
  tracking_code VARCHAR(20) NOT NULL,
  opportunity_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  applicant_name VARCHAR(150) NOT NULL,
  applicant_email VARCHAR(320) NOT NULL,
  applicant_phone VARCHAR(30) NULL,
  cover_note TEXT NULL,
  profile_snapshot JSON NULL,
  eligibility_status VARCHAR(30) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'submitted',
  admin_note TEXT NULL,
  submitted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_sa_code (tracking_code),
  UNIQUE KEY uq_sa_user_opp (user_id, opportunity_id),
  KEY ix_sa_opp_status (opportunity_id, status),
  KEY ix_sa_status_time (status, submitted_at),
  CONSTRAINT fk_sa_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_sa_opp FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE
);

-- Timeline of an application. `public` events are shown to the applicant and on the tracking page.
CREATE TABLE site_application_events (
  id BIGINT PRIMARY KEY AUTO_RANDOM(5, 54),
  application_id BIGINT NOT NULL,
  from_status VARCHAR(20) NULL,
  to_status VARCHAR(20) NOT NULL,
  note VARCHAR(500) NULL,
  actor_user_id BIGINT NULL,
  public TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_sae_app (application_id, created_at),
  CONSTRAINT fk_sae_app FOREIGN KEY (application_id) REFERENCES site_applications(id) ON DELETE CASCADE
);

-- Jobs found on the web by the feed connectors: short snippet and a link to the original only.
CREATE TABLE external_listings (
  id BIGINT PRIMARY KEY AUTO_RANDOM(5, 54),
  source VARCHAR(32) NOT NULL,
  external_id VARCHAR(190) NOT NULL,
  title VARCHAR(400) NOT NULL,
  company VARCHAR(250) NULL,
  location VARCHAR(250) NULL,
  snippet VARCHAR(600) NULL,
  url VARCHAR(1000) NOT NULL,
  tags JSON NULL,
  posted_at DATETIME(3) NULL,
  fetched_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  hidden TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uq_el_source_ext (source, external_id),
  KEY ix_el_posted (hidden, posted_at),
  KEY ix_el_source (source, hidden)
);

CREATE TABLE external_source_runs (
  id BIGINT PRIMARY KEY AUTO_RANDOM(5, 54),
  source VARCHAR(32) NOT NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at DATETIME(3) NULL,
  ok TINYINT(1) NOT NULL DEFAULT 0,
  fetched INT NOT NULL DEFAULT 0,
  error VARCHAR(300) NULL,
  KEY ix_esr_source (source, started_at)
);
