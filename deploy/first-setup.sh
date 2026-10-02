#!/usr/bin/env bash
set -euo pipefail
# eCapital — first UAT setup on 10.227.56.22, in ONE command.
#
#   sudo bash deploy/first-setup.sh --admin-username <your AD account name>
#
# Runs as root, once, after deploy/install.sh. It does every step the runbook
# lists between install.sh and the first sign-in, so the operator does not
# have to type them one by one (02/10/2026: the hand-typed path lost a
# password to a pasted placeholder and the secrets to a chat window):
#
#   1. Secrets: generates the four random values and writes them into
#      /etc/ecapital/api.env, replacing CHANGE-ME. Never prints them. A value
#      already set in the file is kept, so the script can be re-run.
#   2. PostgreSQL, as the postgres superuser: role `ecapital` with the owner
#      password from the env file, database `ecapital`, extensions pgcrypto
#      and pg_trgm inside that database only. Nothing cluster-wide.
#   3. The eArchive document directory (runbook §11.1).
#   4. nginx: writes the server block for the hostname on the chosen port,
#      runs `nginx -t`, and reloads ONLY if the test passes. A failed test
#      removes the block again and leaves nginx exactly as it was.
#   5. The release, as `administrator`: ecapital-release-on-server --ref …,
#      with --skip-guides unless --with-guides is given (Chromium is not on
#      this host yet).
#   6. Password of the application role `ecapital_app` (created by the first
#      migration) set to the app password from the env file; API restarted.
#   7. Seed (UAT sample data) unless --no-seed. Never on production.
#   8. grant-admin for --admin-username, so the first sign-in is an
#      administrator.
#   9. A summary: health codes, listening ports, and what is still open
#      (LDAP from IT, the eFinance token, the eArchive token hand-over).
#
# What it does NOT do: touch any other application, upgrade Node, send the
# cloudflared request, or put a secret anywhere but /etc/ecapital/api.env
# and PostgreSQL. To hand the eArchive token to that team, read it from the
# file on the server: sudo grep ECAPITAL_INGEST_TOKEN /etc/ecapital/api.env

REF="claude/ecstatic-cray-g0zhkx"
ADMIN_USER=""
ADMIN_NAME=""
HOSTNAME_PUBLIC="capital.shso.online"
NGINX_PORT="5016"
WITH_GUIDES=0
DO_SEED=1
DO_NGINX=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --admin-username) ADMIN_USER="${2:?}"; shift 2 ;;
    --admin-name)     ADMIN_NAME="${2:?}"; shift 2 ;;
    --ref)            REF="${2:?}"; shift 2 ;;
    --hostname)       HOSTNAME_PUBLIC="${2:?}"; shift 2 ;;
    --nginx-port)     NGINX_PORT="${2:?}"; shift 2 ;;
    --with-guides)    WITH_GUIDES=1; shift ;;
    --no-seed)        DO_SEED=0; shift ;;
    --no-nginx)       DO_NGINX=0; shift ;;
    -h|--help) sed -n '2,36p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1 (try --help)" >&2; exit 2 ;;
  esac
done

[[ "${EUID}" -eq 0 ]] || { echo "Run with sudo: sudo bash $0 --admin-username <account>" >&2; exit 2; }
ENV_FILE=/etc/ecapital/api.env
[[ -f "${ENV_FILE}" ]] || { echo "${ENV_FILE} missing — run deploy/install.sh first." >&2; exit 1; }
[[ -x /usr/local/bin/ecapital-release-on-server ]] || { echo "/usr/local/bin/ecapital-release-on-server missing — run deploy/install.sh first." >&2; exit 1; }
id -u ecapital >/dev/null 2>&1 || { echo "system user ecapital missing — run deploy/install.sh first." >&2; exit 1; }
if [[ -z "${ADMIN_USER}" ]]; then
  echo "--admin-username <sAMAccountName> is required: the account name you type at the sign-in screen (not the email)." >&2
  exit 2
fi

step() { echo; echo "=== $* ==="; }
# Read one KEY=value line from the env file (first match, no quotes handling
# beyond what the template uses: plain values, no spaces).
env_get() { grep -E "^$1=" "${ENV_FILE}" | head -n1 | cut -d= -f2-; }
# Replace the value of KEY in the env file, keeping mode and owner.
env_set() {
  local key="$1" val="$2"
  if grep -qE "^${key}=" "${ENV_FILE}"; then
    # '|' as the sed delimiter: the values are hex or URLs, never contain it.
    sed -i "s|^${key}=.*|${key}=${val}|" "${ENV_FILE}"
  else
    echo "${key}=${val}" >> "${ENV_FILE}"
  fi
  chown ecapital:ecapital "${ENV_FILE}"
  chmod 600 "${ENV_FILE}"
}
is_placeholder() { [[ -z "$1" || "$1" == *CHANGE-ME* ]]; }
# Password out of postgres://user:PASS@host:port/db
url_password() { local u="$1"; u="${u#*://}"; u="${u#*:}"; echo "${u%%@*}"; }

