# AGENTS.md — Playground

## 1. Project Mission

Build **Playground**, a small, private, self-hosted web platform for publishing, playing, and testing HTML5 games.

The platform is intended for approximately 3–10 users initially.

The owner must be able to:
- Add games through a web administration panel.
- Connect private GitHub repositories.
- Check for new commits manually.
- Build and publish selected game versions.
- Manage users and permissions.
- Read and moderate feedback from testers.
- Store and share small development assets in a private Vault.

Playground must remain simple, secure, maintainable, and suitable for deployment on a single VPS.

This file is the primary instruction document for coding agents working on Playground.

**Before changing frontend design or Vault functionality, also read `DESIGN_AND_VAULT.md`.**

---

## 2. Confirmed Product Decisions

- Hosting: one VPS.
- Expected users: 3–10 initially.
- Games: browser-based HTML5 games using Vite, JavaScript, or TypeScript.
- GitHub repositories: private repositories must be supported.
- Game management: web-based admin panel.
- Deployment: manual Check for Updates and Build & Publish actions.
- Authentication: administrator-created individual accounts.
- Registration: no public registration.
- Roles: Admin, Tester, Viewer.
- Comments: authenticated users, attached to individual games.
- Vault: private development asset storage.
- UI: original Steam-inspired dark gaming library.
- Mobile support: required.
- Architecture: simple monorepo, no unnecessary microservices.

Do not implement automatic GitHub polling or webhooks until explicitly requested.

---

## 3. Technology Stack

Recommended defaults:

### Frontend
- React
- TypeScript
- Vite
- Responsive CSS
- React Router or equivalent

### Backend
- Node.js LTS
- Fastify
- TypeScript
- Zod for input validation

### Database
- SQLite
- Drizzle ORM
- Database migrations
- WAL mode and foreign keys enabled

### Infrastructure
- Docker Compose
- Caddy reverse proxy
- HTTPS
- Persistent VPS storage

### Build System
- Isolated, disposable build environments
- Node.js LTS
- Lockfile-based dependency installation
- Vite production builds

### GitHub Integration
- GitHub App
- Read-only repository Contents and Metadata permissions
- Short-lived installation tokens

Use a pnpm workspace monorepo unless there is a compelling reason to change.

Avoid Kubernetes, Redis, microservices, distributed queues, and unnecessary external services.

---

## 4. Suggested Project Structure

```text
playground/
├── apps/
│   ├── web/
│   │   └── React frontend
│   └── api/
│       └── Fastify backend
├── packages/
│   └── shared/
│       └── Shared types and schemas
├── infra/
│   ├── docker/
│   ├── caddy/
│   ├── scripts/
│   └── backups/
├── data/
│   ├── database/
│   ├── builds/
│   ├── vault/
│   └── logs/
├── AGENTS.md
├── DESIGN_AND_VAULT.md
├── README.md
└── docker-compose.yml
```

The `data` directory contains runtime files and must never be committed to Git.

---

## 5. User Accounts and Authentication

Individual accounts are required from the first release.

### Account creation

Only administrators may create accounts.

Each account contains:
- Unique username
- Optional display name
- Initial password
- Role
- Account status
- Game access permissions
- Vault permissions

There is no public registration.

### Roles

**Admin**
- Full access to Playground.
- Create and manage users.
- Assign roles and permissions.
- Add, edit, and archive games.
- Connect GitHub repositories.
- Check for updates.
- Build, publish, and roll back games.
- Moderate comments.
- Manage Vault files.

**Tester**
- Access authorized games.
- Play games.
- Read and write comments.
- Use Vault only when explicitly permitted.
- Cannot manage users or game deployments.

**Viewer**
- Access authorized games.
- Play games.
- Read comments.
- Cannot post comments.
- No Vault access by default.
- Cannot access administration functionality.

### Security requirements

- Hash passwords using Argon2id or a reviewed secure equivalent.
- Never store plaintext passwords.
- Force password change on first login.
- Force password change after administrator password reset.
- Use secure, revocable server-side sessions.
- Use HttpOnly, Secure cookies and appropriate SameSite settings.
- Protect state-changing requests against CSRF.
- Rate-limit login attempts.
- Revoke sessions when an account is disabled or its password is reset.
- Prevent deletion, disabling, or demotion of the last active administrator.
- Record security-sensitive administrative actions.
- Never log passwords or authentication tokens.

Create the initial administrator using a one-time setup command. Never ship a hardcoded default password.

### Permissions

Authorization must be enforced by the backend.

