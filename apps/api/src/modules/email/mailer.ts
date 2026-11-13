/**
 * Transactional email port (plan Module F2). Real providers (Resend/SES) arrive with gate S-7. Messages carry a
 * template id and parameters; bodies are rendered by the provider adapter.
 */
export type MailTemplate =
  'verify_email' | 'reset_password' | 'security_notice' | 'deletion_requested';

export interface MailMessage {
  to: string;
  template: MailTemplate;
  locale: 'bn' | 'en';
  params: Record<string, string>;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/**
 * Development mailer: logs that a message was sent, never the recipient's full address or any token/link
 * (tokens in logs would be credentials).
 */
export class LogMailer implements Mailer {
  constructor(private readonly log: (obj: Record<string, unknown>, msg: string) => void) {}
  async send(m: MailMessage): Promise<void> {
    const domain = m.to.split('@')[1] ?? 'unknown';
    this.log(
      { template: m.template, locale: m.locale, recipientDomain: domain },
      'email (log provider)',
    );
  }
}

/** Test mailer that keeps messages in memory. */
export class CaptureMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  async send(m: MailMessage): Promise<void> {
    this.sent.push(m);
  }
}