# ------------------------------------------------------------- 1. secrets --

step "[1/9] Secrets in ${ENV_FILE}"
OWNER_PW=""; APP_PW=""
cur="$(env_get MIGRATION_DATABASE_URL)"
if is_placeholder "${cur}"; then
  OWNER_PW="$(openssl rand -hex 24)"
  env_set MIGRATION_DATABASE_URL "postgres://ecapital:${OWNER_PW}@127.0.0.1:5432/ecapital"
  echo "MIGRATION_DATABASE_URL: set (new owner password)"
else
  OWNER_PW="$(url_password "${cur}")"
  echo "MIGRATION_DATABASE_URL: already set, kept"
fi
cur="$(env_get DATABASE_URL)"
if is_placeholder "${cur}"; then
  APP_PW="$(openssl rand -hex 24)"
  env_set DATABASE_URL "postgres://ecapital_app:${APP_PW}@127.0.0.1:5432/ecapital"
  echo "DATABASE_URL: set (new app password)"
else
  APP_PW="$(url_password "${cur}")"
  echo "DATABASE_URL: already set, kept"
fi
for key in SESSION_SECRET ECAPITAL_INGEST_TOKEN DEV_AUTH_SECRET; do
  if is_placeholder "$(env_get "${key}")"; then
    env_set "${key}" "$(openssl rand -hex 32)"
    echo "${key}: set"
  else
    echo "${key}: already set, kept"
  fi
done
echo "Left as they are (filled in later, by hand): LDAP_URL, LDAP_BASE_DN, EFINANCE_TOKEN"

# ---------------------------------------------------------- 2. PostgreSQL --

step "[2/9] PostgreSQL role, database, extensions (as postgres)"
psql_super() { sudo -u postgres psql -v ON_ERROR_STOP=1 -qAt "$@"; }
if [[ "$(psql_super -c "select 1 from pg_roles where rolname='ecapital'")" == "1" ]]; then
  psql_super -c "alter role ecapital with login password '${OWNER_PW}'"
  echo "role ecapital: exists, password aligned with the env file"
else
  psql_super -c "create role ecapital login password '${OWNER_PW}'"
  echo "role ecapital: created"
fi
if [[ "$(psql_super -c "select 1 from pg_database where datname='ecapital'")" == "1" ]]; then
  echo "database ecapital: exists"
else
  psql_super -c "create database ecapital owner ecapital"
  echo "database ecapital: created"
fi
psql_super -d ecapital -c "create extension if not exists pgcrypto"
psql_super -d ecapital -c "create extension if not exists pg_trgm"
echo "extensions in ecapital: $(psql_super -d ecapital -c "select string_agg(extname, ', ' order by extname) from pg_extension where extname in ('pgcrypto','pg_trgm')")"

# ------------------------------------------------------ 3. eArchive folder --

step "[3/9] eArchive document directory"
install -d -o ecapital -g ecapital -m 0750 /var/lib/ecapital/documents
ls -ld /var/lib/ecapital/documents

# ---------------------------------------------------------------- 4. nginx --

step "[4/9] nginx server block for ${HOSTNAME_PUBLIC} on port ${NGINX_PORT}"
if [[ "${DO_NGINX}" -eq 1 ]]; then
  if ! command -v nginx >/dev/null; then
    echo "nginx not installed on this host — skipped. Runbook §2.2 is still to do."
  elif [[ -f /etc/nginx/sites-available/ecapital ]]; then
    echo "/etc/nginx/sites-available/ecapital exists — left as it is"
    nginx -t
  else
    cat > /etc/nginx/sites-available/ecapital <<NGINX