Do not rely on hiding buttons in the frontend.

Each user may have access to specific games.

Vault permissions must be independent from game permissions.

All access should be denied by default unless explicitly granted.

---

## 6. Game Management

Administrators can manage games through the website.

Each game should contain:
- Unique ID
- Slug
- Title
- Description
- Cover image
- GitHub repository
- Branch
- Build configuration
- Current deployed commit
- Current active release
- Visibility and access permissions
- Creation and update timestamps

### Adding a game

1. Administrator opens the Games administration page.
2. Clicks Add Game.
3. Enters a GitHub repository URL.
4. Selects the branch.
5. Configures supported build settings.
6. Adds title, description, and cover.
7. Saves the game.

Private GitHub access must be authorized through the configured GitHub App.

Pasting a private repository URL alone does not grant access.

---

## 7. GitHub Updates

Updates are manual in the first release.

### Check for Updates

When the administrator clicks Check for Updates:

1. Backend checks the selected repository branch.
2. Retrieves the latest commit SHA.
3. Compares it with the deployed commit.
4. Displays whether an update exists.
5. Does not automatically deploy.

### Build & Publish

When the administrator clicks Build & Publish:

1. Create a durable build job.
2. Fetch the selected immutable commit SHA.
3. Prepare an isolated build environment.
4. Install dependencies.
5. Execute the approved build preset.
6. Validate the output.
7. Store the result as a new immutable release.
8. Publish it atomically.
9. Preserve the previous successful release.

If a build fails, the currently published version must remain playable.

Provide sanitized build logs and clear build status.

### Rollback

Administrators must be able to restore a previous successful release without rebuilding it.

---

## 8. Secure Build System

Treat game repositories and their dependencies as untrusted code.

Never execute repository build scripts inside the main API process.

Build environments must:
- Be disposable.
- Run without privileged mode.
- Run as a non-root user.
- Have no access to application secrets.
- Have no access to GitHub credentials.
- Have no Docker socket mounted inside.
- Have strict CPU, memory, disk, process, and time limits.
- Have restricted filesystem access.
- Have controlled network access.

Dependency installation may require internet access. Use controlled registry access where necessary.

Docker alone is not a perfect security boundary. For repositories outside the owner's trusted control, consider a dedicated build VM.

### Build presets

Initially support:
- Node.js LTS
- npm or pnpm
- Lockfile-based installation
- Standard production build
- `dist/` output directory

Do not execute arbitrary shell commands constructed from user input.

### Artifact validation

Before publication:
- Verify `index.html` exists.
- Validate output paths.
- Reject dangerous symlinks.
- Enforce file count and size limits.
- Validate supported content types.
- Prevent files from escaping the release directory.

---

## 9. Game Hosting and Isolation

Portal example:

`https://playground.example.com`

Game page example:

`https://playground.example.com/games/needle-in-a-haystack`

Hosted game example:

`https://games.example.com/needle-in-a-haystack/releases/123/`

These are placeholders, not configured domains.

Serve games as static files from an isolated origin.

Do not give hosted game JavaScript access to:
- Administrator sessions
- Portal authentication tokens
- GitHub credentials
- Private Vault files
- Backend secrets

Use sandboxed iframes with only the necessary capabilities.

Test:
- WebGL
- Mobile touch
- Audio after user interaction
- Fullscreen
- Pointer lock
- Dynamic asset loading
- Vite base paths

Private game assets must enforce authorization. An unauthorized user must not be able to bypass access restrictions by opening an asset URL directly.

---

## 10. Comments and Feedback

Comments belong to individual games.

Each comment must contain:
- Unique ID
- Game ID
- Author user ID
- Body
- Creation timestamp
- Optional edit timestamp
- Moderation status

Requirements:
- Only authenticated users with permission can comment.
- Viewer accounts cannot post comments.
- Comments must persist across game updates.
- Comments must persist across rollbacks.
- Render user content safely as text.
- Prevent stored XSS.
- Limit comment length.
- Apply posting rate limits.
- Support pagination.
- Allow administrators to moderate comments.
- Preserve ownership when users change display names.

Do not implement anonymous comments.

---

## 11. Playground Vault

Playground includes a private file storage module.

Purpose:
- Store audio assets.
- Store textures and images.
- Store 3D models.
- Store small development files.
- Share assets between authorized users.

### Storage

Use:
- Persistent VPS filesystem for file bytes.
- SQLite for metadata.
- Separate directories for Vault and game builds.

### Functions

