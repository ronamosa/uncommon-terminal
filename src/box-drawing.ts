/**
 * Box-drawing and block characters, drawn as geometry instead of glyphs.
 *
 * ghostty-web draws every cell with `fillText`, but the cell it draws into is
 * `Math.ceil` of the font's advance width, and its height is the glyph's ink
 * box plus padding. A `─` from the font is a fraction of a pixel too short for
 * its cell, so a rule drawn from a run of them breaks at every cell boundary,
 * and `│` breaks between rows the same way. Native Ghostty never shows this
 * because it draws these characters itself, sized to the cell; this module
 * does the same.
 *
 * The geometry is pure and DOM-free so it can be tested without a canvas.
 * `installBoxDrawing` is the one part that touches the renderer, and it
 * reaches into ghostty-web internals that are not part of its public API —
 * pinned to the version in package.json.
 *
 * Covered: light and heavy lines, junctions, half lines, rounded corners, and
 * the block elements. Dashed and double lines still come from the font.
 */

/** A filled rectangle, in CSS pixels from the cell's top-left corner. */
export interface RectShape {
    kind: 'rect';
    x: number;
    y: number;
    w: number;
    h: number;
    /** Shade characters are a block at partial opacity. */
    alpha?: number;
}

/**
 * A rounded corner: a stroke from `start` to `end`, turning through `corner`
 * with radius `r`.
 */
export interface ArcShape {
    kind: 'arc';
    start: [number, number];
    corner: [number, number];
    end: [number, number];
    r: number;
    thickness: number;
}

export type Shape = RectShape | ArcShape;

/**
 * Arm weights for each line character, in the order up, right, down, left:
 * 0 none, 1 light, 2 heavy. Generated from the Unicode character names.
 */
const LINES: Record<number, string> = {
    0x2500: '0101', // ─ light horizontal
    0x2501: '0202', // ━ heavy horizontal
    0x2502: '1010', // │ light vertical
    0x2503: '2020', // ┃ heavy vertical
    0x250c: '0110', // ┌ light down and right
    0x250d: '0210', // ┍ down light and right heavy
    0x250e: '0120', // ┎ down heavy and right light
    0x250f: '0220', // ┏ heavy down and right
    0x2510: '0011', // ┐ light down and left
    0x2511: '0012', // ┑ down light and left heavy
    0x2512: '0021', // ┒ down heavy and left light
    0x2513: '0022', // ┓ heavy down and left
    0x2514: '1100', // └ light up and right
    0x2515: '1200', // ┕ up light and right heavy
    0x2516: '2100', // ┖ up heavy and right light
    0x2517: '2200', // ┗ heavy up and right
    0x2518: '1001', // ┘ light up and left
    0x2519: '1002', // ┙ up light and left heavy
    0x251a: '2001', // ┚ up heavy and left light
    0x251b: '2002', // ┛ heavy up and left
    0x251c: '1110', // ├ light vertical and right
    0x251d: '1210', // ┝ vertical light and right heavy
    0x251e: '2110', // ┞ up heavy and right down light
    0x251f: '1120', // ┟ down heavy and right up light
    0x2520: '2120', // ┠ vertical heavy and right light
    0x2521: '2210', // ┡ down light and right up heavy
    0x2522: '1220', // ┢ up light and right down heavy
    0x2523: '2220', // ┣ heavy vertical and right
    0x2524: '1011', // ┤ light vertical and left
    0x2525: '1012', // ┥ vertical light and left heavy
    0x2526: '2011', // ┦ up heavy and left down light
    0x2527: '1021', // ┧ down heavy and left up light
    0x2528: '2021', // ┨ vertical heavy and left light
    0x2529: '2012', // ┩ down light and left up heavy
    0x252a: '1022', // ┪ up light and left down heavy
    0x252b: '2022', // ┫ heavy vertical and left
    0x252c: '0111', // ┬ light down and horizontal
    0x252d: '0112', // ┭ left heavy and right down light
    0x252e: '0211', // ┮ right heavy and left down light
    0x252f: '0212', // ┯ down light and horizontal heavy
    0x2530: '0121', // ┰ down heavy and horizontal light
    0x2531: '0122', // ┱ right light and left down heavy
    0x2532: '0221', // ┲ left light and right down heavy
    0x2533: '0222', // ┳ heavy down and horizontal
    0x2534: '1101', // ┴ light up and horizontal
    0x2535: '1102', // ┵ left heavy and right up light
    0x2536: '1201', // ┶ right heavy and left up light
    0x2537: '1202', // ┷ up light and horizontal heavy
    0x2538: '2101', // ┸ up heavy and horizontal light
    0x2539: '2102', // ┹ right light and left up heavy
    0x253a: '2201', // ┺ left light and right up heavy
    0x253b: '2202', // ┻ heavy up and horizontal
    0x253c: '1111', // ┼ light vertical and horizontal
    0x253d: '1112', // ┽ left heavy and right vertical light
    0x253e: '1211', // ┾ right heavy and left vertical light
    0x253f: '1212', // ┿ vertical light and horizontal heavy
    0x2540: '2111', // ╀ up heavy and down horizontal light
    0x2541: '1121', // ╁ down heavy and up horizontal light
    0x2542: '2121', // ╂ vertical heavy and horizontal light
    0x2543: '2112', // ╃ left up heavy and right down light
    0x2544: '2211', // ╄ right up heavy and left down light
    0x2545: '1122', // ╅ left down heavy and right up light
    0x2546: '1221', // ╆ right down heavy and left up light
    0x2547: '2212', // ╇ down light and up horizontal heavy
    0x2548: '1222', // ╈ up light and down horizontal heavy
    0x2549: '2122', // ╉ right light and left vertical heavy
    0x254a: '2221', // ╊ left light and right vertical heavy
    0x254b: '2222', // ╋ heavy vertical and horizontal
    0x2574: '0001', // ╴ light left
    0x2575: '1000', // ╵ light up
    0x2576: '0100', // ╶ light right
    0x2577: '0010', // ╷ light down
    0x2578: '0002', // ╸ heavy left
    0x2579: '2000', // ╹ heavy up
    0x257a: '0200', // ╺ heavy right
    0x257b: '0020', // ╻ heavy down
    0x257c: '0201', // ╼ light left and heavy right
    0x257d: '1020', // ╽ light up and heavy down
    0x257e: '0102', // ╾ heavy left and light right
    0x257f: '2010', // ╿ heavy up and light down
};

