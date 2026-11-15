# M1 — Accounts and authorization

This implements the authentication model already specified in AGENTS.md. It does not decide builder isolation or private game-file delivery, which remain later architectural decisions.

## Credentials and bootstrap

- Argon2id, 64 MiB memory, 3 iterations, parallelism 1, independent random salt per password. Passwords must contain 12–128 characters.
- The one-time interactive `admin:create` command creates the first Admin. Passwords are masked with asterisks and confirmed using Inquirer terminal prompts; invalid fields can be retried in place, with specific messages that never contain the password. There are no credentials in command arguments, environment defaults or source code.
- All new and reset accounts must change their password before any library or administration access. Password change requires the current password and rotates the session.
- Only a live Admin session can create or manage subsequent users. Usernames are normalized to lowercase and unique without regard to case. No public registration or account deletion endpoint exists.

## Sessions and CSRF

- A 256-bit random session token is stored in a host-only HttpOnly cookie. Only its SHA-256 digest is stored in SQLite. Session expiry is fixed at 12 hours, not extended by reads.
- Production uses a `__Host-` cookie with Secure, Path=/, no Domain, and SameSite=Strict. Production startup requires an HTTPS APP_ORIGIN. Local HTTP development uses an unprefixed cookie without Secure; both servers listen only on loopback by default.
- Each session has a separate random CSRF token, returned by the same-origin session endpoint and held in frontend memory. Authenticated mutations require this token in X-CSRF-Token.
- All mutations, including login, require X-Playground-Request: 1. Browser cross-origin requests with this custom header require preflight; the server does not enable CORS. An Origin header, when present, must match configured APP_ORIGIN exactly; cross-site Sec-Fetch-Site requests are rejected. Thus login is protected before a session exists, without a public token endpoint.
- Password changes, administrative resets, disabling, and role changes revoke existing sessions. Administrators can also revoke sessions explicitly. Access grants are read on every request, so removing a grant takes effect immediately.
- Rate limiting: 300 requests/minute globally within the account routes, 10 login/password-change attempts per 15 minutes per IP, 10 account creations/password resets per minute per IP. Proxy headers are not trusted. This in-memory limiter resets on restart and is suitable for one process; persistent/distributed limits are not implemented.

## Authorization and data

- Admin has full game access. Tester and Viewer need explicit game grants. A missing grant returns 404 for game details and excludes the game from the library. Viewer is never marked as able to comment. Comment write endpoints arrive with M2 and must enforce the role independently.
- Vault grants are stored separately as read/upload/manage permissions. File operations and enforcement of these grants arrive with the Vault module; there are no file-serving endpoints at M1.
- The last active administrator cannot be disabled or demoted. Check and mutation happen in one immediate SQLite transaction, including competing changes.
- All queries use bound parameters. User-supplied text is rendered by React as text. API replies do not include password hashes, session token digests, or other users' credentials.
- Audit events record account operations and login outcomes without credentials, CSRF values or raw session tokens. Request bodies are not logged; cookie, authorization, CSRF and Set-Cookie headers are redacted.
- Game and Vault storage are never mounted as public static directories. No published game files are served yet; requests for them return 404. Complete game launch and isolated file delivery require later milestones.

## Local operation and future VPS

Sessions, users, grants and audit events are all in the existing persistent SQLite database, migrated in place without deleting M0 data. Moving the complete stopped data directory/volume preserves accounts and grants. Switching from local HTTP to production HTTPS changes the cookie name, so users sign in again.

Local Compose remains HTTP and loopback-only; Docker runtime and production HTTPS are not verified in M1. Do not expose Vite or the local Compose configuration to the internet.
