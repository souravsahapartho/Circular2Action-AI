/**
 * Deletion registry (plan DEL-04): every column that references a user, with what happens on account deletion.
 * A test scans the migration and fails when a user-referencing column is missing here.
 */
export type DeletionAction =
  | 'delete' // rows (and objects first, for file tables) are deleted
  | 'anonymise' // user reference set to NULL, row kept
  | 'retain_staff' // staff accountability; handled by the staff offboarding procedure
  | 'retain_ledger'; // numeric id and timestamps only, kept for the backup-replay window

export interface RegistryEntry {
  table: string;
  column: string;
  action: DeletionAction;
}

const del = (table: string, column = 'user_id'): RegistryEntry => ({
  table,
  column,
  action: 'delete',
});
const staff = (table: string, column: string): RegistryEntry => ({
  table,
  column,
  action: 'retain_staff',
});

export const DELETION_REGISTRY: readonly RegistryEntry[] = [
  del('user_roles'),
  del('user_sessions'),
  del('auth_tokens'),
  del('mfa_recovery_codes'),
  del('user_profiles'),
  del('education_records'),
  del('work_experiences'),
  del('test_scores'),
  del('user_skills'),
  del('user_projects'),
  del('certifications'),
  del('user_languages'),
  del('saved_opportunities'),
  del('opportunity_feedback'),
  del('eligibility_results'),
  del('application_records'),
  del('user_documents'),
  del('notifications'),
  del('notification_preferences'),
  del('user_notification_settings'),
  del('ai_processing_jobs'),
  del('usage_quotas'),
  del('product_events'),
  del('upload_sessions'),
  del('idempotency_keys'),
  del('data_exports'),
  del('file_objects', 'owner_user_id'),
  { table: 'ai_usage_ledger', column: 'user_id', action: 'anonymise' },
  { table: 'user_reports', column: 'reporter_id', action: 'anonymise' },
  { table: 'deletion_requests', column: 'user_id', action: 'retain_ledger' },
  { table: 'deletion_ledger', column: 'user_id', action: 'retain_ledger' },
  { table: 'audit_logs', column: 'actor_id', action: 'retain_staff' },
  staff('user_roles', 'granted_by'),
  staff('organization_domains', 'added_by'),
  staff('organization_domains', 'approved_by'),
  staff('opportunity_sources', 'terms_reviewed_by'),
  staff('circulars', 'verified_by'),
  staff('circulars', 'created_by'),
  staff('opportunity_documents', 'uploaded_by'),
  staff('opportunity_field_evidence', 'verified_by'),
  staff('opportunity_versions', 'created_by'),
  staff('opportunity_events', 'created_by'),
  staff('opportunity_duplicates', 'decided_by'),
  staff('ai_extraction_results', 'reviewed_by'),
  staff('ai_extraction_fields', 'corrected_by'),
  staff('verification_reports', 'verifier_id'),
  staff('trust_signals', 'decided_by'),
  staff('user_reports', 'handled_by'),
  staff('system_settings', 'updated_by'),
];

/** Pseudonymous references that intentionally survive deletion (documented in plan section 15.9). */
export const PSEUDONYMOUS_COLUMNS = [
  'consent_events.subject_ref',
  'circulars.submitted_by_ref',
] as const;