- Browse folders.
- Create folders.
- Upload files.
- Download files.
- Rename files.
- Delete files.
- Preview supported images.
- Play supported audio files.
- View file metadata.

### Permissions

Admin has full access.

Tester and Viewer have no Vault access unless explicitly granted.

Support separate permissions for:
- Reading
- Uploading
- Managing files

### Security

- Files private by default.
- Never expose Vault storage directly through the public web server.
- Check authorization on every operation.
- Validate filenames and file types.
- Generate opaque storage keys.
- Prevent path traversal and symlink attacks.
- Enforce upload quotas.
- Limit request size and concurrency.
- Do not execute uploaded files.
- Do not extract uploaded archives on the server.
- Do not render uploaded HTML or SVG as trusted content.

Suggested initial maximum file size: 25 MiB, configurable.

### Backups

Back up Vault files and SQLite metadata together.

Verify restore procedures.

Do not automatically insert Vault assets into game repositories or builds.

Read `DESIGN_AND_VAULT.md` for detailed requirements.

---

## 12. Visual Design

Use the original **Playground Dark** visual direction.

The interface may take inspiration from Steam's browsing experience but must not copy its branding, artwork, or exact layout.

Primary navigation:
- Library
- Game Page
- Vault
- Admin

Design priorities:
- Dark navy interface.
- Attractive game covers.
- Horizontal game shelves.
- Clear Play buttons.
- Responsive mobile layout.
- Accessible navigation.
- Readable text.
- Minimal loading overhead.

Always read `DESIGN_AND_VAULT.md` before changing visual design.

---

## 13. Database

Suggested tables:

### users
- id
- username
- display_name
- password_hash
- role
- status
- must_change_password
- created_at
- updated_at
- last_login_at

### sessions
- id
- user_id
- token_hash
- expires_at
- revoked_at
- created_at

### games
- id
- slug
- title
- description
- cover
- repository
- branch
- build_configuration
- active_release_id
- created_at

### game_access
- user_id
- game_id
- granted_by
- granted_at

### user_permissions
- user_id
- permission
- granted_by

### releases
- id
- game_id
- commit_sha
- status
- artifact_path
- created_at
- published_at

### build_jobs
- id
- game_id
- commit_sha
- status
- started_at
- finished_at
- error_summary

### comments
- id
- game_id
- author_user_id
- body
- created_at
- edited_at
- deleted_at

### vault_folders
- id
- parent_id
- name
- created_at

### vault_files
- id
- folder_id
- original_filename
- storage_key
- mime_type
- size
- checksum
- uploaded_by
- created_at

### audit_events
- id
- actor_user_id
- action
- target
- timestamp
- metadata

Use database migrations and appropriate indexes and foreign keys.

---

## 14. Operational Requirements

- HTTPS only in production.
- Restrict public ports.
- Use SSH keys for VPS administration.
- Keep database and builder services internal.
- Keep secrets in environment configuration.
- Never commit `.env` files containing secrets.
- Provide `.env.example`.
- Configure health checks.
- Configure log rotation.
- Monitor disk space.
- Back up SQLite and persistent files.
- Document deployment and restore procedures.
- Keep at least one previous successful release.
- Support local development without production GitHub credentials.

---

## 15. Development Milestones

### M0 — Foundation

Implement:
- Monorepo.
- TypeScript configuration.
- Frontend and backend applications.
- Shared package.
- SQLite and migrations.
- Local Docker Compose.
- Environment validation.
- README.
- Testing and linting.

Acceptance:
- Local startup works.
- API health endpoint works.
- Migrations work.
- No secrets are committed.

### M1 — Authentication and Portal

Implement:
- Playground Dark responsive layout.
- Library page.
- Game detail page.
- Administrator bootstrap.
- Login and logout.
- Administrator-created accounts.
- Admin, Tester, Viewer roles.
- First-login password change.
- User management.
- Per-game access.
- Secure sessions.
- Authorization middleware.

Acceptance:
- No public registration.
- Admin can create accounts.
- Tester can access permitted games.
- Viewer cannot comment.
- Disabled accounts cannot sign in.
- Unauthorized users cannot retrieve private game files.
- Last active administrator is protected.

### M2 — Games and Comments

Implement:
- Game CRUD.
- Covers and descriptions.
- Game detail page.
- Authenticated comments.
- Moderation.
- Pagination.
- Rate limiting.

Acceptance:
- Comments belong to the correct game.
- Comments survive restarts.
- Comment rendering is XSS-safe.

### M3 — GitHub Integration

