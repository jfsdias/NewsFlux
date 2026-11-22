#!/usr/bin/env bash
# Historical offline R4.4 static checks. Does not run the operator procedure.
set -euo pipefail
cd "$(dirname "$0")/../.."
d=deploy/r44-admin-allowlist
for f in "$d"/*.sh "$d"/tests/*.sh; do bash -n "$f"; done
python3 -I -c 'import ast,sys; ast.parse(open(sys.argv[1]).read(), feature_version=(3, 9))' "$d/tests/fake_miniflux.py"
if grep -nE 'sed -i|>>? *"?\$?\{?(ENV|PRIV)|compose[^\n]* up' "$d/r44-allowlist.sh"; then exit 1; fi
echo R44_STATIC_CHECK=PASS
