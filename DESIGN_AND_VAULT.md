# Playground — Design Direction & Vault Specification

## 1. Product Vision

Playground is a private web gaming library where a small group of users can play browser games, leave feedback, and access shared development assets.

The experience should feel like a polished miniature gaming platform rather than a generic administration dashboard.

The visual direction is inspired by the atmosphere and browsing patterns of Steam, but the design must be original.

Target audience: 3–10 administrator-created users initially.

---

## 2. Visual Identity

Design name: **Playground Dark**

### Mood

- Dark navy.
- Modern gaming platform.
- Clean and polished.
- Compact but readable.
- Visually focused on game artwork.
- Friendly rather than overly corporate.
- Subtle interactions and animations.

### Suggested Color Palette

```css
:root {
  --bg: #111827;
  --surface: #1B2838;
  --card: #243B53;
  --accent: #36B8E9;
  --success: #91C94C;
  --text: #F3F7FA;
  --muted: #A8BACB;
}
```

These are initial design tokens and may be refined during implementation.

### Important Design Rules

- Use original branding.
- Do not copy Steam logos, artwork, CSS, or exact layouts.
- Make game covers the primary visual elements.
- Use a clear visual hierarchy.
- Keep navigation simple.
- Avoid excessive glow.
- Avoid tiny text.
- Avoid unnecessarily heavy animations.
- Support keyboard navigation.
- Provide visible focus indicators.
- Support reduced-motion preferences.
- Maintain readable contrast.

---

## 3. Site Navigation

Main sections:

1. Library
2. Game Page
3. Vault
4. Admin

Administration navigation must only appear for authorized users.

---

## 4. Library Page

The Library is the main landing page after login.

### Layout

- Header with Playground branding.
- Navigation.
- Current user information.
- Featured game area.
- Horizontal game shelves.
- Game cover cards.
- Game update status.
- Optional search and filters.

### Game Cards

Each card should display:
- Cover image.
- Game title.
- Short description or category.
- Current availability.
- Last update information.

Cards should support:
- Hover and focus effects on desktop.
- Touch interaction on mobile.
- Clear navigation to the game page.

Do not require hovering to discover essential information.

### Featured Game

The featured area may contain:
- Large game artwork.
- Game title.
- Short description.
- Prominent Play button.
- Latest update information.

---

## 5. Game Page

Each game must have its own page.

### Required Content

- Game title.
- Cover or hero image.
- Description.
- Play button.
- Game version or commit information.
- Last deployment date.
- Comments.
- Optional update notes.

### Playing Games

Launch games from an isolated origin.

Support:
- Desktop browsers.
- Mobile browsers.
- Touch controls.
- WebGL.
- Audio after user interaction.
- Fullscreen where supported.

Provide an option to open the game directly if embedding is unavailable.

### Comments

Comments should appear below the game information or beside the game on wider screens.

Each comment displays:
- Author display name.
- Timestamp.
- Text.
- Moderation actions when authorized.

Only authorized Tester and Admin accounts can post comments.

Viewer accounts may read comments but cannot post them.

---

## 6. Administration Interface

Administrators need a practical interface for managing the platform.

### Games

- Add game.
- Edit game.
- Archive game.
- Connect private GitHub repository.
- Select branch.
- Check for updates.
- Build and publish.
- View build logs.
- Roll back release.

### Users

- List users.
- Create user.
- Assign role.
- Assign game access.
- Assign Vault permissions.
- Disable or enable account.
- Reset password.
- Revoke sessions.

### Comments

- View comments.
- Moderate comments.
- Remove inappropriate or unwanted comments.

The administration UI should share the Playground Dark design language.

It should remain functional and easy to navigate.

---

## 7. Authentication Screens

### Login Page

Provide:
- Username field.
- Password field.
- Sign In button.
- Clear error messages.

Do not expose whether a specific username exists through overly detailed login errors.

### First Login

Users created by an administrator must change their initial password.

### Account Management

Only administrators can create users.

