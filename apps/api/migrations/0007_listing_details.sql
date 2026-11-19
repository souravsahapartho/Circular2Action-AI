-- 0007: jobs found on the web get their own detail page and a kind (job, internship or scholarship) so they can be
-- mixed into the matching lists on the site (plan v1.6). The text is plain, cleaned and capped; the apply button
-- still goes to the original site.
ALTER TABLE external_listings ADD COLUMN description MEDIUMTEXT NULL;
ALTER TABLE external_listings ADD COLUMN detail_fetched_at DATETIME(3) NULL;
ALTER TABLE external_listings ADD COLUMN category_slug VARCHAR(24) NOT NULL DEFAULT 'jobs';
CREATE INDEX ix_el_category ON external_listings (hidden, category_slug, posted_at);
UPDATE external_listings SET category_slug = 'internships'
  WHERE LOWER(title) LIKE '%intern%' OR LOWER(title) LIKE '%trainee%' OR LOWER(title) LIKE '%apprentice%'
     OR LOWER(title) LIKE '%working student%' OR LOWER(title) LIKE '%werkstudent%' OR LOWER(title) LIKE '%praktik%';
UPDATE external_listings SET category_slug = 'scholarships'
  WHERE LOWER(title) LIKE '%scholarship%' OR LOWER(title) LIKE '%fellowship%' OR LOWER(title) LIKE '%bursary%'
     OR LOWER(title) LIKE '%stipend%' OR LOWER(title) LIKE '%grant program%';
ALTER TABLE external_listings ADD COLUMN region VARCHAR(8) NOT NULL DEFAULT 'intl';
UPDATE external_listings SET region = 'bd' WHERE source = 'google'
  OR LOWER(location) LIKE '%bangladesh%' OR LOWER(location) LIKE '%dhaka%' OR LOWER(location) LIKE '%chattogram%'
  OR LOWER(location) LIKE '%chittagong%' OR LOWER(location) LIKE '%sylhet%' OR LOWER(location) LIKE '%khulna%'
  OR LOWER(location) LIKE '%rajshahi%';
