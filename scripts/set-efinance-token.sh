#!/usr/bin/env bash
# set-efinance-token.sh: copy eHire's token from eFinance's settings file into eHire's settings file, file to file.
# Run as root on the server:   sudo bash set-efinance-token.sh
# The token is never printed, logged or put on a command line. This script reads one file and edits one file:
#   reads   /opt/finance/settings.json   (the setting ehire_token)
#   edits   /etc/ehire/ehire.env         (EHIRE_EFINANCE_TOKEN and EHIRE_EFINANCE_URL), keeping owner and mode
# It keeps one copy of the old file beside it (ehire.env.before-efinance, same owner and mode).
# It does not restart anything: restart ehire yourself afterwards (the command is printed at the end).
# No network. Safe to run again.
set -euo pipefail
umask 077

SOURCE=/opt/finance/settings.json
TARGET=/etc/ehire/ehire.env
URL=http://127.0.0.1:5004

die() { printf 'set-efinance-token.sh: %s\n' "$1" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "run it with sudo"
[ -f "$SOURCE" ] || die "$SOURCE does not exist: is eFinance's install 67 in place?"
[ -f "$TARGET" ] || die "$TARGET does not exist: install eHire first"
command -v python3 >/dev/null 2>&1 || die "python3 is needed"

SOURCE="$SOURCE" TARGET="$TARGET" URL="$URL" python3 - <<'PY'
import json, os, re, shutil, sys, tempfile

source, target, url = os.environ["SOURCE"], os.environ["TARGET"], os.environ["URL"]

def stop(message):
    sys.stderr.write("set-efinance-token.sh: %s\n" % message)
    sys.exit(1)

try:
    with open(source, encoding="utf-8") as fh:
        settings = json.load(fh)
except (OSError, ValueError):
    stop("cannot read %s as JSON" % source)
token = settings.get("ehire_token") if isinstance(settings, dict) else None
if not isinstance(token, str) or not token:
    stop("the setting ehire_token is missing or empty in %s" % source)
# Only characters that are safe on a NAME=value line; a token with others would be cut or misread.
if not re.fullmatch(r"[A-Za-z0-9._~+/=-]{20,200}", token):
    stop("ehire_token has an unexpected shape (20 to 200 letters, digits or . _ ~ + / = -). Nothing was changed.")

with open(target, encoding="utf-8") as fh:
    lines = fh.read().split("\n")

wanted = {"EHIRE_EFINANCE_TOKEN": token, "EHIRE_EFINANCE_URL": url}
seen, out, same = set(), [], True
for line in lines:
    key = line.split("=", 1)[0] if "=" in line and not line.lstrip().startswith("#") else None
    if key in wanted:
        if key in seen:
            continue  # a second line for the same name would shadow the first: keep one
        seen.add(key)
        new = "%s=%s" % (key, wanted[key])
        same = same and (line == new)
        out.append(new)
    else:
        out.append(line)
for key in wanted:
    if key not in seen:
        same = False
        if out and out[-1] == "":
            out.insert(len(out) - 1, "%s=%s" % (key, wanted[key]))
        else:
            out.append("%s=%s" % (key, wanted[key]))

if same:
    print("Nothing to change: %s already holds this token and address." % target)
    sys.exit(0)

st = os.stat(target)
backup = target + ".before-efinance"
shutil.copy2(target, backup)
os.chown(backup, st.st_uid, st.st_gid)
os.chmod(backup, st.st_mode & 0o7777)

fd, tmp = tempfile.mkstemp(dir=os.path.dirname(target), prefix=".ehire.env.")
try:
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write("\n".join(out))
    os.chown(tmp, st.st_uid, st.st_gid)
    os.chmod(tmp, st.st_mode & 0o7777)
    os.replace(tmp, target)
except BaseException:
    if os.path.exists(tmp):
        os.unlink(tmp)
    raise
print("Done: %s now holds the eFinance address and the token (%d characters, not shown)." % (target, len(token)))
print("The file as it was is kept as %s." % backup)
PY

echo
echo "Next, restart only eHire so the web app reads the new values:"
echo "  sudo systemctl restart ehire"
