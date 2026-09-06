import { FileSystemAdapter, ItemView, WorkspaceLeaf, ViewStateResult, normalizePath } from 'obsidian';
import { Terminal, FitAddon } from 'ghostty-web';
import * as os from 'os';
import * as path from 'path';

import type UncommonTerminalPlugin from './main';
import { buildEffectiveKeybinds, findKeybind, unescapeGhosttyText, type Keybind } from './keybinds';
import { PtySession, resolvePython } from './pty';
import { FALLBACK_SCROLLBACK } from './settings';
import { buildTheme, cssVarLookup, type PaletteOverrides } from './theme';
import { encodeWheelReport, type WheelGeometry } from './wheel';

import ptyHelperCode from '../pty_helper.py';

export const VIEW_TYPE_TERMINAL = 'uncommon-terminal';

/** Used only when Obsidian's own monospace variable is missing. */
const DEFAULT_FONT_STACK = 'Menlo, Monaco, "Courier New", monospace';
const DEFAULT_FONT_SIZE = 13;
const DEFAULT_CURSOR_STYLE = 'block';

/**
 * What the WASM buffer is told its default background is.
 *
 * The buffer bakes its configured background into every cell it writes and
 * exposes no setter, so a recolor could never reach cells already on screen —
 * they would repaint themselves in the old color, over the new one. Black is
 * the one value the renderer treats as "unset" and skips, which leaves the
 * background to the renderer's own theme, where it *can* change. The cost is
 * that a program painting an explicit black background is indistinguishable
 * from one painting none.
 */
const WASM_DEFAULT_BACKGROUND = '#000000';

/** One terminal, one shell, one leaf. Views are fully independent of each other. */
export class TerminalView extends ItemView {
    private terminal: Terminal | null = null;
    private fitAddon: FitAddon | null = null;
    private pty: PtySession | null = null;
    private resizeObserver: ResizeObserver | null = null;
    private screenEl: HTMLElement | null = null;
    private statusEl: HTMLElement | null = null;
    private keybinds: Keybind[] = [];
    private cwdOverride: string | null = null;

    constructor(leaf: WorkspaceLeaf, private readonly plugin: UncommonTerminalPlugin) {
        super(leaf);
    }

    override getViewType(): string { return VIEW_TYPE_TERMINAL; }
    override getDisplayText(): string { return 'Terminal'; }
    override getIcon(): string { return 'terminal'; }

    /** Obsidian restores the pane's working directory through view state. */
    override setState(state: Record<string, unknown>, result: ViewStateResult): Promise<void> {
        if (typeof state?.cwd === 'string') this.cwdOverride = state.cwd;
        return super.setState(state, result);
    }

    override getState(): Record<string, unknown> {
        return { ...super.getState(), cwd: this.cwdOverride ?? undefined };
    }

    override async onOpen(): Promise<void> {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('uterm-container');

        this.statusEl = container.createDiv({ cls: 'uterm-status uterm-hidden' });
        this.screenEl = container.createDiv({ cls: 'uterm-screen' });

        this.initTerminal();
        await this.startShell();

        this.resizeObserver = new ResizeObserver(() => this.fitAddon?.fit());
        this.resizeObserver.observe(this.screenEl);
    }

    override onClose(): Promise<void> {
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.pty?.kill();
        this.pty = null;
        this.fitAddon?.dispose();
        this.terminal?.dispose();
        this.fitAddon = null;
        this.terminal = null;
        return Promise.resolve();
    }

    // ── Terminal ─────────────────────────────────────────────────────────────

