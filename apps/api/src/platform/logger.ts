import type { LoggerOptions } from 'pino';

/**
 * Structured logging with redaction (plan section 9.13, SEC-44). No bodies, no emails, no tokens, no document text.
 * The redaction list is enforced by a unit test.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'req.headers["x-csrf-token"]',
  'req.headers["x-c2a-signature"]',
  '*.password',
  '*.new_password',
  '*.current_password',
  '*.token',
  '*.email',
  '*.phone',
  '*.api_key',
  '*.secret',
  '*.prompt',
  '*.document_text',
  '*.text',
];

export function loggerOptions(level: string): LoggerOptions {
  return {
    level,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    serializers: {
      req(req: { method?: string; url?: string; id?: string }) {
        // keep method and path only; query strings can carry tokens
        return { method: req.method, url: (req.url ?? '').split('?')[0], id: req.id };
      },
    },
  };
}
