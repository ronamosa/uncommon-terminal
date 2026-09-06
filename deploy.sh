#!/usr/bin/env bash
# Install a local build into one or more Obsidian vaults.
#
#   npm run build && ./deploy.sh /path/to/vault [/path/to/another ...]
#
# Plugins are per-vault, so each vault gets its own copy.
set -euo pipefail

ID="uncommon-terminal"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[ -f "$SRC/main.js" ] || { echo "main.js is missing — run 'npm run build' first" >&2; exit 1; }
[ $# -ge 1 ] || { echo "usage: $0 <vault> [vault ...]" >&2; exit 1; }

for VAULT in "$@"; do
    [ -d "$VAULT/.obsidian" ] || { echo "not an Obsidian vault: $VAULT" >&2; exit 1; }
    DEST="$VAULT/.obsidian/plugins/$ID"
    mkdir -p "$DEST"
    cp -f "$SRC/main.js" "$SRC/manifest.json" "$SRC/styles.css" "$SRC/pty_helper.py" "$DEST/"
    echo "installed to $DEST"
done

echo
echo "Reload Obsidian, then enable 'Uncommon Terminal' in Community plugins."
