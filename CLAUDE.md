# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Uncommon Terminal** — an Obsidian plugin that embeds a real terminal in a
vault pane. Plugin id `uncommon-terminal`, owned by Ron Amosa, MIT.

It began as a fork of [lavs9/obsidian-ghostty-terminal][upstream] and has since
been restructured and taken over. Upstream keeps its copyright line in LICENSE
and its credit in the README; there is no longer any expectation that changes
here flow back upstream. Design for this plugin, not for the fork parent.

## Commands

```bash
npm run dev      # esbuild watch → main.js (inline sourcemap)
npm run build    # tsc -noEmit type check, then a minified production bundle
npm run lint     # eslint, including eslint-plugin-obsidianmd rules
npm test         # tsx --test over tests/
npm run check    # all three, in the order that fails fastest
./deploy.sh /path/to/vault [/path/to/another ...]

npx tsx --test tests/wheel.test.ts                  # one test file
npx tsx --test --test-name-pattern 'SGR' tests/*.test.ts   # one test
```

`npm run check` is the gate. Beyond it, verification means deploying to a vault
and exercising the terminal by hand — there is no way to test the PTY or the
renderer headlessly.

`npm version <patch|minor|major>` runs `version-bump.mjs`, which syncs
`manifest.json` and `versions.json` from `package.json`. Do not edit those
three by hand.

`deploy.sh` copies `main.js`, `manifest.json`, `styles.css`, and
`pty_helper.py` into `<vault>/.obsidian/plugins/uncommon-terminal/`; Obsidian
must be reloaded afterwards.

`main.js` is **not** committed — it is a build artifact, published as a release
asset. Pushing a tag (no `v` prefix, matching `manifest.json` exactly) triggers
`.github/workflows/release.yml`.

## Architecture

Three layers, one process boundary.

1. **`src/`** — the plugin. `main.ts` is the `Plugin` subclass (settings,
   ribbon, commands, file-menu). `view.ts` is the `ItemView`: one terminal per
   leaf, fully independent. `pty.ts` owns the shell process. `settings.ts`,
   `theme.ts`, `keybinds.ts`, `ghostty-config.ts`, and `wheel.ts` are the rest.
2. **`ghostty-web`** — libghostty's VT parser as WASM plus a canvas renderer,
   booted once in `onload()`. This is *not* xterm.js: do not reach for xterm
   addons or assume xterm internals beyond the compatible surface. It does
   proxy its `options` object, so assigning to `terminal.options.*` re-renders
   live — that is how settings apply without rebuilding the terminal.
3. **`pty_helper.py`** — a Python stdlib `pty` proxy, one `child_process.spawn`
   per view. Deliberately not `node-pty`: no native addon means nothing to
   `electron-rebuild`. Never reintroduce a native dependency here.

The helper's protocol matters when touching either side: `argv[1]` is the
shell, stdin/stdout carry raw bytes, and **fd 3 is a resize control pipe**
taking 4-byte big-endian frames (rows uint16, cols uint16). The source is
imported into the bundle as text (`import ptyHelperCode from '../pty_helper.py'`,
via esbuild's `.py: text` loader and `src/env.d.ts`) and rewritten through the
vault adapter on spawn whenever the on-disk copy differs — **so editing
`pty_helper.py` alone does nothing until you rebuild**.

Config resolution for shell, font, and colors: Obsidian settings →
`~/.config/ghostty/config` (parsed by `src/ghostty-config.ts`) → built-in
fallback. Ghostty keybinds from that config merge with `BUILTIN_KEYBINDS` and
are intercepted in the **capture phase**, so Obsidian's global hotkeys never
see keys meant for the terminal.

Sizing is the FitAddon's job. It fits to the container, and `terminal.onResize`
pushes the new rows/cols down fd 3. Do not reintroduce manual glyph
measurement — the wheel encoder derives its cell size from the grid
(`rect.width / cols`), which cannot drift out of sync with what was drawn.

### The wheel fix

`ghostty-web` handles the wheel in two branches: scrollback on the normal
screen, Up/Down arrows on the alternate screen. The arrow fallback is right for
`less` and `man` but wrong for any TUI that enables mouse reporting and scrolls
its own viewport. `TerminalView.handleWheel` takes over only when
`isAlternateScreen() && hasMouseTracking()`, and `src/wheel.ts` encodes the
event as a mouse-button report (SGR under DEC mode 1006, legacy X10 otherwise).
Everything else returns `false` and falls through unchanged.

## Conventions

- Follow the [Obsidian plugin guidelines][guidelines]; `eslint-plugin-obsidianmd`
  enforces much of it. In particular: `activeDocument`/`activeWindow` over the
  globals, CSS classes over inline styles, Obsidian CSS variables over hard-coded
  colors, sentence case in UI strings, and no `innerHTML`.
- Reach for the vault adapter, not node `fs`, for anything inside the vault.
- Pure logic goes in a DOM-free module with tests. `wheel.ts`, `keybinds.ts`,
  and the `parseGhosttyConfigText` half of `ghostty-config.ts` are the pattern.
- `Notice` is for things the user must act on. Success is not one of them.
- Shell commands here may be aliased to `-i`; use `cp -f`, `rm -f`, `mv -f` to
  avoid hanging on a prompt.

## Publishing

Listed in the community catalogue via a PR to
[obsidianmd/obsidian-releases][releases] adding an entry to
`community-plugins.json`. The release tag must equal the `manifest.json`
version exactly, with no `v` prefix, and the release must carry `main.js`,
`manifest.json`, and `styles.css` as assets.

[upstream]: https://github.com/lavs9/obsidian-ghostty-terminal
[guidelines]: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
[releases]: https://github.com/obsidianmd/obsidian-releases
