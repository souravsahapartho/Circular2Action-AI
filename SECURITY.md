# Security policy

## Reporting a vulnerability

Please report security problems privately through GitHub: **Security tab, "Report a vulnerability"** on this repository.
Do not open a public issue for a vulnerability. Include what you found, how to reproduce it and the impact.
You will get an acknowledgement; there is no bug bounty.

## Scope

The web app, the API and the database schema in this repository. Never test against other people's accounts or data.

## Practices

- Secrets are set only in platform environment settings; `.env*` files are git-ignored.
- Passwords are hashed with Argon2id; staff sign-in requires an authenticator code.
- State-changing requests need a CSRF token and a matching Origin.
- CI runs secret scanning (gitleaks) and a dependency audit on every push.
