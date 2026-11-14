# Sourced by preflight.sh and ehr-cli.sh. Reads an environment file of NAME=value lines without running it as code.
# No sudo, no network.

# load_env_file FILE: exports every NAME=value line. Skips blank lines and # comments. Strips one pair of quotes.
load_env_file() {
  local file="$1" line key value
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    key="${line%%=*}"
    value="${line#*=}"
    case "$key" in *[!A-Za-z0-9_]*|'') continue ;; esac
    case "$value" in
      \"*\") value="${value#\"}"; value="${value%\"}" ;;
      \'*\') value="${value#\'}"; value="${value%\'}" ;;
    esac
    export "$key=$value"
  done < "$file"
}