server {
    listen ${NGINX_PORT};
    server_name ${HOSTNAME_PUBLIC};

    client_max_body_size 25m;  # SAP import uploads (Capex Plan, invoices)

    location / {
        proxy_pass http://127.0.0.1:5013;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
    ln -sf /etc/nginx/sites-available/ecapital /etc/nginx/sites-enabled/ecapital
    if nginx -t; then
      systemctl reload nginx
      echo "nginx: block installed and reloaded"
    else
      rm -f /etc/nginx/sites-enabled/ecapital /etc/nginx/sites-available/ecapital
      echo "nginx -t FAILED — block removed again, nginx untouched. Fix by hand per runbook §2.2." >&2
    fi
  fi
else
  echo "skipped (--no-nginx)"
fi

# -------------------------------------------------------------- 5. release --

step "[5/9] Release ${REF} as administrator"
# The release builds as administrator and needs the host's proxy settings
# (git, pnpm) and a non-interactive corepack. /etc/environment holds the
# proxy; sudo -u would drop it, so it is passed explicitly.
PROXY_ENV=()
if [[ -f /etc/environment ]]; then
  while IFS= read -r line; do
    [[ "${line}" =~ ^[A-Za-z_]*[Pp][Rr][Oo][Xx][Yy][A-Za-z_]*= ]] && PROXY_ENV+=("${line//\"/}")
  done < /etc/environment
fi
GUIDES_FLAG="--skip-guides"
[[ "${WITH_GUIDES}" -eq 1 ]] && GUIDES_FLAG=""
sudo -u administrator -H env "${PROXY_ENV[@]}" COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  /usr/local/bin/ecapital-release-on-server --ref "${REF}" ${GUIDES_FLAG}

# ---------------------------------------------------- 6. app role password --

step "[6/9] Application role password"
if [[ "$(psql_super -c "select 1 from pg_roles where rolname='ecapital_app'")" == "1" ]]; then
  psql_super -c "alter role ecapital_app with login password '${APP_PW}'"
  echo "role ecapital_app: password aligned with DATABASE_URL"
  systemctl restart ecapital-api.service
  sleep 5
else
  echo "role ecapital_app does not exist — the migration did not run. Stop here and read the release output above." >&2
  exit 1
fi

# ------------------------------------------------------------------ 7. seed --

step "[7/9] Seed (UAT sample data)"
if [[ "${DO_SEED}" -eq 1 ]]; then
  (cd /opt/ecapital && sudo -u ecapital env $(grep -v '^#' "${ENV_FILE}" | grep -v '^$' | xargs) /usr/bin/pnpm --filter @ecapital/api seed)
else
  echo "skipped (--no-seed)"
fi

# ----------------------------------------------------------- 8. grant-admin --

step "[8/9] First administrator: ${ADMIN_USER}"
NAME_ARGS=()
[[ -n "${ADMIN_NAME}" ]] && NAME_ARGS=(--name "${ADMIN_NAME}")
(cd /opt/ecapital && sudo -u ecapital env $(grep -v '^#' "${ENV_FILE}" | grep -v '^$' | xargs) /usr/bin/pnpm --filter @ecapital/api grant-admin -- --username "${ADMIN_USER}" "${NAME_ARGS[@]}")

# --------------------------------------------------------------- 9. summary --

step "[9/9] Summary"
echo "units:"
systemctl is-active ecapital-api.service ecapital-web.service ecapital-backup.timer ecapital-restore-drill.timer | paste - - - - | sed 's/^/  api web backup-timer drill-timer: /'
echo "listening:"
ss -ltnp 2>/dev/null | grep -E ':(5013|5015|'"${NGINX_PORT}"')\b' | awk '{print "  " $4 "  " $6}' || true
echo "health:"
curl -s --noproxy '*' -o /dev/null -w '  api  http://127.0.0.1:5015/health   -> %{http_code}\n' http://127.0.0.1:5015/health || true
curl -s --noproxy '*' -o /dev/null -w '  web  http://127.0.0.1:5013/sign-in  -> %{http_code}\n' http://127.0.0.1:5013/sign-in || true
curl -s --noproxy '*' -o /dev/null -w "  nginx http://127.0.0.1:${NGINX_PORT}/sign-in -> %{http_code}\n" -H "Host: ${HOSTNAME_PUBLIC}" "http://127.0.0.1:${NGINX_PORT}/sign-in" || true
cat <<SUMMARY

Still open, none of it this script's to do:
  - LDAP (IT): LDAP_URL and LDAP_BASE_DN in ${ENV_FILE}, then
    systemctl restart ecapital-api. Until then nobody can sign in.
  - eFinance: EFINANCE_TOKEN in ${ENV_FILE} when they issue it.
  - eArchive: give them ECAPITAL_INGEST_TOKEN. Read it on this server with
      sudo grep ECAPITAL_INGEST_TOKEN ${ENV_FILE}
    and never paste it into a chat or an email.
  - cloudflared (.210): ${HOSTNAME_PUBLIC} -> http://10.227.56.22:${NGINX_PORT}
    (deploy/cloudflared-request.md).
  - Guides: this release shipped $( [[ "${WITH_GUIDES}" -eq 1 ]] && echo "with" || echo "WITHOUT" ) the PDF guides. Note it in the deploy checklist.
SUMMARY
