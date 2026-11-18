#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $EUID == 0 && ${1:-} =~ ^[a-f0-9]{40}$ ]] || exit 64
# Root-owned configuration; the SSH key cannot supply paths or shell commands.
# shellcheck source=/dev/null
source /etc/playground-deploy.conf
: "${APP_DIR:?}" "${RELEASES_DIR:?}" "${LIVE_LINK:?}" "${BACKUP_DIR:?}" "${APP_USER:?}"
exec 9>/run/lock/playground-deploy.lock
flock -w 60 9
sha=$1
git_app() { runuser -u "$APP_USER" -- git -C "$APP_DIR" "$@"; }
git_app fetch --no-tags origin main
if [[ $(git_app rev-parse origin/main) != "$sha" ]]; then
  echo 'A newer main commit exists; this superseded deployment is skipped.'
  exit 0
fi
[[ -z $(git_app status --porcelain --untracked-files=no) ]] || { echo 'Tracked checkout changes require operator review.' >&2; exit 1; }
previous=$(readlink -f "$LIVE_LINK")
export PLAYGROUND_LIVE="$LIVE_LINK"
state() { node /usr/local/lib/playground-deploy/state.cjs "$APP_DIR" "$1"; }
origin=$(state origin)
available=$(df -PB1 "$RELEASES_DIR" | awk 'NR==2 {print $4}')
data_size=$(du -sb "$APP_DIR/data" | cut -f1)
(( available > data_size + 1073741824 )) || { echo 'Insufficient disk space for a backup and staged release.' >&2; exit 1; }
paused=0
switched=0
stopped=0
stage=''
finish() {
  result=$?
  trap - EXIT
  set +e
  if (( result != 0 )); then
    echo 'Deployment failed; preserving all persistent data.' >&2
    if (( switched )); then
      systemctl stop playground-worker playground-api
      ln -s "$previous" "$LIVE_LINK.rollback"
      mv -Tf "$LIVE_LINK.rollback" "$LIVE_LINK"
      echo 'Previous code restored. Database migrations are NOT reversed automatically.' >&2
    fi
    if (( stopped || switched )); then systemctl start playground-api playground-worker || true
    elif (( paused )); then systemctl restart playground-worker || true
    fi
  fi
  exit "$result"
}
trap finish EXIT
trap 'exit 143' TERM HUP INT
# The immediate SQLite transaction closes the race with API build admission.
for _ in $(seq 1 90); do
  if state pause; then paused=1; break
  else
    code=$?
    [[ $code == 75 ]] || exit "$code"
  fi
  echo 'Waiting for queued/running game builds...'
  sleep 10
done
(( paused )) || { echo 'Game builds did not finish within 15 minutes.' >&2; exit 1; }
# No worker may re-enable build admission while the new version is staged.
systemctl stop playground-worker
stage="$RELEASES_DIR/$sha-$(date -u +%Y%m%dT%H%M%SZ)-$$"
install -d -o "$APP_USER" -g "$APP_USER" -m 755 "$stage"
git_app archive "$sha" | runuser -u "$APP_USER" -- tar -xf - -C "$stage"
ln -s "$APP_DIR/.env" "$stage/.env"
ln -s "$APP_DIR/data" "$stage/data"
chown -h "$APP_USER:$APP_USER" "$stage/.env" "$stage/data"
# Source files must be readable by Caddy; secrets remain only in the shared .env.
chmod -R a+rX "$stage/apps/web"
chmod a+rx "$stage/apps"
pushd "$stage" >/dev/null
runuser -u "$APP_USER" -- pnpm install --frozen-lockfile
runuser -u "$APP_USER" -- pnpm build
popd >/dev/null
chmod -R a+rX "$stage/apps/web/dist"
stopped=1
systemctl stop playground-worker playground-api
backup="$BACKUP_DIR/pre-deploy-$(date -u +%Y%m%dT%H%M%SZ)-$sha.tar.gz"
tar -czf "$backup.partial" -C "$APP_DIR" data .env
tar -tzf "$backup.partial" >/dev/null
mv "$backup.partial" "$backup"
printf 'Verified backup: %s\n' "$backup"
ln -s "$stage" "$LIVE_LINK.next"
mv -Tf "$LIVE_LINK.next" "$LIVE_LINK"
switched=1
systemctl start playground-api playground-worker
healthy=0
for _ in $(seq 1 60); do
  if curl -fsS --max-time 5 http://127.0.0.1:3001/api/health >/dev/null 2>&1 && state ready; then healthy=1; break; fi
  sleep 1
done
(( healthy ))
curl -fsS --retry 3 --retry-delay 2 --max-time 15 "$origin/api/health"
curl -fsS --retry 3 --retry-delay 2 --max-time 15 "$origin/" >/dev/null
printf '%s\n' "$sha" > /var/lib/playground-deploy/deployed-sha
echo "Deployment successful: $sha"
# Keep three code releases (including current and previous) and three backups.
mapfile -t releases < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | cut -d' ' -f2-)
for directory in "${releases[@]:3}"; do
  if [[ $directory == "$RELEASES_DIR/"* && $directory != "$stage" && $directory != "$previous" && $(basename "$directory") =~ ^[a-f0-9]{40}-[0-9TZ]+-[0-9]+$ ]]; then rm -rf --one-file-system -- "$directory"; fi
done
mapfile -t backups < <(find "$BACKUP_DIR" -maxdepth 1 -name 'pre-deploy-*.tar.gz' -type f -printf '%T@ %p\n' | sort -rn | cut -d' ' -f2-)
for file in "${backups[@]:3}"; do rm -f -- "$file"; done
