import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { emptyGhosttyConfig, type GhosttyConfig } from '../src/ghostty-config';
import {
    DARK_FALLBACK,
    LIGHT_FALLBACK,
    buildTheme,
    isDarkBackground,
    lighten,
    parseColor,
    type VarLookup,
} from '../src/theme';

/** A lookup over a plain object, standing in for getComputedStyle. */
function lookupOf(vars: Record<string, string>): VarLookup {
    return name => vars[name];
}

const NO_VARS: VarLookup = () => undefined;

describe('parseColor', () => {
    it('reads hex, with or without the hash', () => {
        assert.deepEqual(parseColor('#1e66f5'), { r: 30, g: 102, b: 245 });
        assert.deepEqual(parseColor('1e66f5'), { r: 30, g: 102, b: 245 });
    });

    it('expands three-digit hex', () => {
        assert.deepEqual(parseColor('#f0a'), { r: 255, g: 0, b: 170 });
    });

    it('reads the rgb() forms getComputedStyle returns', () => {
        assert.deepEqual(parseColor('rgb(30, 102, 245)'), { r: 30, g: 102, b: 245 });
        assert.deepEqual(parseColor('rgba(30, 102, 245, 0.5)'), { r: 30, g: 102, b: 245 });
        assert.deepEqual(parseColor('rgb(30 102 245)'), { r: 30, g: 102, b: 245 });
    });

    it('returns null for anything else', () => {
        assert.equal(parseColor('var(--nope)'), null);
        assert.equal(parseColor(''), null);
    });
});

describe('lighten', () => {
    it('moves a color towards white', () => {
        assert.equal(lighten('#000000', 0.5), '#808080');
        assert.equal(lighten('#ffffff', 0.5), '#ffffff');
    });

    it('leaves an unparseable value alone', () => {
        assert.equal(lighten('inherit', 0.5), 'inherit');
    });
});

describe('isDarkBackground', () => {
    it('judges by perceived luminance', () => {
        assert.equal(isDarkBackground('#1e1e2e'), true);
        assert.equal(isDarkBackground('#eff1f5'), false);
    });

    it('treats an unknown background as dark', () => {
        assert.equal(isDarkBackground(undefined), true);
        assert.equal(isDarkBackground('transparent'), true);
    });
});

describe('buildTheme', () => {
    it('falls back to Catppuccin Mocha with no config and no vault theme', () => {
        const theme = buildTheme(emptyGhosttyConfig(), NO_VARS);
        assert.equal(theme.background, DARK_FALLBACK.background);
        assert.equal(theme.red, DARK_FALLBACK.red);
    });

    it('uses the light fallback when the vault background is light', () => {
        const theme = buildTheme(emptyGhosttyConfig(), lookupOf({
            '--background-primary': '#ffffff',
        }));

        // The ANSI palette has to follow the background it is drawn on.
        assert.equal(theme.black, LIGHT_FALLBACK.black);
        assert.equal(theme.white, LIGHT_FALLBACK.white);
    });

    it('borrows the vault accent colors', () => {
        const theme = buildTheme(emptyGhosttyConfig(), lookupOf({
            '--background-primary': '#1e1e2e',
            '--color-red': 'rgb(255, 0, 0)',
            '--color-purple': '#8800cc',
        }));

        assert.equal(theme.red, 'rgb(255, 0, 0)');
        assert.equal(theme.magenta, '#8800cc');
    });

    it('derives bright colors from the accent they brighten', () => {
        const theme = buildTheme(emptyGhosttyConfig(), lookupOf({
            '--color-red': '#000000',
        }));

        assert.equal(theme.brightRed, lighten('#000000', 0.12));
    });

    it('keeps the fallback bright when the normal color also fell back', () => {
        const theme = buildTheme(emptyGhosttyConfig(), NO_VARS);
        assert.equal(theme.brightRed, DARK_FALLBACK.brightRed);
    });

    it('lets the Ghostty config win over the vault theme', () => {
        const config: GhosttyConfig = {
            ...emptyGhosttyConfig(),
            colors: { red: '#123456', brightRed: '#654321' },
        };
        const theme = buildTheme(config, lookupOf({ '--color-red': '#ff0000' }));

        assert.equal(theme.red, '#123456');
        // An explicit bright is never overwritten by a derived one.
        assert.equal(theme.brightRed, '#654321');
    });

    it('never maps black or white to Obsidian, whose base scale inverts', () => {
        const dark = buildTheme(emptyGhosttyConfig(), lookupOf({
            '--background-primary': '#000000',
            '--color-base-30': '#ffffff',
        }));
        assert.equal(dark.black, DARK_FALLBACK.black);
    });
});
