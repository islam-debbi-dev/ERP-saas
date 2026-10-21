#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 VPS (as root). docs/runbook.md, "First
# server setup", lists what to do before and after.
set -euo pipefail
apt-get update
apt-get install -y ca-certificates curl ufw unattended-upgrades
# Docker Engine + Compose plugin from Docker's repository.
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
# Firewall: SSH and the web only. Postgres is never exposed.
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
# Deploy user (CI connects as it); it may run docker, nothing else.
id deploy >/dev/null 2>&1 || useradd -m -s /bin/bash -G docker deploy
mkdir -p /srv/erp/deploy
chown -R deploy:deploy /srv/erp
docker network create erp-edge >/dev/null 2>&1 || true
echo "Done. Next: add the CI public key to ~deploy/.ssh/authorized_keys, create"
echo "/srv/erp/{staging,production}.env and /srv/erp/deploy/caddy/.env (runbook)."
