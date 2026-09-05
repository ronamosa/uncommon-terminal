# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An Obsidian plugin that embeds a real terminal in a vault pane. It is a **fork** of
[lavs9/obsidian-ghostty-terminal](https://github.com/lavs9/obsidian-ghostty-terminal), vendored under a distinct
plugin id (`obsidian-ghostty-uncommon`) so Obsidian treats it as unmanaged and never overwrites it with a
community-plugin update. The fork's one behavioural change is mouse-wheel passthrough for alternate-screen TUIs
(`encodeWheelEvent` in `main.ts`); keep other changes upstreamable — nothing here should be vault-specific.

## Commands

```bash
npm run dev                  # esbuild watch → main.js (inline sourcemap)
npm run build                # tsc -noEmit type check, then minified production bundle
npm run lint                 # eslint (includes eslint-plugin-obsidianmd rules)
./deploy.sh /path/to/vault   # copy main.js, manifest.json, styles.css, pty_helper.py into a vault
```

There is no test suite. Verification is: `npm run build && npm run lint`, then deploy to a vault and exercise
the terminal by hand. `npm run version` references a `version-bump.mjs` that does not exist in this fork —
bump `manifest.json`, `versions.json`, and `package.json` by hand.

`main.js` is committed intentionally (Obsidian loads it directly), so a build is part of any change that
ships. Pushing a tag triggers `.github/workflows/release.yml`, which builds and attaches
`main.js`/`manifest.json`/`styles.css` to a GitHub release.

## Architecture

Three layers, one process boundary:

1. **`main.ts`** — the whole plugin: `GhosttyTerminalPlugin` (settings, ribbon, commands, file-explorer context
   menu) and `GhosttyTerminalView extends ItemView` (one terminal per leaf, fully independent). Bundled to
   `main.js` by `esbuild.config.mjs`.
2. **`ghostty-web`** — the official libghostty-vt WASM parser plus a canvas renderer. Booted once in
   `onload()`; each view constructs its own `Terminal`. This is *not* xterm.js — do not reach for xterm addons
   or assume xterm internals beyond the compatible surface.
3. **`pty_helper.py`** — a Python stdlib `pty` proxy, spawned with `child_process.spawn` per view. Deliberately
   used instead of `node-pty` so there is no native addon to `electron-rebuild`. `node-pty*` sit in
   `package.json` dependencies as fork leftovers and are not loaded.

The helper's protocol matters when touching either side: argv[1] is the shell, stdin/stdout carry raw bytes,
and **fd 3 is a resize control pipe** taking 4-byte big-endian frames (rows uint16, cols uint16). The source is
imported into the bundle as text (`import ptyHelperCode from './pty_helper.py'`, via esbuild's `.py: text`
loader and `src/env.d.ts`) and rewritten to the plugin directory on spawn whenever the on-disk copy differs —
so editing `pty_helper.py` alone does nothing until you rebuild.

Config resolution order for shell/font/colors: Obsidian settings override → `~/.config/ghostty/config` (parsed
by `src/ghostty-config.ts`) → hard-coded fallback. Ghostty keybinds from that config are merged with a builtin
list (`GHOSTTY_BUILTIN_KEYBINDS`) and intercepted in the **capture phase** on the terminal element, so Obsidian's
global hotkeys never see keys meant for the terminal.

Sizing is measured, not guessed: `measureCharDimensions()` uses a hidden canvas to get exact cell width/height,
which feeds both `terminalDimensions()` (cols/rows sent over fd 3) and the wheel encoder's cell coordinates.

### The wheel fix

`ghostty-web` handles the wheel in two branches — scrollback on the normal screen, Up/Down arrows on the
alternate screen. The arrow fallback is right for `less`/`man` but wrong for any TUI that enables mouse
reporting and scrolls its own viewport (Claude Code, for one). `attachCustomWheelEventHandler` takes over only
when `isAlternateScreen() && hasMouseTracking()`, encodes the wheel as a mouse-button report (SGR when DEC mode
1006 is negotiated, legacy X10 otherwise) and writes it to the PTY; everything else returns `false` and falls
through unchanged.

## Conventions

- Follow the [Obsidian plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines);
  `eslint-plugin-obsidianmd` enforces much of it (use `activeDocument`, CSS classes over inline styles, etc.).
- Keep `manifest.json`, `versions.json`, `package.json`, and the README badges in sync when releasing.
- `manifest.json` `author` stays as the upstream author; the fork is identified by id, name, and description.
- Shell commands in this repo's workflows may be aliased to `-i`; use `cp -f`, `rm -f`, `mv -f` to avoid hanging.

## Issue tracking

`AGENTS.md` mandates **bd (beads)** for all issue tracking rather than markdown TODOs, with data in `.beads/`.
Note that the `bd` binary is not currently on PATH in this environment — if it is missing, say so rather than
silently falling back to another tracker.