/** Rounded corners ╭ ╮ ╯ ╰, as the two arms each one joins. */
const ARCS: Record<number, ['up' | 'down', 'left' | 'right']> = {
    0x256d: ['down', 'right'],
    0x256e: ['down', 'left'],
    0x256f: ['up', 'left'],
    0x2570: ['up', 'right'],
};

/** Quadrant blocks ▖ to ▟, as bits: 1 upper left, 2 upper right, 4 lower left, 8 lower right. */
const QUADRANTS: Record<number, number> = {
    0x2596: 4, 0x2597: 8, 0x2598: 1, 0x2599: 1 | 4 | 8, 0x259a: 1 | 8,
    0x259b: 1 | 2 | 4, 0x259c: 1 | 2 | 8, 0x259d: 2, 0x259e: 2 | 4, 0x259f: 2 | 4 | 8,
};

/** Light line thickness for a cell of this width; heavy is double. */
export function lightThickness(cellWidth: number): number {
    return Math.max(1, Math.round(cellWidth / 8));
}

/**
 * The shapes that draw `codepoint` into a `w` × `h` cell, or null when it is
 * not a character this module draws — the font's glyph is used instead.
 */
export function boxShapes(codepoint: number, w: number, h: number): Shape[] | null {
    const arms = LINES[codepoint];
    if (arms) return lineShapes(arms, w, h);
    const arc = ARCS[codepoint];
    if (arc) return [arcShape(arc[0], arc[1], w, h)];
    return blockShapes(codepoint, w, h);
}

function lineShapes(arms: string, w: number, h: number): Shape[] {
    const [up, right, down, left] = [...arms].map(Number) as [number, number, number, number];
    const light = lightThickness(w);
    const thickness = (weight: number) => weight * light;

    // The band each axis occupies at the centre, so arms crossing it overlap
    // the whole band rather than stopping at its middle.
    const vt = thickness(Math.max(up, down));
    const ht = thickness(Math.max(left, right));
    const vx = Math.round((w - vt) / 2);
    const hy = Math.round((h - ht) / 2);
    const hStart = vt ? vx : Math.floor(w / 2);
    const hEnd = vt ? vx + vt : Math.ceil(w / 2);
    const vStart = ht ? hy : Math.floor(h / 2);
    const vEnd = ht ? hy + ht : Math.ceil(h / 2);

    const shapes: Shape[] = [];
    const horizontal = (x0: number, x1: number, weight: number) => {
        const t = thickness(weight);
        shapes.push({ kind: 'rect', x: x0, y: Math.round((h - t) / 2), w: x1 - x0, h: t });
    };
    const vertical = (y0: number, y1: number, weight: number) => {
        const t = thickness(weight);
        shapes.push({ kind: 'rect', x: Math.round((w - t) / 2), y: y0, w: t, h: y1 - y0 });
    };
    if (left) horizontal(0, hEnd, left);
    if (right) horizontal(hStart, w, right);
    if (up) vertical(0, vEnd, up);
    if (down) vertical(vStart, h, down);
    return shapes;
}

function arcShape(vertical: 'up' | 'down', horizontal: 'left' | 'right', w: number, h: number): ArcShape {
    const t = lightThickness(w);
    // Centre the stroke on the same lines a `│` and a `─` occupy, so the
    // corner meets its neighbours exactly.
    const cx = Math.round((w - t) / 2) + t / 2;
    const cy = Math.round((h - t) / 2) + t / 2;
    return {
        kind: 'arc',
        start: [cx, vertical === 'up' ? 0 : h],
        corner: [cx, cy],
        end: [horizontal === 'left' ? 0 : w, cy],
        r: Math.min(w, h) / 2,
        thickness: t,
    };
}

