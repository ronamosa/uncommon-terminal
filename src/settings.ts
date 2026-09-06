import { App, PluginSettingTab, Setting } from 'obsidian';

import type UncommonTerminalPlugin from './main';

export type PaneLocation = 'right' | 'left' | 'tab' | 'split' | 'window';

/** Cursor shape, or the empty string to defer to the Ghostty config. */
export type CursorStyleSetting = '' | 'block' | 'bar' | 'underline';

/** Cursor blink, or 'default' to defer to the Ghostty config. */
export type CursorBlinkSetting = 'default' | 'on' | 'off';

/** Used when neither the settings nor the Ghostty config name a scrollback. */
export const FALLBACK_SCROLLBACK = 10000;

/** Enough scrollback to be useful, few enough lines to stay responsive. */
const MAX_SCROLLBACK = 1000000;

/** Reads a scrollback field. Zero — an empty or unusable entry — means defer. */
export function parseScrollback(raw: string): number {
    const parsed = parseInt(raw.trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.min(parsed, MAX_SCROLLBACK);
}

export interface UncommonTerminalSettings {
    /** Where a terminal opens when no location is given. */
    defaultLocation: PaneLocation;
    /** Path to a Ghostty config file. Empty means auto-detect. */
    ghosttyConfigPath: string;
    /** Shell binary. Empty means $SHELL. */
    defaultShell: string;
    /** Python interpreter for the PTY helper. Empty means auto-detect. */
    pythonPath: string;
    /** Font family. Empty defers to the Ghostty config. */
    fontFamilyOverride: string;
    /** Font size. Zero defers to the Ghostty config. */
    fontSizeOverride: number;
    /** Lines of scrollback to keep. Zero defers to the Ghostty config. */
    scrollbackLines: number;
    /** Cursor shape. Empty defers to the Ghostty config. */
    cursorStyleOverride: CursorStyleSetting;
    /** Cursor blink. 'default' defers to the Ghostty config. */
    cursorBlinkOverride: CursorBlinkSetting;
    /** Terminal background. Empty defers to the Ghostty config, then the vault. */
    backgroundOverride: string;
    /** Default text color. Empty defers. */
    foregroundOverride: string;
    /** Cursor color. Empty defers. */
    cursorColorOverride: string;
}

export const DEFAULT_SETTINGS: UncommonTerminalSettings = {
    defaultLocation: 'right',
    ghosttyConfigPath: '',
    defaultShell: '',
    pythonPath: '',
    fontFamilyOverride: '',
    fontSizeOverride: 0,
    scrollbackLines: 0,
    cursorStyleOverride: '',
    cursorBlinkOverride: 'default',
    backgroundOverride: '',
    foregroundOverride: '',
    cursorColorOverride: '',
};

/** How long to wait for typing to stop before persisting a text field. */
const SAVE_DEBOUNCE_MS = 500;

export class UncommonTerminalSettingTab extends PluginSettingTab {
    private saveTimer: number | null = null;

    constructor(app: App, private readonly plugin: UncommonTerminalPlugin) {
        super(app, plugin);
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl).setName('Appearance').setHeading();

        new Setting(containerEl)
            .setName('Default location')
            .setDesc('Where a terminal opens when you use the ribbon icon or command.')
            .addDropdown(dropdown => dropdown
                .addOption('right', 'Right sidebar')
                .addOption('left', 'Left sidebar')
                .addOption('tab', 'New tab')
                .addOption('split', 'New split')
                .addOption('window', 'Pop-out window')
                .setValue(this.plugin.settings.defaultLocation)
                .onChange(value => this.save({ defaultLocation: value as PaneLocation })));

        new Setting(containerEl)
            .setName('Font family')
            .setDesc('Leave empty to use the font from your Ghostty config.')
            .addText(text => text
                .setValue(this.plugin.settings.fontFamilyOverride)
                .onChange(value => this.saveSoon({ fontFamilyOverride: value })));

        new Setting(containerEl)
            .setName('Font size')
            .setDesc('Leave empty to use the size from your Ghostty config.')
            .addText(text => text
                .setPlaceholder('13')
                .setValue(this.plugin.settings.fontSizeOverride > 0
                    ? String(this.plugin.settings.fontSizeOverride)
                    : '')
                .onChange(value => this.saveSoon({ fontSizeOverride: parseFloat(value) || 0 })));

        new Setting(containerEl)
            .setName('Scrollback lines')
            .setDesc('How much output to keep above the visible screen. Leave empty to use the limit from your Ghostty config.')
            .addText(text => text
                .setPlaceholder(String(FALLBACK_SCROLLBACK))
                .setValue(this.plugin.settings.scrollbackLines > 0
                    ? String(this.plugin.settings.scrollbackLines)
                    : '')
                .onChange(value => this.saveSoon({ scrollbackLines: parseScrollback(value) })));

        new Setting(containerEl)
            .setName('Cursor style')
            .setDesc('Shape of the cursor.')
            .addDropdown(dropdown => dropdown
                .addOption('', 'From Ghostty config')
                .addOption('block', 'Block')
                .addOption('bar', 'Bar')
                .addOption('underline', 'Underline')
                .setValue(this.plugin.settings.cursorStyleOverride)
                .onChange(value => this.save({ cursorStyleOverride: value as CursorStyleSetting })));

        new Setting(containerEl)
            .setName('Cursor blink')
            .addDropdown(dropdown => dropdown
                .addOption('default', 'From Ghostty config')
                .addOption('on', 'Blink')
                .addOption('off', 'Steady')
                .setValue(this.plugin.settings.cursorBlinkOverride)
                .onChange(value => this.save({ cursorBlinkOverride: value as CursorBlinkSetting })));

        new Setting(containerEl).setName('Colors').setHeading()
            .setDesc('Left unset, colors follow your Ghostty config, then your Obsidian theme.');

        this.addColorSetting('Background', 'backgroundOverride', '#000000');
        this.addColorSetting('Text', 'foregroundOverride', '#cccccc');
        this.addColorSetting('Cursor', 'cursorColorOverride', '#00ff00');

        new Setting(containerEl).setName('Shell').setHeading();

        new Setting(containerEl)
            .setName('Shell path')
            .setDesc('Leave empty to use your login shell. Takes effect in terminals opened from now on.')
            .addText(text => text
                .setPlaceholder('/bin/zsh')
                .setValue(this.plugin.settings.defaultShell)
                .onChange(value => this.saveSoon({ defaultShell: value })));

        new Setting(containerEl)
            .setName('Python path')
            .setDesc('Interpreter that runs the PTY helper. Leave empty to detect python3 automatically.')
            .addText(text => text
                .setPlaceholder('/usr/bin/python3')
                .setValue(this.plugin.settings.pythonPath)
                .onChange(value => this.saveSoon({ pythonPath: value })));

        new Setting(containerEl).setName('Ghostty config').setHeading();

        new Setting(containerEl)
            .setName('Config file path')
            .setDesc('Leave empty to look in the usual places. Reloaded when you change this.')
            .addText(text => text
                .setValue(this.plugin.settings.ghosttyConfigPath)
                .onChange(value => this.saveSoon({ ghosttyConfigPath: value })));
    }

    /**
     * One color row: a picker, and a reset that puts the slot back to being
     * resolved rather than set. A picker always holds a color, so "unset" needs
     * its own affordance.
     */
    private addColorSetting(
        name: string,
        key: 'backgroundOverride' | 'foregroundOverride' | 'cursorColorOverride',
        sample: string,
    ): void {
        const current = this.plugin.settings[key];

        new Setting(this.containerEl)
            .setName(name)
            .setDesc(current ? current : 'Automatic')
            .addColorPicker(picker => picker
                .setValue(current || sample)
                .onChange(value => {
                    this.save({ [key]: value });
                    this.display();
                }))
            .addExtraButton(button => button
                .setIcon('rotate-ccw')
                .setTooltip('Reset to automatic')
                .setDisabled(!current)
                .onClick(() => {
                    this.save({ [key]: '' });
                    this.display();
                }));
    }

    override hide(): void {
        this.flush();
        super.hide();
    }

    /** Persists a partial change and pushes it to every open terminal. */
    private save(change: Partial<UncommonTerminalSettings>): void {
        Object.assign(this.plugin.settings, change);
        void this.plugin.saveSettings();
    }

    /**
     * The same, coalesced. A text field fires `onChange` on every keystroke,
     * and a save writes to disk and re-fits every open terminal — so typing a
     * font name should not do that fifteen times.
     */
    private saveSoon(change: Partial<UncommonTerminalSettings>): void {
        Object.assign(this.plugin.settings, change);
        if (this.saveTimer !== null) activeWindow.clearTimeout(this.saveTimer);
        this.saveTimer = activeWindow.setTimeout(() => {
            this.saveTimer = null;
            void this.plugin.saveSettings();
        }, SAVE_DEBOUNCE_MS);
    }

    /** Writes a pending change out now, so closing settings never loses one. */
    private flush(): void {
        if (this.saveTimer === null) return;
        activeWindow.clearTimeout(this.saveTimer);
        this.saveTimer = null;
        void this.plugin.saveSettings();
    }
}
