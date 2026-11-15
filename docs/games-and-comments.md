# M2 — Games, private covers and feedback

## Games

Admin-only endpoints create/update game metadata and archive/restore games. Title (1–100 characters), slug (1–80 lowercase ASCII letters/digits with hyphen separators), and description (up to 5000 characters) are validated on the server. Slugs are unique. IDs never change; renaming a game or its slug preserves access grants, cover and comments.

Archiving replaces destructive deletion. Archived games disappear from non-administrator library, detail, cover and comment access; their data and grants remain. Admins can inspect and moderate archived discussions, but nobody can add or edit comments until restoration. The games administration list includes archived entries.

There is no repository fetch, build, release, or playable artifact endpoint yet. GitHub integration is M3; isolated builds and game launch follow later.

## Covers

- Upload: one multipart file, Admin only, authenticated CSRF-protected request, 10 upload requests/minute/IP.
- Input limit: 5 MiB, 16 million pixels. Static PNG/JPEG/WebP only; SVG, other MIME types, mismatched file contents and animations are rejected.
- sharp decodes and re-encodes the image as WebP, rotates for EXIF orientation, strips metadata, and bounds dimensions to 1600×900 without enlarging. Encoded output must fit within 2 MiB.
- The bounded cover bytes are stored in a separate SQLite table, keyed by immutable game ID. This keeps small covers atomic with metadata and portable with the existing database. Vault and published game artifacts remain separate future storage modules.
- Original filenames are never used for storage or filesystem paths. External image URLs are not fetched or rendered.
- Every download checks current account, first-login restriction, game grant and archive status. Responses use image/webp, nosniff and no-store. No covers directory is exposed as static content.
- Replacement/removal is transactional; invalid uploads preserve the previous cover. Covers remain after restart and archiving.

## Comments

- Every comment references a game ID and author user ID. It is independent of releases. Text is 1–4000 characters after trimming; HTML/Markdown is not interpreted.
- Admin/Tester with game access can post. Viewer cannot post or edit. Only the author can edit a visible comment, including when the author is an administrator. Display names are looked up by author ID, so renames preserve ownership.
- Moderator actions are separate: Admin can hide/restore; hidden comments are excluded from normal reads. Only Admin can request includeHidden=1. Authors cannot edit hidden content to bypass moderation.
- Text is rendered by React as text with preserved line breaks. No dangerouslySetInnerHTML, HTML uploads or arbitrary image URLs are used.
- Posting and editing share a per-user in-memory limiter: 10 operations/minute across all games. It is independent of other users on the same IP and supplements the API-wide limiter. It resets on server restart.
- Listing supports bounded offset pagination (limit 1–50, default 20; offset 0–100000), newest first with an ID tie-breaker. Moderation and concurrent posts can change offsets between page requests; pagination is intended for the small team, not a snapshot export.
- Game management, cover changes and moderation record audit events without uploaded bytes or comment bodies. Existing sessions, CSRF protection and safe request logging apply to all mutations.

## Persistence and verification

Migration 0003 adds cover/comment tables without deleting or rewriting existing users, games or sessions. Covers and discussions are part of the same SQLite backup. No working accounts or project data are seeded by tests.

Integration tests cover permissions, CSRF, role/ownership, invalid uploads and limits, replacement preservation, moderation, deterministic pagination, renames, archive/restore, per-user rate limiting and data/session survival after API restart. Browser tests cover the complete editor/tester workflow and safe text rendering at desktop and 390px mobile widths.

Actual rollback/build validation, VPS HTTPS, Docker runtime and Vault remain outside M2 and are not claimed as tested.
