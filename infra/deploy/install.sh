#!/usr/bin/env bash
# Run once by the operator over the existing administrative SSH connection.
set -euo pipefail
[[ $EUID == 0 ]] || exit 64
APP_DIR=${APP_DIR:-/opt/playground}
APP_USER=${APP_USER:-playground}
RELEASES_DIR=${RELEASES_DIR:-/opt/playground-releases}
LIVE_LINK=${LIVE_LINK:-/opt/playground-live}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/playground}
for value in "$APP_DIR" "$RELEASES_DIR" "$LIVE_LINK" "$BACKUP_DIR"; do
  [[ $value =~ ^/[a-zA-Z0-9/_-]+$ && $value != / ]] || exit 64
done
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
install -d -m 755 /usr/local/lib/playground-deploy "$RELEASES_DIR"
install -d -m 700 "$BACKUP_DIR" /var/lib/playground-deploy
install -m 755 "$source_dir/deploy.sh" /usr/local/lib/playground-deploy/deploy.sh
install -m 755 "$source_dir/ssh-entrypoint.sh" /usr/local/sbin/playground-deploy
install -m 644 "$source_dir/state.cjs" /usr/local/lib/playground-deploy/state.cjs
printf 'APP_DIR=%s\nAPP_USER=%s\nRELEASES_DIR=%s\nLIVE_LINK=%s\nBACKUP_DIR=%s\n' \
  "$APP_DIR" "$APP_USER" "$RELEASES_DIR" "$LIVE_LINK" "$BACKUP_DIR" > /etc/playground-deploy.conf
chmod 600 /etc/playground-deploy.conf
if [[ ! -L $LIVE_LINK ]]; then
  [[ ! -e $LIVE_LINK ]] || { echo 'Live path already exists and is not a symlink.' >&2; exit 1; }
  ln -s "$APP_DIR" "$LIVE_LINK"
fi
for service in playground-api playground-worker; do
  file="/etc/systemd/system/$service.service"
  cp -n "$file" "/var/lib/playground-deploy/$service.before-automation.service"
  sed -i "s|$APP_DIR|$LIVE_LINK|g" "$file"
done
cp -n /etc/caddy/Caddyfile /var/lib/playground-deploy/Caddyfile.before-automation
sed -i "s|$APP_DIR/apps/web/dist|$LIVE_LINK/apps/web/dist|g" /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl daemon-reload
systemctl reload caddy
echo 'Deployment infrastructure installed. Existing processes remain running until the first deployment.'
