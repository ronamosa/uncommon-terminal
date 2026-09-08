import { App, PluginSettingTab, Setting } from 'obsidian';
import type { SettingDefinition, SettingDefinitionGroup, SettingDefinitionItem } from 'obsidian';

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

/** Settings whose control is a text field, and so should save on a debounce. */
const DEBOUNCED_KEYS: ReadonlySet<string> = new Set([
    'fontFamilyOverride',
    'fontSizeOverride',
    'scrollbackLines',
    'defaultShell',
    'pythonPath',
    'ghosttyConfigPath',
]);

/** Numbers held in a text field, where an empty field means "defer". */
const NUMERIC_KEYS: ReadonlySet<string> = new Set(['fontSizeOverride', 'scrollbackLines']);

export class UncommonTerminalSettingTab extends PluginSettingTab {
    private saveTimer: number | null = null;

    constructor(app: App, private readonly plugin: UncommonTerminalPlugin) {
        super(app, plugin);
    }

    /**
     * The declarative form, which Obsidian 1.13 and later renders itself and
     * indexes for the settings search.
     */
    override getSettingDefinitions(): SettingDefinitionItem[] {
        return [
            {
                type: 'group',
                heading: 'Appearance',
                items: [
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
                type: 'group',
                heading: 'Colors',
                items: [
                    this.colorDefinition('Background', 'backgroundOverride', '#000000'),
                    // Unlike the background, text color is baked into cells by
                    // the buffer, which has no setter — so it cannot be changed
                    // under a running shell.
                    this.colorDefinition('Text', 'foregroundOverride', '#cccccc',
                        'Takes effect in terminals opened from now on.'),
                    this.colorDefinition('Cursor', 'cursorColorOverride', '#00ff00'),
                ],
            },
            {
                type: 'group',
                heading: 'Shell',
                items: [
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
                type: 'group',
                heading: 'Ghostty config',
                items: [
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
     * its own affordance, which no declarative control offers — hence `render`.
     */
    private colorDefinition(
        name: string,
        key: 'backgroundOverride' | 'foregroundOverride' | 'cursorColorOverride',
        sample: string,
        note?: string,
    ): SettingDefinition {
        const current = this.plugin.settings[key];
        const state = current
            ? `${current}.`
            : 'Automatic — follows your Ghostty config, then your Obsidian theme.';

        return {
            name,
            desc: note ? `${state} ${note}` : state,
            aliases: ['color'],
            render: setting => {
                setting
                    .addColorPicker(picker => picker
                        .setValue(current || sample)
                        .onChange(value => {
                            this.save({ [key]: value });
                            this.redraw();
                        }))
                    .addExtraButton(button => button
                        .setIcon('rotate-ccw')
                        .setTooltip('Reset to automatic')
                        .setDisabled(!current)
                        .onClick(() => {
                            this.save({ [key]: '' });
                            this.redraw();
                        }));
            },
        };
    }

    /**
     * The imperative fallback, which Obsidian only calls before 1.13. It walks
     * the same definitions rather than restating them, so the two forms cannot
     * drift apart.
     */
    override display(): void {
        const { containerEl } = this;
        containerEl.empty();

        for (const item of this.getSettingDefinitions()) {
            if (!('type' in item)) {
                this.displayOne(item);
                continue;
            }
            const group = item as SettingDefinitionGroup;
            if (group.heading) new Setting(containerEl).setName(group.heading).setHeading();
            for (const child of group.items ?? []) this.displayOne(child);
        }
    }

    /** Renders one definition the way 1.13 would. */
    private displayOne(def: SettingDefinition): void {
        const setting = new Setting(this.containerEl).setName(def.name);
        if (def.desc) setting.setDesc(def.desc);

        if (def.render) {
            (def.render as (setting: Setting) => void)(setting);
            return;
        }

        const control = def.control;
        if (!control) return;
        const stored = this.getControlValue(control.key);
        const value = typeof stored === 'string' ? stored : '';

        switch (control.type) {
            case 'dropdown':
                setting.addDropdown(dropdown => {
                    for (const [key, label] of Object.entries(control.options)) {
                        dropdown.addOption(key, label);
                    }
                    dropdown
                        .setValue(value)
                        .onChange(next => void this.setControlValue(control.key, next));
                });
                break;
            case 'text':
                setting.addText(text => {
                    if (control.placeholder) text.setPlaceholder(control.placeholder);
                    text
                        .setValue(value)
                        .onChange(next => void this.setControlValue(control.key, next));
                });
                break;
            default:
                break;
        }
    }

    /** Reads a control's value, as the text a field should show. */
    override getControlValue(key: string): unknown {
        const settings = this.plugin.settings as unknown as Record<string, unknown>;
        if (NUMERIC_KEYS.has(key)) {
            const lines = settings[key] as number;
            return lines > 0 ? String(lines) : '';
        }
        return settings[key];
    }

    /** Writes a control's value back, parsing the fields that hold numbers. */
    override setControlValue(key: string, value: unknown): void {
        const raw = typeof value === 'string' ? value : '';
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

    /**
     * Re-runs the definitions after a change one of them reads — the color
     * rows show their own state. `update` only exists from 1.13 on.
     */
    private redraw(): void {
        if (typeof this.update === 'function') this.update();
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- the pre-1.13 path
        else this.display();
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
