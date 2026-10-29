import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
    boxShapes,
    installBoxDrawing,
    lightThickness,
    type RectShape,
    type Shape,
} from '../src/box-drawing';

/** A cell the size ghostty-web measures for Menlo at 13px. */
const W = 9;
const H = 19;

function rects(shapes: Shape[] | null): RectShape[] {
    assert.ok(shapes, 'expected shapes');
    return shapes.filter((s): s is RectShape => s.kind === 'rect');
}

/** Pixels in the cell covered by any of the shapes. */
function covered(shapes: Shape[] | null): Set<string> {
    const px = new Set<string>();
    for (const r of rects(shapes)) {
        for (let x = r.x; x < r.x + r.w; x++) {
            for (let y = r.y; y < r.y + r.h; y++) px.add(`${x},${y}`);
        }
    }
    return px;
}

describe('boxShapes', () => {
    it('leaves ordinary characters to the font', () => {
        assert.equal(boxShapes('a'.codePointAt(0)!, W, H), null);
        assert.equal(boxShapes(0x2504, W, H), null, 'dashed lines are not drawn');
        assert.equal(boxShapes(0x2550, W, H), null, 'double lines are not drawn');
    });

    it('runs a horizontal line edge to edge, so neighbours join', () => {
        const all = rects(boxShapes(0x2500, W, H));
        assert.equal(Math.min(...all.map(r => r.x)), 0);
        assert.equal(Math.max(...all.map(r => r.x + r.w)), W);
        assert.equal(covered(boxShapes(0x2500, W, H)).size, W * lightThickness(W));
    });

    it('runs a vertical line top to bottom, so rows join', () => {
        const all = rects(boxShapes(0x2502, W, H));
        assert.equal(Math.min(...all.map(r => r.y)), 0);
        assert.equal(Math.max(...all.map(r => r.y + r.h)), H);
        assert.equal(covered(boxShapes(0x2502, W, H)).size, H * lightThickness(W));
    });

    it('puts a horizontal line on the same row in every character that has one', () => {
        const row = (cp: number) => rects(boxShapes(cp, W, H))
            .filter(r => r.h === lightThickness(W) && r.w < H)
            .map(r => r.y);
        const y = row(0x2500)[0];
        for (const cp of [0x250c, 0x2510, 0x251c, 0x2524, 0x252c, 0x2534, 0x253c, 0x2574]) {
            assert.ok(y !== undefined && row(cp).includes(y), `U+${cp.toString(16)}`);
        }
    });

    it('closes a corner with no hole where the arms meet', () => {
        const px = covered(boxShapes(0x250c, W, H)); // ┌
        const t = lightThickness(W);
        const x = Math.round((W - t) / 2);
        const y = Math.round((H - t) / 2);
        assert.ok(px.has(`${x},${y}`));
        assert.ok(px.has(`${W - 1},${y}`));
        assert.ok(px.has(`${x},${H - 1}`));
        assert.ok(!px.has(`0,${y}`), 'nothing to the left');
        assert.ok(!px.has(`${x},0`), 'nothing above');
    });

    it('draws heavy arms at twice the light thickness', () => {
        const heavy = rects(boxShapes(0x2501, W, H));
        assert.ok(heavy.every(r => r.h === 2 * lightThickness(W)));
    });

    it('draws rounded corners as an arc between edge midpoints', () => {
        const shapes = boxShapes(0x256d, W, H); // ╭
        assert.equal(shapes?.length, 1);
        const arc = shapes?.[0];
        assert.ok(arc?.kind === 'arc');
        assert.equal(arc.start[1], H);
        assert.equal(arc.end[0], W);
        assert.equal(arc.corner[0], arc.start[0]);
        assert.equal(arc.corner[1], arc.end[1]);
    });

    it('fills blocks to the cell edges', () => {
        assert.equal(covered(boxShapes(0x2588, W, H)).size, W * H); // █
        const upper = covered(boxShapes(0x2580, W, H)); // ▀
        const lower = covered(boxShapes(0x2584, W, H)); // ▄
        assert.equal(upper.size + lower.size, W * H);
        for (const p of upper) assert.ok(!lower.has(p));
        const left = covered(boxShapes(0x258c, W, H)); // ▌
        const right = covered(boxShapes(0x2590, W, H)); // ▐
        assert.equal(left.size + right.size, W * H);
    });

    it('tiles quadrants without overlap', () => {
        const full = covered(boxShapes(0x2599, W, H)); // ▙
        const missing = covered(boxShapes(0x259d, W, H)); // ▝
        assert.equal(full.size + missing.size, W * H);
    });

    it('draws shades as a translucent full block', () => {
        const [shade] = rects(boxShapes(0x2592, W, H)); // ▒
        assert.equal(shade?.alpha, 0.5);
        assert.equal(shade?.w, W);
        assert.equal(shade?.h, H);
    });
});

describe('installBoxDrawing', () => {
    function fakeRenderer() {
        const calls: string[] = [];
        const passed: number[] = [];
        const ctx = {
            fillStyle: '#fff', strokeStyle: '', lineWidth: 1, globalAlpha: 1,
            fillRect: (x: number, y: number, w: number, h: number) => calls.push(`rect ${x},${y},${w},${h}`),
            beginPath: () => calls.push('begin'),
            moveTo: () => calls.push('move'),
            arcTo: () => calls.push('arc'),
            lineTo: () => calls.push('line'),
            stroke: () => calls.push('stroke'),
        };
        const renderer = {
            ctx,
            metrics: { width: W, height: H },
            renderCellText(cell: { codepoint: number }, ..._at: number[]) { passed.push(cell.codepoint); },
        };
        return { renderer, calls, passed };
    }

    const cell = (codepoint: number, flags = 0) =>
        ({ codepoint, flags, width: 1, grapheme_len: 0 });

    it('passes ordinary cells straight through', () => {
        const { renderer, calls, passed } = fakeRenderer();
        installBoxDrawing(renderer);
        renderer.renderCellText(cell(0x41), 0, 0);
        assert.deepEqual(passed, [0x41]);
        assert.deepEqual(calls, []);
    });

    it('runs the original with a space, then draws the shape in the cell', () => {
        const { renderer, calls, passed } = fakeRenderer();
        installBoxDrawing(renderer);
        renderer.renderCellText(cell(0x2588), 2, 1);
        assert.deepEqual(passed, [0x20]);
        assert.deepEqual(calls, [`rect ${2 * W},${H},${W},${H}`]);
    });

    it('draws nothing for an invisible cell', () => {
        const { renderer, calls } = fakeRenderer();
        installBoxDrawing(renderer);
        renderer.renderCellText(cell(0x2500, 32), 0, 0);
        assert.deepEqual(calls, []);
    });

    it('leaves a renderer it does not recognise alone', () => {
        assert.doesNotThrow(() => installBoxDrawing({}));
    });
});
