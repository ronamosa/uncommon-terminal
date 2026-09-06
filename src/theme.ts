/**
 * Terminal palette resolution.
 *
 * Colors come from the user's Ghostty config where it sets them, then from
 * Obsidian's own theme variables, so a fresh install looks like it belongs in
 * the vault rather than like a pasted-in terminal. The palettes below are the
 * last resort, for when neither source has an opinion.
 *
 * `buildTheme` takes a lookup function rather than an element, so the whole
 * resolution is testable without a DOM.
 */

import type { GhosttyConfig, ThemeColors } from './ghostty-config';

/** Every slot the terminal wants filled. */
export type PaletteKey = keyof typeof DARK_FALLBACK;

/** Last-resort palette on a dark background: Catppuccin Mocha. */
export const DARK_FALLBACK = {
    background: '#1e1e2e',
    foreground: '#cdd6f4',
    cursor: '#f5e0dc',
    black: '#45475a',
    red: '#f38ba8',
    green: '#a6e3a1',
    yellow: '#f9e2af',
    blue: '#89b4fa',
    magenta: '#f5c2e7',
    cyan: '#94e2d5',
    white: '#bac2de',
    brightBlack: '#585b70',
    brightRed: '#f37799',
    brightGreen: '#89d88b',
    brightYellow: '#ebd391',
    brightBlue: '#74a8fc',
    brightMagenta: '#f2aede',
    brightCyan: '#6bd7ca',
    brightWhite: '#a6adc8',
} as const;

/** The same on a light background: Catppuccin Latte. */
export const LIGHT_FALLBACK: Record<PaletteKey, string> = {
    background: '#eff1f5',
    foreground: '#4c4f69',
    cursor: '#dc8a78',
    black: '#5c5f77',
    red: '#d20f39',
    green: '#40a02b',
    yellow: '#df8e1d',
    blue: '#1e66f5',
    magenta: '#ea76cb',
    cyan: '#179299',
    white: '#acb0be',
    brightBlack: '#6c6f85',
    brightRed: '#de293e',
    brightGreen: '#49af3d',
    brightYellow: '#eea02d',
    brightBlue: '#456eff',
    brightMagenta: '#fe85d8',
    brightCyan: '#2d9fa8',
    brightWhite: '#bcc0cc',
};

/**
 * Obsidian CSS variables worth borrowing. The accent colors track the vault's
 * theme and are picked to read against its background, which is exactly what an
 * ANSI palette needs.
 *
 * Deliberately absent: black and white. Obsidian's `--color-base-*` scale
 * inverts between light and dark, but ANSI colour 0 must stay the darker of the
 * pair in both — so those come from the fallback palette instead.
 */
const OBSIDIAN_VARS: Partial<Record<PaletteKey, string>> = {
    background: '--background-primary',
    foreground: '--text-normal',
    cursor: '--text-accent',
    red: '--color-red',
    green: '--color-green',
    yellow: '--color-yellow',
    blue: '--color-blue',
    magenta: '--color-purple',
    cyan: '--color-cyan',
};

/** Bright slots, and the normal slot each one brightens. */
const BRIGHT_OF: Partial<Record<PaletteKey, PaletteKey>> = {
    brightRed: 'red',
    brightGreen: 'green',
    brightYellow: 'yellow',
    brightBlue: 'blue',
    brightMagenta: 'magenta',
    brightCyan: 'cyan',
};

/**
 * How far a derived bright color moves towards white. Catppuccin shifts its
 * brights by about this much, in both its light and its dark palette.
 */
const BRIGHTEN = 0.12;

/** Reads a CSS custom property, or undefined when it is unset or empty. */
export type VarLookup = (name: string) => string | undefined;

/** A lookup backed by a live element. The only part of this module needing a DOM. */
export function cssVarLookup(host?: HTMLElement): VarLookup {
    if (!host) return () => undefined;
    const style = getComputedStyle(host);
    return name => {
        const value = style.getPropertyValue(name).trim();
        return value.length > 0 ? value : undefined;
    };
}

