/**
 * Ghostty config reading.
 *
 * Ghostty's config is line-delimited `key = value` with `#` comments. We read
 * the subset that has a meaning inside an Obsidian pane — font, cursor, colors,
 * scrollback, shell, keybinds — and ignore the rest.
 *
 * `theme = <name>` names another file in the same format, which is how most
 * Ghostty users set their colors, so resolving it is part of reading a config
 * rather than an extra.
 *
 * The parse is split in two: `parseGhosttyConfigText` is pure and testable,
 * `loadGhosttyConfig` does the filesystem lookup around it.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import type { Keybind } from './keybinds';

export interface ThemeColors {
    background?: string;
    foreground?: string;
    cursor?: string;
    cursorText?: string;
    selectionBackground?: string;
    selectionForeground?: string;
    black?: string;
    red?: string;
    green?: string;
    yellow?: string;
    blue?: string;
    magenta?: string;
    cyan?: string;
    white?: string;
    brightBlack?: string;
    brightRed?: string;
    brightGreen?: string;
    brightYellow?: string;
    brightBlue?: string;
    brightMagenta?: string;
    brightCyan?: string;
    brightWhite?: string;
}

export interface GhosttyConfig {
    fontFamily?: string;
    fontSize?: number;
    cursorStyle?: 'block' | 'bar' | 'underline';
    cursorBlink?: boolean;
    theme?: string;
    colors: ThemeColors;
    scrollback?: number;
    shell?: string;
    keybinds: Keybind[];
}

export function emptyGhosttyConfig(): GhosttyConfig {
    return { colors: {}, keybinds: [] };
}

/** Candidate config paths, in the order Ghostty itself would look. */
export function configCandidatePaths(overridePath?: string): string[] {
    if (overridePath) return [expandHome(overridePath)];

    const xdgRoot = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    const candidates = [path.join(xdgRoot, 'ghostty', 'config')];

    if (process.platform === 'darwin') {
        candidates.push(
            path.join(os.homedir(), 'Library', 'Application Support', 'com.mitchellh.ghostty', 'config')
        );
    }

    return candidates;
}

/** Expands a leading `~` to the user's home directory. */
export function expandHome(val: string): string {
    if (val === '~') return os.homedir();
    if (val.startsWith('~/')) return path.join(os.homedir(), val.slice(2));
    return val;
}

/** Accepts Ghostty's hex colors with or without a leading `#`. */
function normalizeColor(val: string): string {
    const trimmed = val.trim();
    if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return '#' + trimmed;
    return trimmed;
}

/**
 * Reads the first config file that exists, resolving any named theme. Returns
 * defaults when none do.
 *
 * `prefersDark` picks a side of Ghostty's `theme = dark:One,light:Other` form;
 * pass whichever Obsidian is currently showing.
 */
export function loadGhosttyConfig(overridePath?: string, prefersDark = true): GhosttyConfig {
    for (const candidate of configCandidatePaths(overridePath)) {
        try {
            if (fs.existsSync(candidate)) {
                const config = parseGhosttyConfigText(fs.readFileSync(candidate, 'utf8'));
                return resolveTheme(config, prefersDark);
            }
        } catch {
            // Unreadable path — try the next candidate.
        }
    }
    return emptyGhosttyConfig();
}

/**
 * Picks the theme name to load. Ghostty accepts a bare name, or a pair
 * `dark:One,light:Other`; when only one side of the pair is given, it is used
 * for both rather than leaving the other unthemed.
 */
export function selectThemeName(raw: string, prefersDark: boolean): string | undefined {
    const parts = raw.split(',').map(part => part.trim()).filter(part => part.length > 0);
    if (parts.length === 0) return undefined;

    const sides = new Map<string, string>();
    for (const part of parts) {
        const idx = part.indexOf(':');
        if (idx === -1) continue;
        const side = part.slice(0, idx).trim().toLowerCase();
        if (side === 'dark' || side === 'light') sides.set(side, part.slice(idx + 1).trim());
    }
    if (sides.size === 0) return parts[0];

    const wanted = prefersDark ? 'dark' : 'light';
    const other = prefersDark ? 'light' : 'dark';
    return sides.get(wanted) ?? sides.get(other);
}

/**
 * Lays a theme's colors under the config's own. A theme is a floor, not a
 * ceiling: a `background =` written next to `theme =` still wins, which is how
 * Ghostty treats it.
 */
export function mergeThemeColors(base: ThemeColors, theme: ThemeColors): ThemeColors {
    return { ...theme, ...base };
}