Implement:
- GitHub App configuration.
- Private repository access.
- Branch selection.
- Commit SHA retrieval.
- Manual Check for Updates.
- Remote/deployed version comparison.

Acceptance:
- Authorized private repositories work.
- Tokens remain secret.
- Invalid repositories are rejected.

### M4 — Build and Publish

Implement:
- Durable build jobs.
- Isolated builder.
- Dependency installation.
- Vite production builds.
- Artifact validation.
- Immutable releases.
- Atomic publication.
- Build logs.
- Rollback.

Acceptance:
- Example Vite games run on desktop and mobile.
- Failed builds preserve the previous release.
- Interrupted jobs recover safely.
- Resource limits are enforced.

### M5 — VPS Deployment

Implement:
- Production Docker Compose.
- Caddy.
- HTTPS.
- Separate portal and game origins.
- Private game asset access.
- Backups.
- Restore documentation.
- Monitoring and operational checks.

Acceptance:
- Authorized testers can play and comment.
- Unauthorized visitors cannot retrieve private game assets.
- Backups can be restored.

### M6 — Optional Future Improvements

Possible future features:
- Two-factor authentication.
- Self-service password recovery.
- GitHub webhooks.
- Automatic commit checks every 15–30 minutes.
- Notifications.
- Analytics.
- Release notes.
- More detailed permissions.

Do not implement without approval.

### M7 — Playground Vault

Implement:
- Storage and access model.
- Vault database migrations.
- Folder management.
- Secure uploads.
- Secure downloads.
- File previews.
- File deletion and renaming.
- Access permissions.
- Upload limits.
- Backup and restore verification.

Acceptance:
- Files survive server restarts.
- Unauthorized users cannot access files.
- Invalid uploads are rejected.
- Path traversal is prevented.
- Database and files can be restored together.

---

## 16. Testing Requirements

### Unit Tests
- Input validation.
- Role permissions.
- Game access.
- Comment ownership.
- Commit comparison.
- Release transitions.

### Integration Tests
- Database migrations.
- Authentication.
- Account creation.
- Session revocation.
- GitHub integration with mocks.
- Build job recovery.
- Rollback.

### Security Tests
- Unauthorized game access.
- Unauthorized Vault access.
- XSS.
- CSRF.
- Login rate limiting.
- Token redaction.
- Path traversal.
- Malicious symlinks.
- Concurrent publication attempts.

### End-to-End Tests
- Admin login.
- Account creation.
- First password change.
- Tester login.
- Game launch.
- Comment posting.
- Build and publish.
- Rollback.
- Mobile layout.

---

## 17. Codex Working Rules

1. Read `AGENTS.md` before significant work.
2. Read `DESIGN_AND_VAULT.md` before frontend or Vault changes.
3. Work on one milestone at a time.
4. Before implementation, explain the planned changes.
5. Request approval for security-sensitive architectural decisions.
6. Prefer simple, maintainable solutions.
7. Do not add unrelated features.
8. Never weaken authentication or authorization for convenience.
9. Never expose private repositories or assets.
10. Never run untrusted build scripts in the API process.
11. Never hardcode passwords, tokens, secrets, or domains.
12. Validate all untrusted inputs on the server.
13. Use database migrations for schema changes.
14. Preserve user data during updates.
15. Preserve the last working game release after failures.
16. Add tests for new functionality.
17. Report which tests were actually executed.
18. Keep game repositories independent from Playground.
19. Do not automatically modify hosted game source code.
20. Document required Vite configuration when necessary.
21. Do not delete production data to solve development problems.
22. At the end of each milestone, summarize changes, verification steps, limitations, and the next milestone.

---

## 18. Explicitly Out of Scope

Do not implement in the initial MVP:
- Payments.
- Advertisements.
- Public registration.
- Social feeds.
- Game rankings.
- Achievements.
- Multiplayer infrastructure.
- YouTube Playables SDK.
- Native game hosting.
- Unity or Godot build support.
- Automatic deployment.
- Large-scale analytics.
- Public asset marketplace.

---

## 19. Open Deployment Decisions

These must be configured later:
- VPS provider and specifications.
- Linux distribution.
- Domain and subdomains.
- GitHub App installation.
- Backup destination.
- Backup retention.
- Initial administrator setup.
- Exact private static-file delivery strategy.
- Final builder isolation design.

Do not invent these values.

---

## 20. Final Principle

Playground should remain a small, reliable platform that makes it easy to share games with trusted testers.

Prioritize:

**Security → Reliability → Playability → Simplicity → Visual Polish → Additional Features**

Do not overengineer the system for hypothetical future scale.