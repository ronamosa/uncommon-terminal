/**
 * Terminal palette resolution.
 *
 * Colors come from the user's Ghostty config where it sets them, and otherwise
 * from Obsidian's own theme variables so a fresh install looks like it belongs
 * in the vault rather than like a pasted-in terminal. The constants below are
 * the last resort, for when neither source has an opinion.
 */

import type { GhosttyConfig, ThemeColors } from './ghostty-config';

/** Last-resort palette: Catppuccin Mocha, which reads well on dark themes. */
export const FALLBACK_PALETTE = {
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
    brightRed: '#f38ba8',
    brightGreen: '#a6e3a1',
    brightYellow: '#f9e2af',
    brightBlue: '#89b4fa',
    brightMagenta: '#f5c2e7',
    brightCyan: '#94e2d5',
    brightWhite: '#a6adc8',
} as const;

/** Obsidian CSS variables worth borrowing when Ghostty says nothing. */
const OBSIDIAN_VARS: Partial<Record<keyof typeof FALLBACK_PALETTE, string>> = {
    background: '--background-primary',
    foreground: '--text-normal',
    cursor: '--text-accent',
};

/**
 * Reads a CSS custom property off an element, returning undefined when it is
 * unset or empty. Kept narrow so the caller can pass any host element.
 */
function cssVar(el: HTMLElement, name: string): string | undefined {
    const value = getComputedStyle(el).getPropertyValue(name).trim();
    return value.length > 0 ? value : undefined;
}

/**
 * Builds the palette handed to the terminal: Ghostty config first, then
 * Obsidian's theme for the few colors it can speak to, then the fallback.
 */
export function buildTheme(config: GhosttyConfig, host?: HTMLElement): Record<string, string> {
    const theme: Record<string, string> = {};

    for (const key of Object.keys(FALLBACK_PALETTE) as (keyof typeof FALLBACK_PALETTE)[]) {
        const fromConfig = config.colors[key as keyof ThemeColors];
        if (fromConfig) {
            theme[key] = fromConfig;
            continue;
        }

        const varName = OBSIDIAN_VARS[key];
        const fromObsidian = varName && host ? cssVar(host, varName) : undefined;
        theme[key] = fromObsidian ?? FALLBACK_PALETTE[key];
    }

    if (config.colors.selectionBackground) {
        theme.selectionBackground = config.colors.selectionBackground;
    }
    if (config.colors.selectionForeground) {
        theme.selectionForeground = config.colors.selectionForeground;
    }

    return theme;
}
