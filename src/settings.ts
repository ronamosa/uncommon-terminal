import { App, PluginSettingTab, Setting } from 'obsidian';
import type { ExtraButtonComponent, SettingDefinition, SettingDefinitionItem } from 'obsidian';

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

type SettingKey = keyof UncommonTerminalSettings;

/** Settings whose control is a text field, and so should save on a debounce. */
const DEBOUNCED_KEYS: ReadonlySet<SettingKey> = new Set<SettingKey>([
    'fontFamilyOverride',
    'fontSizeOverride',
    'scrollbackLines',
    'defaultShell',
    'pythonPath',
    'ghosttyConfigPath',
]);

/**
 * What a row holds. `custom` is the escape hatch for a row neither form can
 * express declaratively.
 */
type RowControl =
    | { type: 'dropdown'; key: SettingKey; options: Record<string, string> }
    | { type: 'text'; key: SettingKey; placeholder?: string }
    | { type: 'custom'; render: (setting: Setting) => void };

/** One row of the setting tab, in this plugin's own terms. */
interface Row {
    name: string;
    desc?: string;
    aliases?: string[];
    control: RowControl;
}

/** Rows under a shared heading. */
interface RowGroup {
    heading: string;
    rows: Row[];
}

/**
 * Restates one row as Obsidian 1.13 wants it. Building the definitions here,
 * as literals, keeps every 1.13-only member out of the code that runs on
 * 1.7.2 — `getSettingDefinitions` itself is never called there.
 */
function toDefinition(row: Row): SettingDefinition {
    const base = { name: row.name, desc: row.desc, aliases: row.aliases };
    const control = row.control;

    switch (control.type) {
        case 'custom':
            return { ...base, render: control.render };
        case 'dropdown':
            return {
                ...base,
                control: { type: 'dropdown', key: control.key, options: control.options },
            };
        case 'text':
            return {
                ...base,
                control: { type: 'text', key: control.key, placeholder: control.placeholder },
            };
    }
}

export class UncommonTerminalSettingTab extends PluginSettingTab {
    private saveTimer: number | null = null;

    constructor(app: App, private readonly plugin: UncommonTerminalPlugin) {
        super(app, plugin);
    }

    /**
     * Every row, once. Both the declarative form Obsidian 1.13 renders and the
     * imperative one older versions get are built from this, so the two cannot
     * drift apart.
     */
    private groups(): RowGroup[] {
        return [
            {
                heading: 'Appearance',
                rows: [
                    {
                        name: 'Default location',
                        desc: 'Where a terminal opens when you use the ribbon icon or command.',
                        control: {
                            type: 'dropdown',
                            key: 'defaultLocation',
                            options: {
                                right: 'Right sidebar',
                                left: 'Left sidebar',
                                tab: 'New tab',
                                split: 'New split',
                                window: 'Pop-out window',
                            },
                        },
                    },
                    {
                        name: 'Font family',
                        desc: 'Leave empty to use the font from your Ghostty config.',
                        control: { type: 'text', key: 'fontFamilyOverride' },
                    },
                    {
                        name: 'Font size',
                        desc: 'Leave empty to use the size from your Ghostty config.',
                        control: { type: 'text', key: 'fontSizeOverride', placeholder: '13' },
                    },
                    {
                        name: 'Scrollback lines',
                        desc: 'How much output to keep above the visible screen. Leave empty to use the limit from your Ghostty config.',
                        control: {
                            type: 'text',
                            key: 'scrollbackLines',
                            placeholder: String(FALLBACK_SCROLLBACK),
                        },
                    },
                    {
                        name: 'Cursor style',
                        desc: 'Shape of the cursor.',
                        control: {
                            type: 'dropdown',
                            key: 'cursorStyleOverride',
                            options: {
                                '': 'From Ghostty config',
                                block: 'Block',
                                bar: 'Bar',
                                underline: 'Underline',
                            },
                        },
                    },
                    {
                        name: 'Cursor blink',
                        control: {
                            type: 'dropdown',
                            key: 'cursorBlinkOverride',
                            options: {
                                default: 'From Ghostty config',
                                on: 'Blink',
                                off: 'Steady',
                            },
                        },
                    },
                ],
            },
            {
                heading: 'Colors',
                rows: [
                    this.colorRow('Background', 'backgroundOverride', '#000000'),
                    // Unlike the background, text color is baked into cells by
                    // the buffer, which has no setter — so it cannot be changed
                    // under a running shell.
                    this.colorRow('Text', 'foregroundOverride', '#cccccc',
                        'Takes effect in terminals opened from now on.'),
                    this.colorRow('Cursor', 'cursorColorOverride', '#00ff00'),
                ],
            },
            {
                heading: 'Shell',
                rows: [
                    {
                        name: 'Shell path',
                        desc: 'Leave empty to use your login shell. Takes effect in terminals opened from now on.',
                        control: { type: 'text', key: 'defaultShell', placeholder: '/bin/zsh' },
                    },
                    {
                        name: 'Python path',
                        desc: 'Interpreter that runs the PTY helper. Leave empty to detect python3 automatically.',
                        control: { type: 'text', key: 'pythonPath', placeholder: '/usr/bin/python3' },
                    },
                ],
            },
            {
                heading: 'Ghostty config',
                rows: [
                    {
                        name: 'Config file path',
                        desc: 'Leave empty to look in the usual places. Reloaded when you change this.',
                        control: { type: 'text', key: 'ghosttyConfigPath' },
                    },
                ],
            },
        ];
    }

