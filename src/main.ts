import { Menu, Notice, Plugin, TAbstractFile, TFile, WorkspaceLeaf } from 'obsidian';
import { init as initGhosttyWasm } from 'ghostty-web';
import * as path from 'path';

import { loadGhosttyConfig, emptyGhosttyConfig, type GhosttyConfig } from './ghostty-config';
import { forgetPython } from './pty';
import {
    DEFAULT_SETTINGS,
    UncommonTerminalSettingTab,
    type PaneLocation,
    type UncommonTerminalSettings,
} from './settings';
import { TerminalView, VIEW_TYPE_TERMINAL } from './view';

export default class UncommonTerminalPlugin extends Plugin {
    settings: UncommonTerminalSettings = { ...DEFAULT_SETTINGS };
    ghosttyConfig: GhosttyConfig = emptyGhosttyConfig();

    /** What the loaded config was read for, so a save can skip re-reading it. */
    private configKey: string | null = null;

    override async onload(): Promise<void> {
        await this.loadSettings();
        this.reloadGhosttyConfig();

        // The VT parser is WASM, and every view needs it, so boot it once. A
        // failure here is fatal to the plugin — say so rather than opening
        // panes that can never render.
        try {
            await initGhosttyWasm();
        } catch (error) {
            console.error('Uncommon Terminal: the terminal parser failed to load', error);
            new Notice('Uncommon Terminal could not start: the terminal parser failed to load.', 8000);
            return;
        }

        this.registerView(VIEW_TYPE_TERMINAL, leaf => new TerminalView(leaf, this));

        this.addRibbonIcon('terminal', 'Open terminal', () => void this.openTerminal());

        this.addCommand({
            id: 'open',
            name: 'Open terminal',
            callback: () => void this.openTerminal(),
        });

        this.addCommand({
            id: 'open-in-split',
            name: 'Open terminal in a new split',
            callback: () => void this.openTerminal({ forceNew: true, location: 'split' }),
        });

        this.addCommand({
            id: 'restart-shell',
            name: 'Restart the shell in this terminal',
            checkCallback: (checking: boolean) => {
                const view = this.app.workspace.getActiveViewOfType(TerminalView);
                if (!view) return false;
                if (!checking) view.restart();
                return true;
            },
        });

        this.registerEvent(this.app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile) => {
            const folder = file instanceof TFile ? path.dirname(file.path) : file.path;
            menu.addItem(item => item
                .setTitle('Open terminal here')
                .setIcon('terminal')
                .onClick(() => void this.openTerminal({ forceNew: true, cwd: folder })));
        }));

        // A Ghostty `theme = dark:One,light:Other` resolves against whichever
        // side Obsidian is showing, and the palette falls back to Obsidian's
        // own variables — so both need rereading when the vault theme changes.
        this.registerEvent(this.app.workspace.on('css-change', () => {
            this.reloadGhosttyConfig();
            for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TERMINAL)) {
                (leaf.view as TerminalView).applySettings();
            }
        }));

        this.addCommand({
            id: 'copy-diagnostics',
            name: 'Copy terminal diagnostics',
            checkCallback: (checking: boolean) => {
                const view = this.app.workspace.getActiveViewOfType(TerminalView);
                if (!view) return false;
                if (!checking) {
                    const report = view.diagnostics();
                    console.debug(report);
                    void navigator.clipboard.writeText(report);
                    new Notice('Terminal diagnostics copied.', 4000);
                }
                return true;
            },
        });

        this.addSettingTab(new UncommonTerminalSettingTab(this.app, this));
    }

    override onunload(): void {
        // Leaves are left alone on purpose — Obsidian restores them, and
        // detaching here would lose the user's layout. Closing each view is
        // enough to make sure no shell outlives the plugin.
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TERMINAL)) {
            void (leaf.view as TerminalView).onClose();
        }
    }

    async loadSettings(): Promise<void> {
        const stored = await this.loadData() as Partial<UncommonTerminalSettings> | null;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);
    }

    /**
     * Persists settings and pushes them straight into open terminals, so a
     * font or color change lands without reopening the pane.
     */
    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
        forgetPython();
        this.reloadGhosttyConfig();
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TERMINAL)) {
            (leaf.view as TerminalView).applySettings();
        }
    }

    /**
     * Re-reads the Ghostty config, which means a disk read, a parse, and a
     * theme lookup — so skip it unless the path or the vault's light/dark
     * setting has actually moved.
     */
    private reloadGhosttyConfig(): void {
        const configPath = this.settings.ghosttyConfigPath || undefined;
        const prefersDark = activeDocument.body.classList.contains('theme-dark');
        const key = `${prefersDark ? 'dark' : 'light'}:${configPath ?? ''}`;

        if (key === this.configKey) return;
        this.ghosttyConfig = loadGhosttyConfig(configPath, prefersDark);
        this.configKey = key;
    }

    /** Opens a terminal, or reveals the one already open. */
    private async openTerminal(options: {
        forceNew?: boolean;
        location?: PaneLocation;
        cwd?: string;
    } = {}): Promise<void> {
        const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_TERMINAL);
        if (!options.forceNew && existing.length > 0) {
            await this.app.workspace.revealLeaf(existing[0]);
            return;
        }

        const leaf = this.newLeaf(options.location ?? this.settings.defaultLocation);
        if (!leaf) {
            new Notice('Uncommon Terminal could not open a pane there.', 5000);
            return;
        }

        await leaf.setViewState({
            type: VIEW_TYPE_TERMINAL,
            active: true,
            state: options.cwd ? { cwd: options.cwd } : {},
        });
        await this.app.workspace.revealLeaf(leaf);
    }

    private newLeaf(location: PaneLocation): WorkspaceLeaf | null {
        switch (location) {
            case 'left': return this.app.workspace.getLeftLeaf(false);
            case 'tab': return this.app.workspace.getLeaf('tab');
            case 'split': return this.app.workspace.getLeaf('split');
            case 'window': return this.app.workspace.getLeaf('window');
            case 'right':
            default: return this.app.workspace.getRightLeaf(false);
        }
    }
}
