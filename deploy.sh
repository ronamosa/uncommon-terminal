#!/usr/bin/env bash
# Deploy the built plugin into an Obsidian vault.
#
#   ./deploy.sh /path/to/vault [/path/to/another-vault ...]
#
# Plugins are per-vault, so each vault needs its own copy. The build must
# already exist; run `npm run build` first.
set -euo pipefail

ID="ghostty-terminal-uncommon"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[ -f "$SRC/main.js" ] || { echo "main.js missing — run 'npm run build' first" >&2; exit 1; }
[ $# -ge 1 ] || { echo "usage: $0 <vault> [vault ...]" >&2; exit 1; }

for VAULT in "$@"; do
    DEST="$VAULT/.obsidian/plugins/$ID"
    [ -d "$VAULT/.obsidian" ] || { echo "not an Obsidian vault: $VAULT" >&2; exit 1; }
    mkdir -p "$DEST"
    cp "$SRC/main.js" "$SRC/manifest.json" "$SRC/styles.css" "$SRC/pty_helper.py" "$DEST/"

    # Carry settings over from the upstream plugin on first deploy only.
    UPSTREAM="$VAULT/.obsidian/plugins/ghostty-terminal/data.json"
    if [ ! -f "$DEST/data.json" ] && [ -f "$UPSTREAM" ]; then
        cp "$UPSTREAM" "$DEST/data.json"
        echo "  carried settings over from the upstream plugin"
    fi
    echo "deployed to $DEST"
done

echo
echo "In Obsidian: reload, then disable 'Ghostty Terminal' and enable 'Ghostty Terminal (Uncommon)'."
