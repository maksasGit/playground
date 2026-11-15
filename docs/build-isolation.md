# M4 — Proposed local build and game-delivery architecture

Status: prepared for owner approval before executing repository build scripts.

## Build boundary

- A separate local worker process takes durable SQLite jobs, one at a time. The API never executes repository scripts.
- The worker downloads a bounded public GitHub archive pinned to the selected immutable SHA. The build root is a validated relative subdirectory (`needle-in-a-haystack` for the owner's game).
- Each job uses a disposable, non-root Docker container: read-only root filesystem, no capabilities, no new privileges, no host application directory, no secrets, no Docker socket, no privileged mode. Only the source archive and trusted runner scripts are mounted read-only.
- Limits: 2 CPUs, 3 GiB memory with no extra swap, 128 processes, 1 GiB work tmpfs, 64 MiB temporary tmpfs, 10-minute overall job deadline. Output: at most 256 MiB / 10000 files / 64 MiB per file.
- Installation uses the repository lockfile and disables lifecycle scripts. The container reaches the npm registry through a dedicated allowlist proxy on a private Docker network. The proxy only permits registry.npmjs.org:443; no application data is mounted there.
- Before build scripts run, the container is disconnected from that network. The approved preset runs npm/pnpm production build with Vite's relative base argument. Source repositories are never edited or pushed.
- Validated output is copied into a new immutable release. Symlinks, hardlinks, traversal, unsupported file types and excessive output are rejected. Publication changes the active release pointer transactionally; failures preserve the previous release. Rollback selects an existing release without rebuilding.

## Game boundary

- Local portal stays at http://127.0.0.1:5173. Game files are served on http://127.0.0.2:3003, a distinct host/origin. Portal cookies are not sent there.
- The portal issues a random, short-lived play ticket scoped to one release and the current server-side session. Every file request checks ticket expiry, live session, account status, game access and archive status. Tickets never grant portal/admin/Vault access.
- The iframe permits game scripts, audio/fullscreen and pointer lock. It cannot navigate the portal or open popups. The game origin has no public file listing and no portal API. Game responses restrict outbound connections and embedding to the configured portal.
- Production requires HTTPS on separately configured portal/game hosts. Local HTTP configuration is not a public VPS deployment.

## Verification and limits

Tests will cover artifacts, authorization, expiry/revocation, job recovery, publication failures and rollback. A real disposable-container build and browser launch of needle are required before claiming the feature works.

Docker shares a kernel/VM and is not a perfect boundary for hostile third-party repositories. This design is for the owner's team's repositories. Arbitrary shell commands, credentials in builds, unbounded host mounts and automatic publication remain disallowed.
