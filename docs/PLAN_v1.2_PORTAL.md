# Plan v1.2: staff portal, in-site applications with tracking IDs, jobs from the web

Status: approved by the owner in chat on 2026-11-14. This file extends `CIRCULAR2ACTION_MASTER_PLAN_v1.1.md`; where it is silent, v1.1 rules apply (RBAC deny by default, audit every staff write, no secrets in code, tests with every module).

## 1. Goals (owner's words, summarised)

1. A separate **staff portal** (its own sign-in, its own look, its own navigation) that is fully connected to the backend. Everything is stored in the database.
2. A **more distinctive, professional design** for the public site.
3. **Apply through the site**: a signed-in visitor applies to an opportunity and receives a **tracking ID**. They can follow the status with that ID. Staff **handle those applications from the portal** (review, shortlist, interview, accept, reject, notes).
4. **Jobs from the web**: related jobs found on the internet are fetched automatically, cached in our database and shown on the site, clearly labelled as coming from the web (not verified by us), with a link to the original.
5. Everything saved in the backend, tested, documented, pushed to GitHub.

## 2. Decisions and honesty notes

| Topic                | Decision                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Portal" hosting     | One web service, a separate `/admin` area with its own layout, its own `/admin/login`, English only, never indexed. A second hosting service would use more of the free 750 hours a month; the structure keeps a later split easy (no shared page code except UI primitives).                                                                                                                                                   |
| Google               | Scraping google.com results is against its terms and is blocked in practice. The supported route is the **Google Programmable Search JSON API** (free 100 queries a day, needs a key and a search-engine id from the owner). It is built as a connector that stays **off until `GOOGLE_CSE_API_KEY` and `GOOGLE_CSE_CX` are set**. Until then the feed uses two open job APIs that need no key: **Arbeitnow** and **Remotive**. |
| Fetched listings     | Stored as title, company, place, a short plain-text snippet (max 500 characters), the original link, the source name and times. We never copy full descriptions. Always shown with "From the web · source" and "Not verified by Circular2Action". Links open the original site (`rel="noopener nofollow"`).                                                                                                                     |
| Applications on site | Per opportunity, staff choose `apply_mode`: `external` (official link only), `site` (apply here) or `both`. The product records the application and its status; it does not send anything to the employer. The page says so.                                                                                                                                                                                                    |
| Tracking ID          | `C2A-XXXX-XXXX` from an alphabet without look-alike characters (about 40 bits). Public lookup shows only the opportunity, organisation, status and the public timeline, never personal data. Lookup is rate limited.                                                                                                                                                                                                            |
| Email                | No email provider on staging: status changes are visible on the site (My applications, tracking page). Email notifications are a later step when a provider exists.                                                                                                                                                                                                                                                             |

## 3. Data model (migration `0003_portal.sql`)

- `opportunities.apply_mode VARCHAR(12) NOT NULL DEFAULT 'external'`.
- `site_applications` (id, tracking_code unique, opportunity_id, user_id, applicant_name, applicant_email, applicant_phone, cover_note, profile_snapshot JSON, eligibility_status, status, admin_note, submitted_at, updated_at; unique per user and opportunity).
- `site_application_events` (id, application_id, from_status, to_status, note, actor_user_id NULL, public TINYINT, created_at): the timeline.
- `external_listings` (id, source, external_id, title, company, location, snippet, url, tags JSON, posted_at, fetched_at, hidden; unique source + external_id).
- `external_source_runs` (id, source, started_at, finished_at, ok, fetched, error).
- Privacy registry: `site_applications.user_id` is deleted with the account; `site_application_events.actor_user_id` is retained for staff accountability.
- New permissions: `application.read`, `application.manage`, `listing.manage` (editor, verifier and admin get the first two; admin gets `listing.manage`).

## 4. API

Public: `GET /api/v1/track/:code`, `GET /api/v1/listings`, `GET /api/v1/listings/sources`.
Signed in: `POST /api/v1/opportunities/:id/apply`, `GET /api/v1/me/site-applications`, `GET /api/v1/me/site-applications/:id`, `POST /api/v1/me/site-applications/:id/withdraw`.
Staff: `GET /api/v1/admin/applications` (filters), `GET /api/v1/admin/applications/:id`, `POST /api/v1/admin/applications/:id/status`, `PUT /api/v1/admin/applications/:id/note`, `GET /api/v1/admin/listings`, `POST /api/v1/admin/listings/refresh`, `POST /api/v1/admin/listings/:id/hidden`, overview extended with application counts.
Every staff write is audited. Status transitions are validated (no moving a withdrawn or closed application).

## 5. Web

