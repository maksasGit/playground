# M4 — Local build and game-delivery architecture

Status: explicitly approved by the owner on 2026-11-15 and implemented. Real needle container builds and protected iframe launch were verified. See README for operation and verification commands.

## Build boundary

- A separate local worker process takes durable SQLite jobs, one at a time. The API never executes repository scripts.
- The worker downloads a bounded public GitHub archive pinned to the selected immutable SHA. The build root is a validated relative subdirectory (`needle-in-a-haystack` for the owner's game).
- Source archives are limited to 100 MiB, unpacked source to 600 MiB / 50000 files. `.` uses the repository root or discovers one nested project with a build script and lockfile when the root has no package.json. Ambiguous projects require an explicit directory.
- Each job uses a disposable, non-root Docker container: read-only root filesystem, no capabilities, no new privileges, no host application directory, no secrets, no Docker socket, no privileged mode. Only the source archive and trusted runner scripts are mounted read-only.
- Limits: 2 CPUs, 3 GiB memory with no extra swap, 128 processes, 1 GiB work tmpfs, 64 MiB temporary tmpfs, 10-minute overall job deadline. Output: at most 256 MiB / 10000 files / 64 MiB per file.
- Installation uses the repository lockfile and disables lifecycle scripts. The container reaches the npm registry through a dedicated allowlist proxy on a private Docker network. The proxy only permits registry.npmjs.org:443; no application data is mounted there.
- The current preset supports npm package-lock.json and pnpm-lock.yaml (pnpm 10.34.5). Source symlinks, custom .npmrc/pnpm hooks and pnpm workspaces are rejected. npm lockfile remote URLs must point to the npm registry. Dependencies requiring install scripts or external registries are not supported by this preset.
- Before build scripts run, the container is disconnected from that network. The approved preset runs npm/pnpm production build with Vite's relative base argument. Source repositories are never edited or pushed.
- Validated output is copied into a new immutable release. Symlinks, hardlinks, traversal, unsupported file types and excessive output are rejected. Publication changes the active release pointer transactionally; failures preserve the previous release. Rollback selects an existing release without rebuilding.
- The worker verifies actual Docker user/capability/memory/CPU/process/read-only-mount settings before installation and verifies zero attached networks before build. Job logs are bounded and sanitized. Cleanup removes only resources named for that job.
- A lease permits one active worker; extra workers wait in standby. On recovery, interrupted jobs fail without touching active releases. Queued jobs persist. Publication rechecks the worker lease, game/archive state, repository connection and administrator status. Rollback is blocked while a build is pending for that game.

## Game boundary

- Local portal stays at http://127.0.0.1:5173. Game files are served on http://127.0.0.2:3003, a distinct host/origin. Portal cookies are not sent there.
- The portal issues a random, short-lived play ticket scoped to one release and the current server-side session. Every file request checks ticket expiry, live session, account status, game access and archive status. Tickets never grant portal/admin/Vault access.
- Tickets expire after one hour and are stored only as SHA-256 hashes. Restarting a game obtains a new ticket. Existing open sessions may finish an older immutable release after a new version is published; new launches select the active release. Game access logs are disabled to avoid logging tickets.
- The iframe permits game scripts, audio/fullscreen and pointer lock. It cannot navigate the portal or open popups. The game origin has no public file listing and no portal API. Game responses restrict outbound connections and embedding to the configured portal.
- Production requires HTTPS on separately configured portal/game hosts. Local HTTP configuration is not a public VPS deployment.

## Verification and limits

Verified: 35 server tests, browser build/play/failure/rollback flow, real worker/API/Docker publication on a separate database, real needle WebGL rendering, all output assets, fullscreen, desktop/mobile layout, and disposable-container cleanup. Browser workflow tests use a fixture worker; the separate smoke-worker command verifies the real worker. Actual audio output, pointer-lock interaction and non-Edge browsers are not automatically tested.

All successful releases are retained (the UI shows the latest 50). There is no automatic garbage collection yet. At least 1 GiB of free host disk space is required before a build. Back up SQLite and the release files together while API and worker are stopped. Compose portal/file serving is configured, but full Compose-host worker deployment and public VPS HTTPS remain M5 work; local native Node plus Docker is the verified deployment.

Docker shares a kernel/VM and is not a perfect boundary for hostile third-party repositories. This design is for the owner's team's repositories. Arbitrary shell commands, credentials in builds, unbounded host mounts and automatic publication remain disallowed.
