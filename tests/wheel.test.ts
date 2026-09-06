import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
    DELTA_LINE,
    DELTA_PAGE,
    DELTA_PIXEL,
    WHEEL_MAX_NOTCHES,
    clampCell,
    encodeWheelReport,
    wheelNotches,
    type WheelGeometry,
    type WheelInput,
} from '../src/wheel';

const GRID: WheelGeometry = { cols: 80, rows: 24, cellWidth: 10, cellHeight: 20 };

function wheel(overrides: Partial<WheelInput> = {}): WheelInput {
    return {
        deltaY: 0,
        deltaMode: DELTA_PIXEL,
        offsetX: 0,
        offsetY: 0,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        ...overrides,
    };
}

describe('clampCell', () => {
    it('keeps coordinates inside the grid, 1-based', () => {
        assert.equal(clampCell(0, 80), 1);
        assert.equal(clampCell(-5, 80), 1);
        assert.equal(clampCell(40, 80), 40);
        assert.equal(clampCell(999, 80), 80);
    });

    it('never returns 0 for a degenerate grid', () => {
        assert.equal(clampCell(5, 0), 1);
    });
});

describe('wheelNotches', () => {
    it('converts pixel deltas using the cell height', () => {
        assert.equal(wheelNotches(wheel({ deltaY: 60 }), GRID), 3);
        assert.equal(wheelNotches(wheel({ deltaY: -60 }), GRID), -3);
    });

    it('takes line deltas at face value', () => {
        assert.equal(wheelNotches(wheel({ deltaY: 2, deltaMode: DELTA_LINE }), GRID), 2);
    });

    it('scales page deltas by the visible rows', () => {
        assert.equal(
            wheelNotches(wheel({ deltaY: 1, deltaMode: DELTA_PAGE }), GRID),
            WHEEL_MAX_NOTCHES,
        );
    });

    it('reports nothing for a zero delta', () => {
        assert.equal(wheelNotches(wheel({ deltaY: 0 }), GRID), 0);
    });

    it('rounds a sub-cell delta up to one notch rather than dropping it', () => {
        assert.equal(wheelNotches(wheel({ deltaY: 3 }), GRID), 1);
        assert.equal(wheelNotches(wheel({ deltaY: -3 }), GRID), -1);
    });

    it('clamps a flick so a fast wheel cannot flood the pty', () => {
        assert.equal(wheelNotches(wheel({ deltaY: 10000 }), GRID), WHEEL_MAX_NOTCHES);
    });
});

describe('encodeWheelReport', () => {
    it('emits an SGR report per notch when mode 1006 is negotiated', () => {
        const report = encodeWheelReport(wheel({ deltaY: -40 }), GRID, true);
        assert.equal(report, '\x1b[<64;1;1M\x1b[<64;1;1M');
    });

    it('uses button 65 for scrolling down', () => {
        const report = encodeWheelReport(wheel({ deltaY: 20 }), GRID, true);
        assert.equal(report, '\x1b[<65;1;1M');
    });

    it('folds modifiers into the button value', () => {
        const shift = encodeWheelReport(wheel({ deltaY: 20, shiftKey: true }), GRID, true);
        const alt = encodeWheelReport(wheel({ deltaY: 20, altKey: true }), GRID, true);
        const ctrl = encodeWheelReport(wheel({ deltaY: 20, ctrlKey: true }), GRID, true);
        const all = encodeWheelReport(
            wheel({ deltaY: 20, shiftKey: true, altKey: true, ctrlKey: true }), GRID, true);

        assert.equal(shift, '\x1b[<69;1;1M');
        assert.equal(alt, '\x1b[<73;1;1M');
        assert.equal(ctrl, '\x1b[<81;1;1M');
        assert.equal(all, '\x1b[<93;1;1M');
    });

    it('reports the cell under the pointer', () => {
        const report = encodeWheelReport(
            wheel({ deltaY: 20, offsetX: 105, offsetY: 45 }), GRID, true);
        assert.equal(report, '\x1b[<65;11;3M');
    });

    it('clamps a pointer past the edge of the grid', () => {
        const report = encodeWheelReport(
            wheel({ deltaY: 20, offsetX: 99999, offsetY: 99999 }), GRID, true);
        assert.equal(report, '\x1b[<65;80;24M');
    });

    it('falls back to X10 byte encoding without mode 1006', () => {
        const report = encodeWheelReport(wheel({ deltaY: 20 }), GRID, false);
        assert.equal(report, '\x1b[M' + String.fromCharCode(97, 33, 33));
    });

    it('sends nothing over X10 when the pointer is past the single-byte range', () => {
        const wide: WheelGeometry = { ...GRID, cols: 300, rows: 300 };
        const report = encodeWheelReport(
            wheel({ deltaY: 20, offsetX: 2400, offsetY: 5000 }), wide, false);
        assert.equal(report, '');
    });

    it('sends nothing for a zero delta', () => {
        assert.equal(encodeWheelReport(wheel({ deltaY: 0 }), GRID, true), '');
    });
});