    /**
     * One color row: a picker, and a reset that puts the slot back to being
     * resolved rather than set. A picker always holds a color, so "unset" needs
     * its own affordance, which neither form offers — hence `custom`.
     *
     * The row keeps its own description current rather than asking the tab to
     * re-render, since the two forms redraw by different means.
     */
    private colorRow(
        name: string,
        key: 'backgroundOverride' | 'foregroundOverride' | 'cursorColorOverride',
        sample: string,
        note?: string,
    ): Row {
        const searchDesc = 'Leave unset to follow your Ghostty config, then your Obsidian theme.';

        return {
            name,
            desc: note ? `${searchDesc} ${note}` : searchDesc,
            aliases: ['color'],
            control: {
                type: 'custom',
                render: setting => {
                    let reset: ExtraButtonComponent | null = null;

                    const describe = (): void => {
                        const current = this.plugin.settings[key];
                        const state = current
                            ? `${current}.`
                            : 'Automatic — follows your Ghostty config, then your Obsidian theme.';
                        setting.setDesc(note ? `${state} ${note}` : state);
                        reset?.setDisabled(!current);
                    };

                    setting
                        .addColorPicker(picker => picker
                            .setValue(this.plugin.settings[key] || sample)
                            .onChange(value => {
                                this.save({ [key]: value });
                                describe();
                            }))
                        .addExtraButton(button => {
                            reset = button;
                            button
                                .setIcon('rotate-ccw')
                                .setTooltip('Reset to automatic')
                                .onClick(() => {
                                    this.save({ [key]: '' });
                                    describe();
                                });
                        });

                    describe();
                },
            },
        };
    }

    /**
     * The declarative form, which Obsidian 1.13 and later renders itself and
     * indexes for the settings search.
     */
    override getSettingDefinitions(): SettingDefinitionItem[] {
        return this.groups().map(group => ({
            type: 'group',
            heading: group.heading,
            items: group.rows.map(toDefinition),
        }));
    }

    /** The imperative form, which Obsidian only calls before 1.13. */
    override display(): void {
        const { containerEl } = this;
        containerEl.empty();

        for (const group of this.groups()) {
            new Setting(containerEl).setName(group.heading).setHeading();
            for (const row of group.rows) this.displayRow(row);
        }
    }

    /** Renders one row the way 1.13 would. */
    private displayRow(row: Row): void {
        const setting = new Setting(this.containerEl).setName(row.name);
        if (row.desc) setting.setDesc(row.desc);

        const control = row.control;
        switch (control.type) {
            case 'custom':
                control.render(setting);
                break;
            case 'dropdown':
                setting.addDropdown(dropdown => {
                    for (const [value, label] of Object.entries(control.options)) {
                        dropdown.addOption(value, label);
                    }
                    dropdown
                        .setValue(this.read(control.key))
                        .onChange(next => this.write(control.key, next));
                });
                break;
            case 'text':
                setting.addText(text => {
                    if (control.placeholder) text.setPlaceholder(control.placeholder);
                    text
                        .setValue(this.read(control.key))
                        .onChange(next => this.write(control.key, next));
                });
                break;
        }
    }

    override getControlValue(key: string): unknown {
        return this.read(key as SettingKey);
    }

    override setControlValue(key: string, value: unknown): void {
        this.write(key as SettingKey, typeof value === 'string' ? value : '');
    }

    /** A setting as the text its field should show. Zero means "defer". */
    private read(key: SettingKey): string {
        const value = this.plugin.settings[key];
        if (typeof value === 'number') return value > 0 ? String(value) : '';
        return value;
    }

    /** The reverse, parsing the fields that hold numbers. */
    private write(key: SettingKey, raw: string): void {
        let change: Partial<UncommonTerminalSettings>;
        switch (key) {
            case 'fontSizeOverride':
                change = { fontSizeOverride: parseFloat(raw) || 0 };
                break;
            case 'scrollbackLines':
                change = { scrollbackLines: parseScrollback(raw) };
                break;
            default:
                change = { [key]: raw };
        }

        if (DEBOUNCED_KEYS.has(key)) this.saveSoon(change);
        else this.save(change);
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
        if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
        this.saveTimer = window.setTimeout(() => {
            this.saveTimer = null;
            void this.plugin.saveSettings();
        }, SAVE_DEBOUNCE_MS);
    }

    /** Writes a pending change out now, so closing settings never loses one. */
    private flush(): void {
        if (this.saveTimer === null) return;
        window.clearTimeout(this.saveTimer);
        this.saveTimer = null;
        void this.plugin.saveSettings();
    }
}