Public: apply page with consent, success page with big tracking ID and copy button, My applications (+ detail with timeline), public Track page, "Jobs from the web" page and a strip on the home page, richer visual design (hero, cards, section rhythm, dark footer).
Staff portal: `/admin/login`, dashboard (counts, recent applications, recent activity), Applications (filters, detail, status change with note, timeline), Opportunities (apply mode), Web listings (sources, last run, refresh, hide), Organisations, Users, Audit.

## 6. Tests and gates

- Unit: tracking code generator (format, alphabet), status transition rules, snippet cleaning, connector parsers with fixtures.
- Database (TiDB): apply once, duplicate apply returns the same code, public track shows no personal data, staff status change writes an event and an audit row, withdraw, permissions (editor can read, user cannot), listings upsert is idempotent, hide removes from the public list.
- CI stays green (lint, format, types, unit, DB suite on TiDB, web build).
- Live check after deploy, in the browser: apply, track, staff handles it, web listings visible.

## 7. Order of work

1. This plan. 2. Migration, permissions, privacy registry. 3. Applications API and tests. 4. Listings API and tests. 5. Public web (apply, my applications, track, web jobs). 6. Staff portal rebuild. 7. Design pass. 8. Docs (`STATUS.md`, ADR rows), push, live verification.

## 8. Not in this step

Email notifications, employer-side accounts, file attachments (needs R2, gate S-8), Google connector activation (needs the owner's key), scheduled automatic refresh (S-6 scheduler); refresh runs lazily on read and from the staff button.

---

# Addendum v1.3: recommendations, interest alerts, richer home (2026-11-14)

Owner request: suggest the kinds of jobs a person is interested in (as LinkedIn does), send automatic notifications for those kinds, learn from what each person actually uses, make the home page and hero more attractive, and add whatever else makes the site complete.

## A. What "learning from use" means here (and what it does not)

A transparent scoring model, not a black box. Every suggestion says **why** it was suggested. No data leaves our database; there is no third-party model.

Signals (per signed-in person):

- **Explicit interests** the person sets: categories, keywords, preferred places, alerts on or off.
- **Activity**: views of an opportunity, saves, tracking, applying, clicks on web jobs and searches. Weights: view 1, search 1, web job click 1, save 3, track 4, apply 5; each decays with a 21-day half-life.
- **Eligibility** against the saved profile (eligible +2.5, not eligible -5).
- **Freshness and urgency**: new in the last 7 days +0.4, closing within 7 days +0.6.

Score = category (up to 4 from activity, +3 explicit) + place (up to 1.5 + 1.5 explicit) + keywords (explicit up to 4, learned from titles up to 3) + eligibility + urgency + freshness. Items already saved, tracked or applied are left out. With no signals yet, it falls back to "closing soon and eligible".

Privacy controls (plan CON rules): "Personalise with my activity" switch (default on; off stops recording and ignores history), "Clear my activity" button, activity rows older than 90 days are ignored and deleted with the account. Activity is never shown to staff.

## B. Notifications (in app; email waits for a provider)

Types: `job_match` (new or existing opportunity scores above the threshold for this person), `deadline_reminder` (saved or tracked opportunity closing within 72 hours), `application_update` (staff moved your site application). All use the existing `notifications` table with a dedupe key, so a person is told once.

When they are created: when the person opens the site (throttled to every 10 minutes), when staff **publish** an opportunity (fan-out to people with alerts on whose score passes the threshold), and when staff change an application's status. A scheduler (gate S-6) later makes reminders independent of visits.

## C. Data (migration `0004_interests.sql`)

`job_preferences` (user_id, categories, keywords, location_slugs, alerts_enabled, personalize, last_matched_at), `interaction_events` (user_id, kind, opportunity_id, listing_id, category_slug, location_slug, term, created_at). Both deleted with the account (privacy registry).

## D. API and web

API: `GET/PUT /me/preferences`, `DELETE /me/activity`, `POST /me/interactions`, `GET /me/recommendations`, `GET /me/notifications`, `POST /me/notifications/read`, `GET /me/notifications/unread-count`.
Web: Interests page, "For you" on home and dashboard (with reasons), bell with unread count, Notifications page, recorded views, a redesigned home page (hero, live counters, featured, for-you, web jobs, how it works, why us, FAQ, call to action).

## E. Tests

Unit: scoring (category, keyword, location, eligibility, exclusion, decay, cold start, reasons), keyword extraction. TiDB: interactions recorded and cleared, personalise off stops recording, recommendations differ after a person saves different categories, notifications deduped, publish fan-out reaches a matching person only, deadline reminder, application update notification, privacy registry.
