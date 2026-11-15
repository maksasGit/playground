# M3 — Public GitHub repositories, fixed main

## Agreed scope

The owner explicitly selected public game repositories without credentials and a fixed `main` branch. This replaces the original M3 defaults for GitHub App/private repositories and branch selection. Those features are deferred. Current deployment remains the owner's laptop; all connection metadata is portable to a VPS with SQLite.

## Operation

- Admin opens an existing game's editor and submits its repository URL. Only root HTTPS GitHub.com repository URLs are accepted; `.git` and a trailing slash are normalized. Credentials, query strings, fragments, ports, alternate hosts, traversal and tree/blob URLs are rejected before networking.
- Connecting checks repository metadata and `main`, and saves the canonical repository URL, immutable GitHub repository ID, commit SHA, first line of the commit message (bounded to 500 characters), commit date and check time.
- Only the explicit connect and Check for Updates mutations call GitHub. Reads, page refreshes, application startup, comments and archiving do not cause network checks. There are no webhooks, timers or background jobs.
- The application only reads metadata. It does not clone/download source, install dependencies, build, publish or modify a game repository in M3.
- Last observed and published commit SHAs are separate. Status is `not_published` when no published commit exists, `up_to_date` when SHAs match, and `update_available` otherwise. The deployed SHA column is reserved for the publication milestone; M3 never writes it. Existing data starts unpublished.

## Network and authorization

- All connection routes are administrator-only, with the existing mandatory-password gate, session validation and CSRF protection. Connect/check are rate-limited to six requests/minute/IP per route. Archived games cannot change connections or trigger checks.
- Outbound requests are constructed from validated owner/name components against fixed `https://api.github.com/repos/...` paths. Redirects are not followed. No user-controlled API origin or transport setting is exposed in production.
- The REST API version is pinned to `2026-03-10`. Requests have no Authorization header, cookie, GitHub credential, OAuth flow or GitHub App.
- Each remote request has a 10-second timeout and 1 MiB response bound. Responses are schema-validated. Private/missing repositories, missing main, redirects, network failures and GitHub limits produce fixed safe errors; raw remote bodies and exceptions are never sent to users or logs.
- Each check uses two requests: repository metadata, then main. GitHub's unauthenticated quota is 60 REST requests/hour per source IP. Limits can also be shared with other software behind that IP. This is suitable for occasional manual checks; authentication can be considered later if needed.

## Persistence and concurrent changes

Additive migration 0004 adds a per-game connection table and a nullable deployed SHA field without changing user accounts, covers, comments or grants. A failed connect/replacement/check preserves the previous successful snapshot.

Network requests run outside SQLite transactions. Before storing a response, the handler rechecks the administrator's live session and game state, and verifies connection ID plus revision in an immediate transaction. A stale result cannot overwrite a disconnect, replacement, another completed check, archived game or revoked administrator session. Repository ID changes at the same URL require reconnecting.

Disconnecting removes only the connection snapshot. It does not delete the game, discussion, cover, access grants or deployed SHA. Game renames and archive/restore preserve connections by stable game ID. Administrative actions are audited without source bytes or credentials.

## Verification

Unit/integration tests use injected transports/readers, with no production API switch for mock mode. They cover URL validation, main-only API requests, missing/private repositories, malformed/oversized responses, safe errors, comparison, permissions, CSRF, persistence, failure preservation and stale/revoked in-flight responses. Browser tests use a separate temporary database and reader fixture.

A read-only live smoke check of `https://github.com/maksasGit/needle` succeeded through the real unauthenticated client. It did not attach that repository to any game or change the working database. Building and publication are not implemented or tested in M3.

Primary references: [public branch endpoint](https://docs.github.com/en/rest/branches/branches), [REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).