    private initTerminal(): void {
        const screenEl = this.screenEl;
        if (!screenEl) return;

        const theme = buildTheme(
            this.plugin.ghosttyConfig,
            cssVarLookup(this.containerEl),
            this.paletteOverrides(),
        );

        const terminal = new Terminal({
            fontFamily: this.fontFamily(),
            fontSize: this.fontSize(),
            theme: { ...theme, background: WASM_DEFAULT_BACKGROUND },
            scrollback: this.scrollback(),
            cursorStyle: this.cursorStyle(),
            cursorBlink: this.cursorBlink(),
        });

        this.fitAddon = new FitAddon();
        terminal.loadAddon(this.fitAddon);
        terminal.open(screenEl);
        this.terminal = terminal;

        terminal.attachCustomWheelEventHandler(ev => this.handleWheel(ev));
        terminal.onData(data => this.pty?.write(data));
        terminal.onResize(({ cols, rows }) => this.pty?.resize(rows, cols));

        this.keybinds = buildEffectiveKeybinds(this.plugin.ghosttyConfig.keybinds);
        this.registerDomEvent(screenEl, 'keydown', ev => this.handleKeydown(ev), { capture: true });

        this.fitAddon.fit();
        // The constructor handed the buffer a black background; the renderer
        // gets the real one.
        this.applyTheme();
    }

    /**
     * Falls back to Obsidian's monospace font — the one set in Appearance —
     * before the built-in stack, so a fresh install matches the vault's code
     * font rather than overriding it with Menlo.
     */
    private fontFamily(): string {
        return this.plugin.settings.fontFamilyOverride
            || this.plugin.ghosttyConfig.fontFamily
            || cssVarLookup(this.containerEl)('--font-monospace')
            || DEFAULT_FONT_STACK;
    }

    private fontSize(): number {
        return this.plugin.settings.fontSizeOverride > 0
            ? this.plugin.settings.fontSizeOverride
            : (this.plugin.ghosttyConfig.fontSize ?? DEFAULT_FONT_SIZE);
    }

    private scrollback(): number {
        return this.plugin.settings.scrollbackLines > 0
            ? this.plugin.settings.scrollbackLines
            : (this.plugin.ghosttyConfig.scrollback ?? FALLBACK_SCROLLBACK);
    }

    private cursorStyle(): 'block' | 'bar' | 'underline' {
        return this.plugin.settings.cursorStyleOverride
            || this.plugin.ghosttyConfig.cursorStyle
            || DEFAULT_CURSOR_STYLE;
    }

    private cursorBlink(): boolean {
        const override = this.plugin.settings.cursorBlinkOverride;
        if (override !== 'default') return override === 'on';
        return this.plugin.ghosttyConfig.cursorBlink ?? false;
    }

    /**
     * Pushes changed settings into a live terminal. ghostty-web proxies its
     * options object, so assigning re-renders rather than needing a rebuild —
     * which means the scrollback survives a settings change.
     */
    applySettings(): void {
        const terminal = this.terminal;
        if (!terminal) return;

        terminal.options.fontFamily = this.fontFamily();
        terminal.options.fontSize = this.fontSize();
        terminal.options.scrollback = this.scrollback();
        terminal.options.cursorStyle = this.cursorStyle();
        terminal.options.cursorBlink = this.cursorBlink();

        this.applyTheme();
        this.keybinds = buildEffectiveKeybinds(this.plugin.ghosttyConfig.keybinds);
        this.fitAddon?.fit();
    }

    /** Colors pinned in the plugin's settings, which outrank every other source. */
    private paletteOverrides(): PaletteOverrides {
        const { backgroundOverride, foregroundOverride, cursorColorOverride } = this.plugin.settings;
        return {
            ...(backgroundOverride ? { background: backgroundOverride } : {}),
            ...(foregroundOverride ? { foreground: foregroundOverride } : {}),
            ...(cursorColorOverride ? { cursor: cursorColorOverride } : {}),
        };
    }

