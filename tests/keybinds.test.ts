import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
    BUILTIN_KEYBINDS,
    buildEffectiveKeybinds,
    chordMods,
    domKeyToGhostty,
    findKeybind,
    setsEqual,
    unescapeGhosttyText,
    type KeyChord,
    type Keybind,
} from '../src/keybinds';

function chord(overrides: Partial<KeyChord> = {}): KeyChord {
    return { key: 'a', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...overrides };
}

function bind(mods: string[], key: string, action: string): Keybind {
    return { mods: new Set(mods), key, action };
}

describe('setsEqual', () => {
    it('ignores insertion order', () => {
        assert.equal(setsEqual(new Set(['ctrl', 'shift']), new Set(['shift', 'ctrl'])), true);
    });

    it('rejects a subset', () => {
        assert.equal(setsEqual(new Set(['ctrl']), new Set(['ctrl', 'shift'])), false);
    });
});

describe('domKeyToGhostty', () => {
    it('renames the keys Ghostty spells differently', () => {
        assert.equal(domKeyToGhostty('ArrowUp'), 'up');
        assert.equal(domKeyToGhostty('PageDown'), 'page_down');
        assert.equal(domKeyToGhostty(' '), 'space');
    });

    it('lowercases everything else', () => {
        assert.equal(domKeyToGhostty('C'), 'c');
        assert.equal(domKeyToGhostty('F5'), 'f5');
    });
});

describe('chordMods', () => {
    it('maps the meta key to Ghostty\'s "super"', () => {
        assert.deepEqual(chordMods(chord({ metaKey: true })), new Set(['super']));
    });

    it('collects every modifier held', () => {
        const mods = chordMods(chord({ metaKey: true, ctrlKey: true, shiftKey: true, altKey: true }));
        assert.deepEqual(mods, new Set(['super', 'ctrl', 'shift', 'alt']));
    });
});

describe('buildEffectiveKeybinds', () => {
    it('keeps the builtins when the user adds nothing', () => {
        assert.deepEqual(buildEffectiveKeybinds([]), BUILTIN_KEYBINDS);
    });

    it('lets a user binding replace a builtin sharing the combo', () => {
        const result = buildEffectiveKeybinds([bind(['super'], 'c', 'text:hello')]);
        const match = findKeybind(chord({ key: 'c', metaKey: true }), result);

        assert.equal(match?.action, 'text:hello');
        assert.equal(result.length, BUILTIN_KEYBINDS.length);
    });

    it('appends a binding that does not collide', () => {
        const result = buildEffectiveKeybinds([bind(['ctrl', 'shift'], 'k', 'text:x')]);
        assert.equal(result.length, BUILTIN_KEYBINDS.length + 1);
    });

    it('does not mutate the builtin list', () => {
        const before = BUILTIN_KEYBINDS.length;
        buildEffectiveKeybinds([bind(['ctrl'], 'q', 'text:q'), bind(['super'], 'c', 'text:q')]);
        assert.equal(BUILTIN_KEYBINDS.length, before);
        assert.equal(BUILTIN_KEYBINDS[0].action, 'copy_to_clipboard');
    });
});

describe('findKeybind', () => {
    const keybinds = buildEffectiveKeybinds([]);

    it('matches a builtin exactly', () => {
        assert.equal(findKeybind(chord({ key: 'v', metaKey: true }), keybinds)?.action,
            'paste_from_clipboard');
    });

    it('requires the modifier set to match exactly, not merely contain', () => {
        assert.equal(findKeybind(chord({ key: 'c', metaKey: true, shiftKey: true }), keybinds),
            undefined);
    });

    it('leaves an unbound key alone', () => {
        assert.equal(findKeybind(chord({ key: 'q' }), keybinds), undefined);
    });

    it('sends the kitty-protocol newline for shift+enter', () => {
        assert.equal(findKeybind(chord({ key: 'Enter', shiftKey: true }), keybinds)?.action,
            'text:\x1b[13;2u');
    });
});

describe('unescapeGhosttyText', () => {
    it('expands the sequences Ghostty allows', () => {
        assert.equal(unescapeGhosttyText('\\e[A'), '\x1b[A');
        assert.equal(unescapeGhosttyText('a\\nb'), 'a\nb');
        assert.equal(unescapeGhosttyText('a\\rb'), 'a\rb');
        assert.equal(unescapeGhosttyText('a\\tb'), 'a\tb');
    });

    it('treats an escaped backslash as a literal, not as the start of a sequence', () => {
        assert.equal(unescapeGhosttyText('\\\\e'), '\\e');
        assert.equal(unescapeGhosttyText('\\\\n'), '\\n');
    });

    it('leaves an unknown escape untouched', () => {
        assert.equal(unescapeGhosttyText('\\q'), '\\q');
    });

    it('passes plain text through', () => {
        assert.equal(unescapeGhosttyText('git status'), 'git status');
    });
});
