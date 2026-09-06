/**
 * Keybind matching.
 *
 * Ghostty's own keybinds are merged with a small builtin set and matched in
 * the capture phase on the terminal element, so Obsidian's global hotkeys
 * never see keys that were meant for the shell. Pure and DOM-free: the matcher
 * takes the handful of fields it needs rather than a live KeyboardEvent.
 */

/** One parsed keybind: a modifier set, a Ghostty key name, and an action. */
export interface Keybind {
    /** 'super' | 'ctrl' | 'shift' | 'alt' */
    mods: Set<string>;
    /** Ghostty key name, lowercased. */
    key: string;
    /** e.g. 'copy_to_clipboard', 'paste_from_clipboard', 'text:\x1b[13;2u' */
    action: string;
}

/** The parts of a KeyboardEvent the matcher needs. */
export interface KeyChord {
    key: string;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
}

/**
 * Builtins we always enforce, because they are what makes the pane feel like a
 * terminal rather than a text field. The two kitty-protocol newlines are what
 * lets shift+enter and cmd+enter reach TUIs that understand them.
 */
export const BUILTIN_KEYBINDS: Keybind[] = [
    { mods: new Set(['super']), key: 'c', action: 'copy_to_clipboard' },
    { mods: new Set(['super']), key: 'v', action: 'paste_from_clipboard' },
    { mods: new Set(['shift']), key: 'enter', action: 'text:\x1b[13;2u' },
    { mods: new Set(['super']), key: 'enter', action: 'text:\x1b[13;9u' },
];

export function setsEqual(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
}

/**
 * Merges builtin defaults with keybinds from the user's Ghostty config.
 * A user entry replaces a builtin sharing the same combo.
 */
export function buildEffectiveKeybinds(userKeybinds: Keybind[]): Keybind[] {
    const result = [...BUILTIN_KEYBINDS];
    for (const kb of userKeybinds) {
        const idx = result.findIndex(r => r.key === kb.key && setsEqual(r.mods, kb.mods));
        if (idx === -1) result.push(kb);
        else result[idx] = kb;
    }
    return result;
}

const DOM_KEY_NAMES: Record<string, string> = {
    'Enter': 'enter',
    'Tab': 'tab',
    'Backspace': 'backspace',
    'Escape': 'escape',
    'Delete': 'delete',
    'Insert': 'insert',
    'Home': 'home',
    'End': 'end',
    'PageUp': 'page_up',
    'PageDown': 'page_down',
    'ArrowUp': 'up',
    'ArrowDown': 'down',
    'ArrowLeft': 'left',
    'ArrowRight': 'right',
    ' ': 'space',
};

/** Maps a DOM KeyboardEvent.key to the name Ghostty's config uses. */
export function domKeyToGhostty(domKey: string): string {
    return DOM_KEY_NAMES[domKey] ?? domKey.toLowerCase();
}

/** Collects the modifiers of a chord into Ghostty's naming. */
export function chordMods(chord: KeyChord): Set<string> {
    const mods = new Set<string>();
    if (chord.metaKey) mods.add('super');
    if (chord.ctrlKey) mods.add('ctrl');
    if (chord.shiftKey) mods.add('shift');
    if (chord.altKey) mods.add('alt');
    return mods;
}

/** Finds the keybind a chord triggers, if any. */
export function findKeybind(chord: KeyChord, keybinds: Keybind[]): Keybind | undefined {
    const mods = chordMods(chord);
    const key = domKeyToGhostty(chord.key);
    return keybinds.find(kb => kb.key === key && setsEqual(kb.mods, mods));
}

/** Unescapes the escape sequences Ghostty allows in a `text:` action. */
export function unescapeGhosttyText(s: string): string {
    return s.replace(/\\(.)/g, (_match, ch: string) => {
        switch (ch) {
            case 'e': return '\x1b';
            case 'n': return '\n';
            case 'r': return '\r';
            case 't': return '\t';
            case '\\': return '\\';
            default: return '\\' + ch;
        }
    });
}
