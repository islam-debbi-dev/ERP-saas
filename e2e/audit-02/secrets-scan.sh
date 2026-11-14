#!/usr/bin/env bash
# Audit 02, part B.7: secrets in the repository and in its whole git history.
# Prints where a pattern matches (commit, file) and a masked sample, never a full value.
#   bash e2e/audit-02/secrets-scan.sh   (from the repo root) → e2e/artifacts/audit-02/secrets-scan.txt
set -u
cd "$(dirname "$0")/../.."
OUT=e2e/artifacts/audit-02/secrets-scan.txt
mask() { sed -E 's/([A-Za-z0-9_+=-]{8})[A-Za-z0-9_+=-]{12,}/\1…/g' | cut -c1-200; }
{
  echo "commits scanned: $(git rev-list --all --count), branches: $(git branch -a | wc -l | tr -d ' ')"
  echo
  echo "## env files ever committed"
  git log --all --diff-filter=A --name-only --format= -- '*.env' '*.env.*' '.env*' | sort -u
  echo
  scan() { # title, extended regex
    echo "## $1"
    git log --all -p --format='COMMIT %h' -G "$2" -- . ':!pnpm-lock.yaml' ':!e2e/pnpm-lock.yaml' ':!*.png' 2>/dev/null \
      | awk '/^COMMIT /{c=$2} /^\+\+\+ b\//{f=substr($0,7)} /^\+[^+]/{print c" "f" "$0}' \
      | grep -E -e "$2" | grep -vE -e "$3" | mask | sort -u | head -40
    echo
  }
  NO='change-me|example|placeholder|xxxx|<[a-z-]+>|\$\{|process\.env|erp:erp@|erp_app:erp_app@|localhost|Audit1234|Demo1234|Temp1234|Changed1234|\.spec\.ts |/test/|docs/|README|\.md |ci-test|backup\.env'
  scan "control (the placeholder secret of .env.example must be found, or the scan is blind)" 'JWT_ACCESS_SECRET=change-me' 'NEVERMATCH'
  scan "private keys"                  '-----BEGIN [A-Z ]*PRIVATE KEY' 'NEVERMATCH'
  scan "cloud and provider keys"       '(AKIA[0-9A-Z]{16}|sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|AIza[0-9A-Za-z_-]{35}|ghp_[A-Za-z0-9]{36}|npg_[A-Za-z0-9]{10,}|vercel_[A-Za-z0-9]{20,}|xox[bap]-[A-Za-z0-9-]{20,})' 'NEVERMATCH'
  scan "database URLs with a password" 'postgres(ql)?://[^:@/ ]+:[^@/ ]+@[^/ ]+' "$NO"
  scan "Neon, Vercel, Sentry hosts"    '(neon\.tech|ingest\.[a-z.]*sentry\.io|@o[0-9]+\.)' 'NEVERMATCH'
  scan "assigned secrets"              '(SECRET|TOKEN|PASSWORD|API_KEY|ENCRYPTION_KEY|DSN)[A-Z_]*\s*[=:]\s*["'"'"']?[A-Za-z0-9+/_=-]{16,}' "$NO"
  scan "JWT-looking strings"           'eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.' 'invalidsignature|e30\.'
  echo "## tracked files that hold a real-looking secret today"
  git grep -nIE '(AKIA[0-9A-Z]{16}|sk-ant-|-----BEGIN [A-Z ]*PRIVATE KEY|npg_[A-Za-z0-9]{10,}|neon\.tech)' -- . ':!pnpm-lock.yaml' | mask | head -20
  echo
  echo "## infra/ci/backup.env (tracked)"
  sed -E 's/=(.{4}).*/=\1…/' infra/ci/backup.env
} > "$OUT" 2>&1
wc -l "$OUT"
