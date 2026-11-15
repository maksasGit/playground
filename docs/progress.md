# Development status

## M0 — Foundation

Implemented pnpm workspace, React/TypeScript/Vite frontend, Fastify API, shared Zod health contract, SQLite/Drizzle connection, transactional SQL migrations, environment validation, responsive foundation screen, Docker Compose/Caddy configuration and local/migration documentation.

Validated on Windows with Node.js 22.13.1:

- `pnpm build`: passed.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm test`: 3 tests passed (health/unknown routes, persistent migrations and SQLite settings, environment validation).
- Local development startup: frontend HTTP 200; proxied `/api/health` returned `{"status":"ok","database":"ok"}`.
- `docker compose config --quiet`: passed. Docker images and runtime were **not tested** because Docker Engine was unavailable.
- No visual browser automation was available; mobile appearance still requires browser review.

Runtime data is ignored by Git. No credentials or default passwords were created. Current functionality is a foundation, not a complete platform. Next: M1, administrator bootstrap, individual accounts, session security, permissions and portal pages. Security-sensitive build isolation and private game delivery remain pending design approval before their milestones.

Current deployment target: owner's work laptop, three developers, sequential builds acceptable. Keep configuration and persistent data portable to a future VPS.

## M1 — Authentication and Portal

Implemented:

- One-time interactive administrator bootstrap with hidden password input and confirmation.
- Individual accounts, Argon2id password hashes, login/logout, mandatory first/reset password change.
- Persistent server-side sessions with token hashes, 12-hour expiry, CSRF protection, login rate limiting, production Secure cookies and HTTPS-origin validation.
- User administration: create, role, display name, enable/disable, reset password, revoke sessions, per-game grants and independent Vault grants.
- Atomic protection of the last active administrator, administrative audit events and safe logging.
- Responsive Playground Dark login, library, game-detail shell, account page and team-management screens.
- Read-only game APIs enforce grants and expose no private file storage. Actual game creation, covers, comments and published releases are later milestones.

Verification executed on the local Windows laptop:

- `pnpm build`, `pnpm typecheck`, `pnpm lint`: passed.
- `pnpm test`: 10 tests passed, including first-login gating, password/session rotation, CSRF, rate limiting, disabled/reset accounts, competing administrator demotions, game grants and audit secrecy.
- `PLAYWRIGHT_CHANNEL=msedge pnpm test:e2e`: passed in installed Microsoft Edge. Covered administrator login/password change, session restore on refresh, creating a Viewer with one game grant, Viewer password change, hidden unauthorized games/admin page, safe text rendering and logout. Checked 390px mobile layout and visually reviewed desktop/mobile screenshots.
- CLI bootstrap tested with a separate disposable database: hidden input, confirmation, successful creation, and rejection of repeated bootstrap. No owner account or default password was created in the real database.
- `docker compose config --quiet`: passed. Docker images/runtime and actual HTTPS deployment remain untested because Docker Engine is unavailable.

Remaining limitations: no game CRUD, comment posting, game launch/builds, GitHub connection or Vault file operations yet. Vault permissions are stored for later use. Game/Vault file URLs remain unavailable. Local services must not be exposed publicly. Next milestone: M2 — game management and authenticated comments.

### Bootstrap input fix

Replaced the handwritten raw terminal reader with Inquirer prompts. Username and password validation now happens before confirmation, with specific errors and retries in place. Password input is masked with asterisks. The 12–128 character policy is unchanged; no owner credentials or working data were modified.

Verified: 13 server tests, API typecheck/build, lint, and interactive PowerShell checks of short-password feedback, confirmation mismatch, cancellation and successful creation on a separate test database.
