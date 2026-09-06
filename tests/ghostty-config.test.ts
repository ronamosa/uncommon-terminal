import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import * as os from 'os';
import * as path from 'path';

import {
    configCandidatePaths,
    emptyGhosttyConfig,
    expandHome,
    mergeThemeColors,
    parseGhosttyConfigText,
    selectThemeName,
} from '../src/ghostty-config';

describe('parseGhosttyConfigText', () => {
    it('returns empty defaults for an empty file', () => {
        assert.deepEqual(parseGhosttyConfigText(''), emptyGhosttyConfig());
    });

    it('reads the font and cursor settings', () => {
        const config = parseGhosttyConfigText([
            'font-family = JetBrains Mono',
            'font-size = 14',
            'cursor-style = bar',
            'cursor-style-blink = true',
        ].join('\n'));

        assert.equal(config.fontFamily, 'JetBrains Mono');
        assert.equal(config.fontSize, 14);
        assert.equal(config.cursorStyle, 'bar');
        assert.equal(config.cursorBlink, true);
    });

    it('rejects a cursor style it does not know', () => {
        assert.equal(parseGhosttyConfigText('cursor-style = wobble').cursorStyle, undefined);
    });

    it('skips comments, blank lines, section headers, and lines with no value', () => {
        const config = parseGhosttyConfigText([
            '# a comment',
            '',
            '   ',
            '[some-section]',
            'nonsense-without-an-equals-sign',
            '  font-size = 12  ',
        ].join('\n'));

        assert.equal(config.fontSize, 12);
    });

    it('strips a trailing comment from a value', () => {
        assert.equal(parseGhosttyConfigText('font-family = Menlo # the safe one').fontFamily, 'Menlo');
    });

    it('accepts hex colors with or without a leading hash', () => {
        const config = parseGhosttyConfigText([
            'background = 1e1e2e',
            'foreground = #cdd6f4',
        ].join('\n'));

        assert.equal(config.colors.background, '#1e1e2e');
        assert.equal(config.colors.foreground, '#cdd6f4');
    });

    it('maps palette entries onto the ANSI color names', () => {
        const config = parseGhosttyConfigText([
            'palette = 0=#000000',
            'palette = 9=#ff0000',
            'palette = 15=#ffffff',
        ].join('\n'));

        assert.equal(config.colors.black, '#000000');
        assert.equal(config.colors.brightRed, '#ff0000');
        assert.equal(config.colors.brightWhite, '#ffffff');
    });

    it('ignores a palette index outside the 16 ANSI colors', () => {
        const config = parseGhosttyConfigText('palette = 200=#ff0000');
        assert.deepEqual(config.colors, {});
    });

    it('parses a keybind into modifiers, key, and action', () => {
        const [keybind] = parseGhosttyConfigText('keybind = ctrl+shift+C=copy_to_clipboard').keybinds;

        assert.deepEqual(keybind.mods, new Set(['ctrl', 'shift']));
        assert.equal(keybind.key, 'c');
        assert.equal(keybind.action, 'copy_to_clipboard');
    });

    it('splits a keybind on the last equals sign so text actions survive', () => {
        const [keybind] = parseGhosttyConfigText('keybind = ctrl+e=text:a=b').keybinds;

        assert.equal(keybind.key, 'e');
        assert.equal(keybind.action, 'text:a=b');
    });

    it('drops a malformed keybind rather than half-parsing it', () => {
        const config = parseGhosttyConfigText([
            'keybind = no_action_here',
            'keybind = =copy_to_clipboard',
            'keybind = ctrl+q=',
        ].join('\n'));

        assert.deepEqual(config.keybinds, []);
    });

    it('expands a home-relative shell command', () => {
        assert.equal(parseGhosttyConfigText('command = ~/bin/fish').shell,
            path.join(os.homedir(), 'bin/fish'));
    });

    it('ignores keys it has no use for', () => {
        const config = parseGhosttyConfigText('window-decoration = false\nfont-size = 11');
        assert.equal(config.fontSize, 11);
    });
});

describe('expandHome', () => {
    it('expands a bare tilde and a tilde path', () => {
        assert.equal(expandHome('~'), os.homedir());
        assert.equal(expandHome('~/.config/ghostty/config'),
            path.join(os.homedir(), '.config/ghostty/config'));
    });

    it('leaves an absolute path and a tilde-prefixed name alone', () => {
        assert.equal(expandHome('/etc/ghostty'), '/etc/ghostty');
        assert.equal(expandHome('~notauser/config'), '~notauser/config');
    });
});

describe('configCandidatePaths', () => {
    it('uses only the override when one is given, expanding it', () => {
        assert.deepEqual(configCandidatePaths('~/custom'), [path.join(os.homedir(), 'custom')]);
    });

    it('looks in the XDG location first', () => {
        const [first] = configCandidatePaths();
        assert.equal(path.basename(first), 'config');
        assert.equal(path.basename(path.dirname(first)), 'ghostty');
    });
});

describe('selectThemeName', () => {
    it('passes a bare name through', () => {
        assert.equal(selectThemeName('Catppuccin Mocha', true), 'Catppuccin Mocha');
        assert.equal(selectThemeName('Catppuccin Mocha', false), 'Catppuccin Mocha');
    });

    it('picks the side matching the vault theme', () => {
        const raw = 'dark:Catppuccin Mocha,light:Catppuccin Latte';
        assert.equal(selectThemeName(raw, true), 'Catppuccin Mocha');
        assert.equal(selectThemeName(raw, false), 'Catppuccin Latte');
    });

    it('falls back to the other side when only one is given', () => {
        assert.equal(selectThemeName('dark:Nord', false), 'Nord');
        assert.equal(selectThemeName('light:Nord', true), 'Nord');
    });

    it('returns nothing for an empty value', () => {
        assert.equal(selectThemeName('', true), undefined);
        assert.equal(selectThemeName('  ,  ', true), undefined);
    });
});

describe('mergeThemeColors', () => {
    it('fills in colors the config does not set', () => {
        const merged = mergeThemeColors({ background: '#000000' }, { background: '#111111', red: '#ff0000' });
        assert.equal(merged.red, '#ff0000');
    });

    it('lets a color set in the config win over the theme', () => {
        const merged = mergeThemeColors({ background: '#000000' }, { background: '#111111' });
        assert.equal(merged.background, '#000000');
    });
});