    /**
     * Rebuilds the palette and puts it on screen.
     *
     * Assigning `terminal.options.theme` does nothing once the terminal is
     * open — ghostty-web only warns — so the renderer is told directly. It
     * stores the palette without drawing, and the render loop repaints just the
     * dirty cells, so one forced full pass is what actually recolors the screen.
     */
    private applyTheme(): void {
        const terminal = this.terminal;
        if (!terminal) return;

        const lookup = cssVarLookup(this.containerEl);
        const theme = buildTheme(this.plugin.ghosttyConfig, lookup, this.paletteOverrides());
        if (!terminal.renderer) {
            terminal.options.theme = theme;
            return;
        }

        terminal.renderer.setTheme(theme);
        if (terminal.wasmTerm) {
            terminal.renderer.render(terminal.wasmTerm, true, terminal.viewportY, terminal);
        }
    }

    // ── Input ────────────────────────────────────────────────────────────────

    /**
     * Takes the wheel only when the running app is on the alternate screen and
     * has asked for mouse reporting. Everything else — scrollback on the normal
     * screen, arrow keys for pagers — falls through to ghostty-web unchanged.
     */
    private handleWheel(ev: WheelEvent): boolean {
        const terminal = this.terminal;
        const screenEl = this.screenEl;
        if (!terminal || !screenEl || !this.pty?.alive) return false;
        if (!terminal.wasmTerm?.isAlternateScreen()) return false;
        if (!terminal.hasMouseTracking()) return false;

        const rect = screenEl.getBoundingClientRect();
        const geometry: WheelGeometry = {
            cols: terminal.cols,
            rows: terminal.rows,
            // Derive the cell size from the grid rather than measuring a glyph:
            // it cannot drift out of sync with what the renderer actually drew.
            cellWidth: rect.width / Math.max(1, terminal.cols),
            cellHeight: rect.height / Math.max(1, terminal.rows),
        };

        const report = encodeWheelReport({
            deltaY: ev.deltaY,
            deltaMode: ev.deltaMode,
            offsetX: ev.clientX - rect.left,
            offsetY: ev.clientY - rect.top,
            shiftKey: ev.shiftKey,
            altKey: ev.altKey,
            ctrlKey: ev.ctrlKey,
        }, geometry, terminal.getMode(1006));

        if (report) this.pty.write(report);

        // Consumed either way: never fall back to the arrow-key path here.
        return true;
    }

    /**
     * Runs in the capture phase so a key bound in the terminal never reaches
     * Obsidian's global hotkeys.
     */
    private handleKeydown(ev: KeyboardEvent): void {
        const match = findKeybind(ev, this.keybinds);
        if (!match) return;

        const { action } = match;

        if (action === 'copy_to_clipboard') {
            ev.preventDefault();
            ev.stopImmediatePropagation();
            const selection = activeWindow.getSelection()?.toString() ?? '';
            if (selection) void navigator.clipboard.writeText(selection).catch(() => { /* denied */ });
            return;
        }

        if (action === 'paste_from_clipboard') {
            ev.preventDefault();
            ev.stopImmediatePropagation();
            void navigator.clipboard.readText()
                .then(text => { if (text) this.pty?.write(text); })
                .catch(() => { /* denied */ });
            return;
        }

        if (action.startsWith('text:')) {
            ev.preventDefault();
            ev.stopImmediatePropagation();
            this.pty?.write(unescapeGhosttyText(action.slice('text:'.length)));
            return;
        }

        // An action we do not implement (new_tab, new_window, and friends).
        // Stop Obsidian from claiming the key, but let ghostty-web see it.
        ev.stopPropagation();
    }

    // ── Shell ────────────────────────────────────────────────────────────────

