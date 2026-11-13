import type { FastifyInstance, LightMyRequestResponse } from 'fastify';

/** Minimal cookie jar and CSRF handling on top of app.inject, so tests behave like a browser. */
let nextIp = 1;

export class Browser {
  jar = new Map<string, string>();
  /** each simulated browser has its own address, so the per-IP rate limits do not couple tests */
  readonly ip = `10.1.${Math.floor(nextIp / 250)}.${(nextIp++ % 250) + 1}`;
  constructor(
    private readonly app: FastifyInstance,
    private readonly origin = 'http://localhost:3000',
  ) {}

  private store(res: LightMyRequestResponse) {
    for (const c of ([] as string[]).concat(res.headers['set-cookie'] ?? [])) {
      const [pair, ...attrs] = c.split(';');
      const [k, v] = pair!.split('=');
      if (attrs.some((a) => a.trim() === 'Max-Age=0')) this.jar.delete(k!.trim());
      else this.jar.set(k!.trim(), decodeURIComponent(v ?? ''));
    }
  }
  private cookie() {
    return [...this.jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');
  }
  async csrf() {
    this.store(
      await this.app.inject({
        method: 'GET',
        url: '/api/v1/auth/csrf',
        remoteAddress: this.ip,
        headers: { cookie: this.cookie() },
      }),
    );
  }
  async req(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ) {
    const res = await this.app.inject({
      method,
      url,
      remoteAddress: this.ip,
      headers: {
        cookie: this.cookie(),
        'content-type': 'application/json',
        'x-csrf-token': this.jar.get('c2a_csrf') ?? '',
        origin: this.origin,
        ...extra,
      },
      payload: body === undefined ? undefined : JSON.stringify(body),
    });
    this.store(res);
    return res;
  }
  async login(email: string, password: string) {
    await this.csrf();
    return this.req('POST', '/api/v1/auth/login', { email, password });
  }
}