interface Rgb { r: number; g: number; b: number }

/** Parses the color forms a config or `getComputedStyle` can hand us. */
export function parseColor(value: string): Rgb | null {
    const trimmed = value.trim();

    const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);
    if (hex) {
        const digits = hex[1].length === 3
            ? hex[1].split('').map(d => d + d).join('')
            : hex[1];
        return {
            r: parseInt(digits.slice(0, 2), 16),
            g: parseInt(digits.slice(2, 4), 16),
            b: parseInt(digits.slice(4, 6), 16),
        };
    }

    const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(trimmed);
    if (rgb) {
        return { r: Math.round(+rgb[1]), g: Math.round(+rgb[2]), b: Math.round(+rgb[3]) };
    }

    return null;
}

function toHex({ r, g, b }: Rgb): string {
    const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
    return '#' + [r, g, b].map(n => clamp(n).toString(16).padStart(2, '0')).join('');
}

/** Mixes a color towards white. Returns the input unchanged if it will not parse. */
export function lighten(value: string, amount: number): string {
    const rgb = parseColor(value);
    if (!rgb) return value;
    return toHex({
        r: rgb.r + (255 - rgb.r) * amount,
        g: rgb.g + (255 - rgb.g) * amount,
        b: rgb.b + (255 - rgb.b) * amount,
    });
}

/**
 * Whether a background counts as dark, by perceived luminance. Anything that
 * will not parse is treated as dark, which is the safer guess for a terminal.
 */
export function isDarkBackground(value: string | undefined): boolean {
    const rgb = value ? parseColor(value) : null;
    if (!rgb) return true;
    return (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255 < 0.5;
}

/** Colors set in the plugin's own settings, which outrank every other source. */
export type PaletteOverrides = Partial<Record<PaletteKey, string>>;

/**
 * Builds the palette handed to the terminal: the plugin's settings first, then
 * the Ghostty config, then Obsidian's theme, then the fallback for whichever
 * background we landed on.
 */
export function buildTheme(
    config: GhosttyConfig,
    lookup: VarLookup,
    overrides: PaletteOverrides = {},
): Record<string, string> {
    const background = overrides.background
        ?? config.colors.background
        ?? lookup(OBSIDIAN_VARS.background as string);
    const fallback: Record<PaletteKey, string> =
        isDarkBackground(background) ? DARK_FALLBACK : LIGHT_FALLBACK;

    const theme: Record<string, string> = {};
    // Which slots came from Obsidian, so brights can be derived from the same
    // source rather than mixing a theme's red with Catppuccin's bright red.
    const fromTheme = new Set<PaletteKey>();

    for (const key of Object.keys(DARK_FALLBACK) as PaletteKey[]) {
        const override = overrides[key];
        if (override) {
            theme[key] = override;
            continue;
        }

        const fromConfig = config.colors[key as keyof ThemeColors];
        if (fromConfig) {
            theme[key] = fromConfig;
            continue;
        }

        // A variable that resolves to something we cannot parse — an unresolved
        // `var()`, a keyword — is no use to the renderer, so treat it as unset.
        const varName = OBSIDIAN_VARS[key];
        const looked = varName ? lookup(varName) : undefined;
        const fromObsidian = looked && parseColor(looked) ? looked : undefined;
        if (fromObsidian) {
            theme[key] = fromObsidian;
            fromTheme.add(key);
            continue;
        }

        theme[key] = fallback[key];
    }

    for (const [bright, normal] of Object.entries(BRIGHT_OF) as [PaletteKey, PaletteKey][]) {
        if (overrides[bright] || config.colors[bright as keyof ThemeColors]) continue;
        if (!fromTheme.has(normal) && !overrides[normal]) continue;
        theme[bright] = lighten(theme[normal], BRIGHTEN);
    }

    if (config.colors.selectionBackground) {
        theme.selectionBackground = config.colors.selectionBackground;
    }
    if (config.colors.selectionForeground) {
        theme.selectionForeground = config.colors.selectionForeground;
    }

    return theme;
}
