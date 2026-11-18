# Production deployment and automatic updates

The current VPS runs native Node.js 22 API/game-delivery and worker services under systemd, with Caddy handling HTTPS. Docker is used only for game builds. A push to `main` now updates Playground itself after GitHub Actions checks; games still require manual Check for Updates and Build & Publish.

## Files and access

- `/opt/playground`: administrative Git checkout and persistent `.env` / `data`. Do not delete or replace it.
- `/opt/playground-live`: symlink to the currently deployed application, used by both systemd services and Caddy.
- `/opt/playground-releases`: separate version directories with their own dependencies and compiled output. Each links to the same persistent data and configuration.
- `/var/backups/playground`: root-only pre-deployment archives containing `data` and `.env`. Three automatic deployment backups are retained; older manual backups are not removed.
- `/var/lib/playground-deploy/deployed-sha`: last successful deployment SHA.
- `/etc/playground-deploy.conf` and `/usr/local/lib/playground-deploy`: root-owned deployment configuration/helpers. Changes to these privileged helpers require an operator to review and rerun `infra/deploy/install.sh`; application updates do not replace privileged helpers automatically.

The Actions key is separate from the operator key. Its `authorized_keys` entry uses `restrict` and a forced command, allowing only `deploy <40-character SHA>`. It cannot open a shell, upload files, forward connections or choose deployment paths. The checked commit must be the current `origin/main`, so superseded workflows do not deploy older code. Repository writers can change application code that the deployment runs; give repository write access only to trusted developers.

## GitHub configuration

The workflow is `.github/workflows/deploy.yml`, with production deployments serialized and in-progress deployments never canceled by a newer push. PRs run checks but cannot deploy. Manual runs from `main` are also available in Actions.

Repository secrets:

- `DEPLOY_SSH_KEY`: dedicated private Ed25519 deployment key.
- `DEPLOY_KNOWN_HOSTS`: verified server Ed25519 public host-key entry. Obtain through the existing trusted operator SSH connection, not unauthenticated keyscan.

Repository variable `DEPLOY_HOST`: server IP or hostname. Domain names and addresses are configuration, not hardcoded in the workflow.

The `production` GitHub environment is restricted to deployments from `main`. No approval is required for each deployment, as requested by the owner. Actions uses pinned official checkout/setup-node commits and a read-only repository token. Secrets are never provided to PR checks.

## Update sequence and limits

1. Actions installs locked dependencies, builds shared types, runs type checks, ESLint, API tests, deployment tests, shell checks and the production build.
2. The VPS takes a deployment lock, fetches main and verifies the exact checked SHA, clean tracked checkout, backup storage paths and free disk space.
3. It waits up to 15 minutes for queued/running game builds. An immediate SQLite transaction then disables new build admission while idle; the worker is stopped to prevent it from enabling admission during staging. Existing published games and the portal remain available during staging.
4. A separate release is installed and compiled without touching the running code. API and worker are then stopped, a coherent backup is archived and checked, and the live symlink is switched atomically.
5. Both services start. Local health, worker readiness and public HTTPS health/page checks must pass. Only then is the successful SHA recorded and old automatic backups/code releases pruned. At least the current and previous code directories are retained.

If staging fails, the old site stays in place and the worker restarts. If startup/health fails after switching, the previous code symlink is restored and services restarted. **Database migrations are not automatically reversed**: restoring an old database could erase new user changes. Keep migrations compatible with the previous code. For incompatible migrations, plan an operator-led maintenance and restore procedure. Automatic code rollback does not guarantee recovery from incompatible schema changes.

Build admission remains paused while the update is staged. On this 1 CPU / 2 GiB trial VPS, updates may take several minutes; game-build containers still use the separately configured 1 GiB / 1 CPU limits. This is not a zero-downtime deployment: service switching and coherent backups cause a short interruption. Deployments never modify game repositories or automatically publish games.

## Operations and recovery

Watch workflow results on the repository Actions page. A failed check/deployment is shown there; no separate email or chat integration is configured. Manual retry: select **Check and deploy Playground → Run workflow → main**. Avoid older-SHA reruns once main has advanced.

On the VPS:

```bash
systemctl status playground-api playground-worker --no-pager
journalctl -u playground-api -u playground-worker -n 60 --no-pager
cat /var/lib/playground-deploy/deployed-sha
readlink -f /opt/playground-live
```

For data recovery, first stop **both** services. Extract the chosen archive into a new root-only recovery directory, verify it, and preserve the current data by renaming it before restoring. Restore `.env` and the entire `data` directory together, correct ownership to the application user, select compatible code, then start both services and verify health, login, game launch and comments. Never extract a backup over a live SQLite database. Backups include passwords hashes and session data; do not publish them or store them in Git.

These backups are on the same VPS and do not protect against loss/deletion of the VPS. Off-server copies and a scheduled disaster-recovery restore drill remain to be configured. Failed staging directories and `.partial` backup files are preserved for operator diagnosis and may need cleanup after repeated failures; monitor free disk space.

To disable automatic deployment, disable the workflow in GitHub Actions or remove its dedicated public key from `authorized_keys`. The existing manual operator SSH key remains independent. Do not use `git pull` plus a service restart as the normal deployment mechanism now: services run through the live symlink, not necessarily the administrative checkout.