function blockShapes(cp: number, w: number, h: number): Shape[] | null {
    const rect = (x: number, y: number, rw: number, rh: number, alpha?: number): RectShape =>
        alpha === undefined ? { kind: 'rect', x, y, w: rw, h: rh } : { kind: 'rect', x, y, w: rw, h: rh, alpha };
    const eighthsDown = (n: number) => Math.round((h * n) / 8);
    const eighthsAcross = (n: number) => Math.round((w * n) / 8);

    if (cp === 0x2580) return [rect(0, 0, w, eighthsDown(4))]; // ▀
    if (cp >= 0x2581 && cp <= 0x2588) {
        // ▁ to █: lower one eighth up to the full block.
        const top = eighthsDown(8 - (cp - 0x2580));
        return [rect(0, top, w, h - top)];
    }
    if (cp >= 0x2589 && cp <= 0x258f) return [rect(0, 0, eighthsAcross(8 - (cp - 0x2588)), h)]; // ▉ to ▏
    if (cp === 0x2590) { const x = eighthsAcross(4); return [rect(x, 0, w - x, h)]; } // ▐
    if (cp >= 0x2591 && cp <= 0x2593) return [rect(0, 0, w, h, (cp - 0x2590) / 4)]; // ░ ▒ ▓
    if (cp === 0x2594) return [rect(0, 0, w, eighthsDown(1))]; // ▔
    if (cp === 0x2595) { const x = eighthsAcross(7); return [rect(x, 0, w - x, h)]; } // ▕

    const quadrants = QUADRANTS[cp];
    if (quadrants === undefined) return null;
    const mx = eighthsAcross(4);
    const my = eighthsDown(4);
    const shapes: Shape[] = [];
    if (quadrants & 1) shapes.push(rect(0, 0, mx, my));
    if (quadrants & 2) shapes.push(rect(mx, 0, w - mx, my));
    if (quadrants & 4) shapes.push(rect(0, my, mx, h - my));
    if (quadrants & 8) shapes.push(rect(mx, my, w - mx, h - my));
    return shapes;
}

/** The canvas calls `drawShapes` makes, so tests can pass a recorder. */
export type ShapeContext = Pick<CanvasRenderingContext2D,
    'fillRect' | 'beginPath' | 'moveTo' | 'arcTo' | 'lineTo' | 'stroke'
    | 'fillStyle' | 'strokeStyle' | 'lineWidth' | 'globalAlpha'>;

/** Draws shapes at a cell's top-left corner in the context's current fill color. */
export function drawShapes(ctx: ShapeContext, shapes: Shape[], x: number, y: number): void {
    const baseAlpha = ctx.globalAlpha;
    for (const s of shapes) {
        if (s.kind === 'rect') {
            if (s.alpha !== undefined) ctx.globalAlpha = baseAlpha * s.alpha;
            ctx.fillRect(x + s.x, y + s.y, s.w, s.h);
            ctx.globalAlpha = baseAlpha;
        } else {
            ctx.strokeStyle = ctx.fillStyle;
            ctx.lineWidth = s.thickness;
            ctx.beginPath();
            ctx.moveTo(x + s.start[0], y + s.start[1]);
            ctx.arcTo(x + s.corner[0], y + s.corner[1], x + s.end[0], y + s.end[1], s.r);
            ctx.lineTo(x + s.end[0], y + s.end[1]);
            ctx.stroke();
        }
    }
}

// ── Renderer hook ────────────────────────────────────────────────────────────

/** ghostty-web's CellFlags, restated so this module needs nothing from it at runtime. */
const FLAG_INVISIBLE = 32;
const FLAG_FAINT = 128;

/** The fields of ghostty-web's GhosttyCell the hook reads. */
interface Cell {
    codepoint: number;
    flags: number;
    width: number;
    grapheme_len: number;
}

/** The private CanvasRenderer members the hook relies on. */
interface RendererInternals {
    ctx: ShapeContext;
    metrics: { width: number; height: number };
    renderCellText(cell: Cell, col: number, row: number): void;
}

/**
 * Wraps the renderer's per-cell text pass. For a character this module draws,
 * the original still runs — with a space in place of the glyph — so it sets
 * the fill color (selection, inverse, true color) and draws underline and
 * strikethrough exactly as before; the shapes then go on top in that color.
 * Every other cell is passed through untouched.
 */
export function installBoxDrawing(renderer: object): void {
    const r = renderer as RendererInternals;
    if (typeof r.renderCellText !== 'function' || !r.metrics || !r.ctx) return;

    const original = r.renderCellText.bind(r);
    r.renderCellText = (cell, col, row) => {
        const shapes = cell.grapheme_len === 0
            ? boxShapes(cell.codepoint, r.metrics.width, r.metrics.height)
            : null;
        if (!shapes) return original(cell, col, row);

        original({ ...cell, codepoint: 0x20 }, col, row);
        if (cell.flags & FLAG_INVISIBLE) return;

        const faint = (cell.flags & FLAG_FAINT) !== 0;
        if (faint) r.ctx.globalAlpha = 0.5;
        drawShapes(r.ctx, shapes, col * r.metrics.width, row * r.metrics.height);
        if (faint) r.ctx.globalAlpha = 1;
    };
}
