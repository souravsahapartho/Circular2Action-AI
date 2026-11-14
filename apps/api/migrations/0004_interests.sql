-- 0004: interests, activity and alerts for recommendations (plan v1.3).
CREATE TABLE job_preferences (
  user_id BIGINT PRIMARY KEY,
  categories JSON NULL,
  keywords JSON NULL,
  location_slugs JSON NULL,
  alerts_enabled TINYINT(1) NOT NULL DEFAULT 1,
  personalize TINYINT(1) NOT NULL DEFAULT 1,
  last_matched_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_jp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- What a person looked at, saved, tracked, applied to, clicked or searched. Used only for that person's suggestions.
CREATE TABLE interaction_events (
  id BIGINT PRIMARY KEY AUTO_RANDOM(5, 54),
  user_id BIGINT NOT NULL,
  kind VARCHAR(16) NOT NULL,
  opportunity_id BIGINT NULL,
  listing_id BIGINT NULL,
  category_slug VARCHAR(100) NULL,
  location_slug VARCHAR(120) NULL,
  term VARCHAR(200) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_ie_user_time (user_id, created_at),
  CONSTRAINT fk_ie_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
