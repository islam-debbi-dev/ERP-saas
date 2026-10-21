# Postgres 16 with WAL-G: continuous WAL archiving and daily base backups to an
# S3-compatible bucket, for point-in-time recovery (docs/runbook.md).
# Build: docker build -t erp-saas/postgres infra/postgres
FROM postgres:16-bookworm

ARG WALG_VERSION=v3.0.8
ARG WALG_SHA256_AMD64=b0df1b484035eb5f131db7bbd303d1a460391848fdcce34ba1e0a564cca493e9
ARG WALG_SHA256_ARM64=048b5033c34c1487dc1fccc0572db030e323230984ccc093e80e4e4081c797d1
ARG TARGETARCH

# Built for Ubuntu 22.04 (glibc 2.35); bookworm has glibc 2.36.
RUN set -eu; \
    case "${TARGETARCH:-amd64}" in \
      amd64) arch=amd64; sum="$WALG_SHA256_AMD64" ;; \
      arm64) arch=aarch64; sum="$WALG_SHA256_ARM64" ;; \
      *) echo "unsupported arch ${TARGETARCH}"; exit 1 ;; \
    esac; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl; \
    rm -rf /var/lib/apt/lists/*; \
    curl -fsSL --retry 5 --retry-all-errors -o /tmp/walg.tgz \
      "https://github.com/wal-g/wal-g/releases/download/${WALG_VERSION}/wal-g-pg-22.04-${arch}.tar.gz"; \
    echo "${sum}  /tmp/walg.tgz" | sha256sum -c -; \
    tar -xzf /tmp/walg.tgz -C /tmp; \
    install -m 0755 "/tmp/wal-g-pg-22.04-${arch}" /usr/local/bin/wal-g; \
    rm -f /tmp/walg.tgz /tmp/wal-g-pg-*; \
    wal-g --version

COPY scripts/ /usr/local/bin/
COPY init/ /docker-entrypoint-initdb.d/