    private async startShell(): Promise<void> {
        this.pty?.kill();
        this.clearStatus();

        const python = resolvePython(this.plugin.settings.pythonPath);
        if (!python) {
            this.fail(
                'No usable Python 3 found. This plugin runs its PTY helper with python3 — ' +
                'install it, or set an interpreter path in the plugin settings.'
            );
            return;
        }

        let helperPath: string;
        try {
            helperPath = await this.ensureHelper();
        } catch (error) {
            this.fail(`Could not write the PTY helper: ${describe(error)}`);
            return;
        }

        const terminal = this.terminal;
        const session = new PtySession({
            python,
            helperPath,
            shell: this.resolveShell(),
            cwd: this.resolveCwd(),
            cols: terminal?.cols ?? 80,
            rows: terminal?.rows ?? 24,
        }, {
            onData: chunk => this.terminal?.write(chunk, () => this.terminal?.scrollToBottom()),
            onExit: code => this.fail(`Shell exited with code ${code ?? 0}.`),
            onError: error => this.fail(`Shell error: ${error.message}`),
        });

        try {
            session.start();
            this.pty = session;
        } catch (error) {
            this.fail(`Could not start the shell: ${describe(error)}`);
        }
    }

    private resolveShell(): string {
        return this.plugin.settings.defaultShell
            || this.plugin.ghosttyConfig.shell
            || process.env.SHELL
            || '/bin/sh';
    }

    private resolveCwd(): string {
        const adapter = this.app.vault.adapter;
        const vaultRoot = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : os.homedir();
        return this.cwdOverride ? path.join(vaultRoot, this.cwdOverride) : vaultRoot;
    }

    /**
     * Writes pty_helper.py next to the plugin, through the vault adapter, and
     * returns its absolute path for spawning. The source is bundled as text, so
     * this also repairs a helper that was deleted or left behind by an older
     * version.
     */
    private async ensureHelper(): Promise<string> {
        const adapter = this.app.vault.adapter;
        if (!(adapter instanceof FileSystemAdapter)) {
            throw new Error('this vault is not on a local filesystem');
        }

        const pluginDir = this.plugin.manifest.dir;
        if (!pluginDir) throw new Error('the plugin directory is unknown');

        const relative = normalizePath(`${pluginDir}/pty_helper.py`);
        const current = await adapter.exists(relative) ? await adapter.read(relative) : null;
        if (current !== ptyHelperCode) await adapter.write(relative, ptyHelperCode);

        return adapter.getFullPath(relative);
    }

    // ── Status ───────────────────────────────────────────────────────────────

    /** Shows a message with a restart affordance and writes it to the screen. */
    private fail(message: string): void {
        this.terminal?.write(`\r\n\x1b[31m${message}\x1b[0m\r\n`);

        const statusEl = this.statusEl;
        if (!statusEl) return;
        statusEl.empty();
        statusEl.removeClass('uterm-hidden');
        statusEl.createSpan({ cls: 'uterm-status-text', text: message });
        statusEl.createEl('button', { cls: 'uterm-restart', text: 'Restart shell' })
            .addEventListener('click', () => void this.startShell());
    }

    private clearStatus(): void {
        this.statusEl?.empty();
        this.statusEl?.addClass('uterm-hidden');
    }

    /** Restarts the shell in this pane, keeping the scrollback. */
    restart(): void {
        void this.startShell();
    }

    /** What the palette actually resolved to, for diagnosing a wrong one. */
    diagnostics(): string {
        const lookup = cssVarLookup(this.containerEl);
        const canvas = this.screenEl?.querySelector('canvas');
        let painted = 'no canvas';
        if (canvas) {
            const pixel = canvas.getContext('2d')?.getImageData(2, 2, 1, 1).data;
            painted = pixel
                ? '#' + [pixel[0], pixel[1], pixel[2]].map(n => n.toString(16).padStart(2, '0')).join('')
                : 'unreadable';
        }
        return [
            `attached: ${this.containerEl.isConnected}`,
            `--background-primary: ${lookup('--background-primary') ?? '(unset)'}`,
            `--color-red: ${lookup('--color-red') ?? '(unset)'}`,
            `--font-monospace: ${lookup('--font-monospace') ?? '(unset)'}`,
            `theme.background: ${buildTheme(this.plugin.ghosttyConfig, lookup, this.paletteOverrides()).background}`,
            `painted pixel: ${painted}`,
            `ghostty config colors: ${Object.keys(this.plugin.ghosttyConfig.colors).length} set`,
        ].join('\n');
    }
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
