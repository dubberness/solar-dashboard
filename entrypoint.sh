#!/bin/sh
set -e

if [ -n "$TZ" ] && [ -f "/usr/share/zoneinfo/$TZ" ]; then
    ln -snf "/usr/share/zoneinfo/$TZ" /etc/localtime
    echo "$TZ" > /etc/timezone
fi

PUID=${PUID:-99}
PGID=${PGID:-100}

# Unraid convention: nobody:users = 99:100.
if ! getent group "$PGID" >/dev/null 2>&1; then
    groupadd -o -g "$PGID" solar 2>/dev/null || true
fi
if ! getent passwd "$PUID" >/dev/null 2>&1; then
    useradd -o -u "$PUID" -g "$PGID" -d /config -s /bin/sh solar 2>/dev/null || true
fi

echo "Running as ${PUID}:${PGID} (TZ=${TZ:-unset})"
chown -R "$PUID":"$PGID" /config 2>/dev/null || true

exec gosu "$PUID":"$PGID" "$@"