There is no public registration page.

### Roles

**Admin**
- Full platform management.

**Tester**
- Play authorized games.
- Read and write comments.
- Optional Vault permissions.

**Viewer**
- Play authorized games.
- Read comments.
- No posting permissions.
- No Vault access by default.

Individual game and Vault permissions must be enforced by the backend.

---

## 8. Responsive Design

### Desktop

- Horizontal shelves with navigation arrows.
- Multiple game cards per row.
- Optional expanded game details.
- Comfortable reading width.
- Clear navigation.

### Mobile

- Swipeable horizontal shelves.
- Responsive cards.
- Large touch targets.
- Collapsible details.
- Full-width Play button where appropriate.
- Comments below game information.
- Full-width Vault file browser.

Do not force landscape orientation for the website.

Individual games may implement their own responsive controls.

---

## 9. Playground Vault

The Vault is a private file storage area for development assets.

It is independent of game repositories and published builds.

### Intended Files

Initially consider supporting:

- MP3
- WAV
- OGG
- PNG
- JPG/JPEG
- WEBP
- GLB
- GLTF
- BIN
- JSON
- TXT
- ZIP

The final allowlist must be reviewed before implementation.

ZIP files may be stored and downloaded, but must not be extracted automatically on the server.

### Main Features

- Folder navigation.
- Folder creation.
- File uploads.
- File downloads.
- File renaming.
- File deletion.
- File metadata.
- Image previews.
- Audio playback.

3D model preview may be added later after reviewing security and performance.

### Storage

Use persistent VPS storage for file bytes.

Use SQLite for metadata.

Keep Vault storage separate from game release storage.

### File Metadata

Each file should have:
- Unique ID.
- Original filename.
- Internal storage key.
- MIME type.
- File size.
- Checksum.
- Folder ID.
- Uploading user ID.
- Creation timestamp.

### Permissions

All Vault files are private by default.

Admin has full access.

Tester and Viewer have no access unless explicitly granted.

Support separate grants for:
- Read
- Upload
- Manage

### Security

- Enforce authorization on the server.
- Never expose the Vault directory as a public static folder.
- Validate file extensions and MIME types.
- Generate opaque storage keys.
- Prevent path traversal.
- Prevent symlink attacks.
- Enforce upload size limits.
- Enforce rate limits.
- Do not execute uploaded files.
- Do not render uploaded HTML or SVG as trusted content.
- Serve potentially unsafe formats as downloads.
- Protect against CSRF.
- Restrict upload concurrency.

Suggested initial maximum file size: 25 MiB.

Total storage quota must be configurable.

### Backups

Back up both:
- File bytes.
- SQLite metadata.

Restore both together.

### Relationship to Games

Vault must not automatically modify GitHub repositories.

Vault files are not automatically included in game builds.

Developers explicitly download or integrate assets into their projects.

---

## 10. Development Phases

### Phase A — Visual Foundation

- Playground Dark design system.
- Responsive navigation.
- Library page.
- Game cards.
- Game detail layout.

### Phase B — Accounts and Core Platform

- Administrator-created accounts.
- Login and sessions.
- Roles and permissions.
- Per-game access.
- Authenticated comments.
- GitHub integration.
- Manual build and publish.

### Phase C — Vault

- File and folder storage.
- Secure uploads.
- Downloads.
- Previews.
- Permissions.
- Backup verification.

### Phase D — Future Improvements

Optional:
- Two-factor authentication.
- Account recovery.
- Per-file sharing.
- Asset-to-repository workflows.
- More detailed permissions.

---

## 11. Non-Goals

Playground is not intended to become:
- A commercial game storefront.
- A Steam clone.
- A social network.
- A payment platform.
- An asset marketplace.
- An unlimited public file hosting service.

---

## 12. Final Design Principle

Playground should feel like a small, premium, private gaming library.

The games are the main attraction.

Administration and asset storage should be powerful but unobtrusive.

Every design decision should improve the experience of discovering, playing, testing, or managing games.