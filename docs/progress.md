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

## M2 — Games and Comments

Implemented admin game creation/editing, reversible archive, private image covers, a featured project and horizontal library shelf, game-detail pages, authenticated comments, author edits, Admin hide/restore, pagination and per-user posting limits. Game IDs preserve discussion and grants across renames and archiving. Additive migration 0003 preserves existing accounts and sessions.

Verification:

- `pnpm test`: 19 tests passed. Added coverage for game CRUD permissions and validation, cover re-encoding/access/upload rejection/limits, comment role/ownership/CSRF, moderation, archive/restore, pagination, renames, restart persistence and shared per-user write limits.
- `PLAYWRIGHT_CHANNEL=msedge pnpm test:e2e`: both scenarios passed, including account flow and the complete game/editor/tester workflow. Desktop and mobile screenshots reviewed; no horizontal overflow at 390px, no browser page errors, stored HTML-like text remains inert.
- Build, typecheck and lint passed. Docker runtime remains untested; the local Node/Vite servers are the current target.

No test games or credentials were inserted into the owner's database. Current game entries are metadata/discussion pages; launch is unavailable until releases exist. Next: M3 — GitHub App configuration, private repository access, branch selection and manual commit checks. Builder isolation and private artifact delivery remain later decisions requiring review.

## M3 — Public repositories and main checks (updated owner scope)

The owner requested public repositories, no GitHub App/credentials and a fixed main branch. Implemented URL normalization/validation, authenticated Admin connection management, manual GitHub checks, saved commit metadata and separate observed/published version status. Network access is bounded and pinned to GitHub; no automatic polling, cloning, building or publication occurs.

Additive migration 0004 preserves current accounts, games, comments and covers. Failed checks keep the last snapshot. Connection IDs/revisions and post-network authorization checks prevent stale responses from replacing a changed/disconnected connection or writing after session revocation.

Verification: 28 server tests passed, all three Edge browser scenarios passed (including desktop/mobile repository UI), build/typecheck/lint passed. A real unauthenticated client read the main commit of maksasGit/needle successfully without writing the working database. Docker runtime remains untested.

Next: M4 — isolated source download/build, artifact validation, publication and rollback. Builder isolation must be reviewed before untrusted scripts run. GitHub App/private repositories and selectable branches remain deferred per the owner's explicit update.

## M4 — Isolated builds, publication, rollback and protected play

Owner explicitly approved docs/build-isolation.md before repository scripts were run. Implemented durable single-worker SQLite queue, worker lease/recovery/standby, immutable SHA archives, npm/pnpm lockfile preset, registry-only install proxy with scripts disabled, network-disconnected build, non-root/read-only/CPU/memory/process/tmpfs limits and runtime isolation verification. Nested project detection found needle-in-a-haystack automatically.

Host-side tar validation rejects traversal, links, unsupported files, duplicate/case-alias paths and oversized artifacts. Successful artifacts publish via an atomic database pointer; previous releases remain for rollback. Game tickets are random, hashed, hour-limited, release/session-scoped and checked against current access on every asset. Game origin 127.0.0.2:3003 receives no portal cookies. UI provides queue/status/logs, saved releases, rollback, Play, fullscreen and standalone launch.

Verification performed:

- 35 server tests passed, including artifacts, ownership/authorization, ticket expiry/revocation, atomic failure preservation, lease/recovery and rollback.
- Build/typecheck/lint passed.
- Five Edge browser scenarios passed, including queue/publish/failed rebuild/rollback and real needle Docker-artifact play. Real game rendered WebGL; all 13 artifact files, fullscreen and desktop/mobile layout were checked.
- Actual immutable needle build: commit 850b46f169b9a5d9f32e7aed2d42891e7c13513e, 13 files / 5,773,597 bytes. Installation completed without lifecycle scripts; build ran after network removal. Containers/networks were cleaned.
- A separate real worker smoke test exercised API → durable queue → worker → Docker → immutable publication using an isolated database. Working accounts, games and comments were not replaced or seeded.
- Native portal and distinct game origin responded; unauthenticated game asset requests were denied. Compose syntax checked; full Compose worker/VPS deployment not claimed.

Limitations: preset excludes custom npm configs/hooks/workspaces and install scripts; old releases are retained without automatic GC. Pointer-lock interaction, actual audio output and non-Edge browsers were not automatically verified. Next: operational VPS/HTTPS/backups (M5) and the agreed Vault module; local game publishing/play is available now.
