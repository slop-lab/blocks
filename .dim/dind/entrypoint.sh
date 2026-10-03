#!/bin/sh
set -eu

# Sysbox's nested Docker may strip ownership and setuid bits while unpacking an
# image layer. Restore the idmap helpers at container start, then run dind with
# the same unprivileged user as the upstream dind-rootless image.
chown root:root /usr/bin/newuidmap /usr/bin/newgidmap
chmod 4755 /usr/bin/newuidmap /usr/bin/newgidmap

exec su rootless -s /bin/sh -c 'exec dockerd-entrypoint.sh "$@"' -- "$@"
