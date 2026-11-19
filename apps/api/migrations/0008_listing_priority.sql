-- 0008: foreign listings are ordered by a priority: United States, Canada and Australia, work open to anyone, and
-- large companies first. Set on every refresh; the update below gives existing rows a first value.
ALTER TABLE external_listings ADD COLUMN priority TINYINT NOT NULL DEFAULT 0;
CREATE INDEX ix_el_region_priority ON external_listings (hidden, region, priority, posted_at);
UPDATE external_listings SET priority = 2 WHERE LOWER(location) LIKE '%united states%' OR LOWER(location) LIKE '%usa%'
  OR LOWER(location) LIKE '%canada%' OR LOWER(location) LIKE '%australia%';
UPDATE external_listings SET priority = 1 WHERE priority = 0 AND (LOWER(location) LIKE '%worldwide%'
  OR LOWER(location) LIKE '%anywhere%' OR LOWER(location) LIKE '%remote%');
