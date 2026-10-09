#!/bin/bash
# Starts (or checks) the LOCAL test stack the audit tests run against:
#   Postgres 16 on 127.0.0.1:54329 (database lcc_tr, built from this repo's migrations)
#   GoTrue (Supabase Auth) on 127.0.0.1:9999, fronted by an /auth/v1 proxy on 127.0.0.1:54321
#   the app as a PRODUCTION build (`next build` + `next start`) on 127.0.0.1:3100
#
# SAFETY (audit rule 4): this script refuses to continue unless every URL it
# uses is a loopback address. It never reads .env.local and never prints keys.
# Usage: security-audit/tests/local-stack.sh [build]   ("build" forces a rebuild)
set -euo pipefail
cd "$(dirname "$0")/../.."

DB_URL="postgresql://postgres@127.0.0.1:54329/lcc_tr"
AUTH_URL="http://127.0.0.1:54321"
APP_URL="http://127.0.0.1:3100"
for u in "$DB_URL" "$AUTH_URL" "$APP_URL"; do
  case "$u" in *127.0.0.1*|*localhost*) ;; *) echo "REFUSING: $u is not a loopback address"; exit 1;; esac
done

KEYS="${AUDIT_KEYS_FILE:-/tmp/claude-0/audit-keys.env}"
if [ ! -f "$KEYS" ]; then
  # Throw-away local JWTs signed with the local GoTrue's test secret.
  python3 - > "$KEYS" <<'PY'
import hmac,hashlib,base64,json,time
b=lambda d: base64.urlsafe_b64encode(d).rstrip(b'=').decode()
def tok(role):
    h=b(json.dumps({"alg":"HS256","typ":"JWT"}).encode()); p=b(json.dumps({"role":role,"iss":"supabase","exp":int(time.time())+86400*30}).encode())
    s=b(hmac.new(b"test-secret-test-secret-test-secret-1234",f"{h}.{p}".encode(),hashlib.sha256).digest()); return f"{h}.{p}.{s}"
print(f"AUDIT_ANON={tok('anon')}"); print(f"AUDIT_SVC={tok('service_role')}")
PY
  chmod 600 "$KEYS"
fi
# shellcheck disable=SC1090
. "$KEYS"

pg_isready -h 127.0.0.1 -p 54329 >/dev/null || { echo "Postgres not running on 54329"; exit 1; }
curl -fsS -m 3 http://127.0.0.1:9999/health >/dev/null || { echo "GoTrue not running on 9999"; exit 1; }
curl -fsS -m 3 "$AUTH_URL/auth/v1/health" >/dev/null || { echo "auth proxy not running on 54321"; exit 1; }

export DATABASE_URL="$DB_URL" NEXT_PUBLIC_SUPABASE_URL="$AUTH_URL" NEXT_PUBLIC_SUPABASE_ANON_KEY="$AUDIT_ANON" SUPABASE_SERVICE_ROLE_KEY="$AUDIT_SVC" INSTITUTION_TIMEZONE=Africa/Monrovia

if [ "${1:-}" = "build" ] || [ ! -f .next/BUILD_ID ] || ! grep -rqs "127.0.0.1:54321" .next/server/chunks 2>/dev/null; then
  echo "building (NEXT_PUBLIC_* are baked in at build time)..."
  npx next build >/tmp/claude-0/audit-build.log 2>&1 || { tail -20 /tmp/claude-0/audit-build.log; exit 1; }
fi

if ! curl -fsS -m 3 -o /dev/null "$APP_URL/api/health"; then
  (nohup npx next start -H 127.0.0.1 -p 3100 >/tmp/claude-0/audit-app.log 2>&1 &)
  for i in $(seq 1 40); do curl -fsS -m 2 -o /dev/null "$APP_URL/api/health" && break; sleep 1; done
fi
curl -fsS "$APP_URL/api/health" && echo
echo "stack ready: app=$APP_URL auth=$AUTH_URL db=127.0.0.1:54329/lcc_tr"
