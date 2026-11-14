# Audit 02, part B: the environment every suite of part B runs in (source it from e2e/).
N22=$(npx -y node@22 -p process.execPath)
export PATH="$(dirname "$N22"):$PATH"
export API="${API:-http://localhost:3003}"
export WEB="${WEB:-http://localhost:3005}"
export DB="${DB:-postgresql://erp:erp@localhost:5432/erp_audit02}"
export AUDIT_RUN=audit-02