/** Directories Ghostty searches for named themes, in the order it searches. */
export function themeSearchDirs(): string[] {
    const xdgRoot = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    const dirs = [path.join(xdgRoot, 'ghostty', 'themes')];

    // Set inside a Ghostty session, and the most reliable pointer at the
    // shipped themes when there is one.
    if (process.env.GHOSTTY_RESOURCES_DIR) {
        dirs.push(path.join(process.env.GHOSTTY_RESOURCES_DIR, 'themes'));
    }

    if (process.platform === 'darwin') {
        dirs.push(
            path.join(os.homedir(), 'Library', 'Application Support', 'com.mitchellh.ghostty', 'themes'),
            '/Applications/Ghostty.app/Contents/Resources/ghostty/themes',
        );
    } else {
        dirs.push('/usr/share/ghostty/themes', '/usr/local/share/ghostty/themes');
    }

    return dirs;
}

/** Finds a theme file, matching the name case-insensitively as Ghostty does. */
export function findThemeFile(name: string): string | null {
    for (const dir of themeSearchDirs()) {
        try {
            const exact = path.join(dir, name);
            if (fs.existsSync(exact) && fs.statSync(exact).isFile()) return exact;
        } catch {
            // Unreadable path — fall through to the scan.
        }

        try {
            const match = fs.readdirSync(dir).find(entry => entry.toLowerCase() === name.toLowerCase());
            if (match) return path.join(dir, match);
        } catch {
            // No such directory on this machine.
        }
    }
    return null;
}

/** Fills in colors from `theme = <name>`, if the config names one we can find. */
export function resolveTheme(config: GhosttyConfig, prefersDark: boolean): GhosttyConfig {
    if (!config.theme) return config;

    const name = selectThemeName(config.theme, prefersDark);
    const file = name ? findThemeFile(name) : null;
    if (!file) return config;

    try {
        // Theme files are config files, so the same parser reads them.
        const theme = parseGhosttyConfigText(fs.readFileSync(file, 'utf8'));
        config.colors = mergeThemeColors(config.colors, theme.colors);
    } catch {
        // Unreadable theme — the config's own colors still stand.
    }

    return config;
}

/** Parses the text of a Ghostty config file. */
export function parseGhosttyConfigText(raw: string): GhosttyConfig {
    const config = emptyGhosttyConfig();

    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
        if (/^\[.+\]$/.test(trimmed)) continue; // section header

        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;

        const key = trimmed.slice(0, eqIdx).trim().toLowerCase();
        const rawValue = trimmed.slice(eqIdx + 1).trim();

        // Strip a trailing comment, which Ghostty writes as ` #`.
        const commentIdx = rawValue.indexOf(' #');
        const value = commentIdx === -1 ? rawValue : rawValue.slice(0, commentIdx).trim();

        applyConfigKey(config, key, value);
    }

    return config;
}

const PALETTE_NAMES: (keyof ThemeColors)[] = [
    'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
    'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
    'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
];

const COLOR_KEYS: Record<string, keyof ThemeColors> = {
    'background': 'background',
    'foreground': 'foreground',
    'cursor-color': 'cursor',
    'cursor-text': 'cursorText',
    'selection-background': 'selectionBackground',
    'selection-foreground': 'selectionForeground',
};

function applyConfigKey(config: GhosttyConfig, key: string, value: string) {
    const colorKey = COLOR_KEYS[key];
    if (colorKey) {
        config.colors[colorKey] = normalizeColor(value);
        return;
    }

    switch (key) {
        case 'font-family':
            config.fontFamily = value;
            break;
        case 'font-size':
            config.fontSize = parseFloat(value) || undefined;
            break;
        case 'cursor-style':
            if (value === 'block' || value === 'bar' || value === 'underline') {
                config.cursorStyle = value;
            }
            break;
        case 'cursor-style-blink':
            config.cursorBlink = value === 'true';
            break;
        case 'theme':
            config.theme = value;
            break;
        case 'scrollback-limit':
            config.scrollback = parseInt(value, 10) || undefined;
            break;
        case 'command':
            config.shell = expandHome(value);
            break;
        case 'palette': {
            // palette = 0=#rrggbb
            const [idxStr, colorStr] = value.split('=');
            const idx = parseInt(idxStr.trim(), 10);
            if (idx >= 0 && idx < PALETTE_NAMES.length) {
                config.colors[PALETTE_NAMES[idx]] = normalizeColor(colorStr ?? '');
            }
            break;
        }
        case 'keybind': {
            // keybind = super+c=copy_to_clipboard — split on the FIRST '=',
            // as Ghostty does, so an action containing '=' survives intact
            // (`ctrl+e=text:a=b` is the action `text:a=b`, not `b`).
            const eqIdx = value.indexOf('=');
            if (eqIdx === -1) break;
            const combo = value.slice(0, eqIdx).trim();
            const action = value.slice(eqIdx + 1).trim();
            if (!combo || !action) break;

            const parts = combo.split('+');
            config.keybinds.push({
                key: parts[parts.length - 1].toLowerCase(),
                mods: new Set(parts.slice(0, -1).map(m => m.toLowerCase())),
                action,
            });
            break;
        }
    }
}
