/**
 * Mouse-wheel → terminal mouse-report encoding.
 *
 * ghostty-web handles the wheel in two branches: on the normal screen it
 * scrolls its own scrollback, and on the alternate screen it translates the
 * wheel into Up/Down arrow keystrokes. The arrow fallback is right for pagers
 * (less, man), but wrong for any TUI that enables mouse reporting and scrolls
 * its own viewport — those apps never see the wheel events they wait on, and
 * read the arrows they get instead as navigation.
 *
 * This module encodes the wheel as a real mouse-button report so those apps
 * get what they asked for. Deliberately pure and DOM-free so it can be tested
 * without a browser.
 */

/** Buttons 64/65 are wheel up/down by the xterm convention. */
export const WHEEL_BUTTON_UP = 64;
export const WHEEL_BUTTON_DOWN = 65;

/** Modifier bits folded into the button value, also per xterm. */
const MOD_SHIFT = 4;
const MOD_ALT = 8;
const MOD_CTRL = 16;

/** A flick of the wheel must not flood the PTY. */
export const WHEEL_MAX_NOTCHES = 5;

/** Legacy X10 encodes coordinates as single bytes offset by 32. */
const X10_OFFSET = 32;
const X10_MAX_COORD = 223;

/** WheelEvent.deltaMode values, restated so this module needs no DOM lib. */
export const DELTA_PIXEL = 0;
export const DELTA_LINE = 1;
export const DELTA_PAGE = 2;

/** The parts of a WheelEvent this encoder needs. */
export interface WheelInput {
    deltaY: number;
    deltaMode: number;
    /** Pointer position relative to the terminal element, in pixels. */
    offsetX: number;
    offsetY: number;
    shiftKey: boolean;
    altKey: boolean;
    ctrlKey: boolean;
}

/** Terminal grid geometry, in cells and pixels-per-cell. */
export interface WheelGeometry {
    cols: number;
    rows: number;
    cellWidth: number;
    cellHeight: number;
}

/** Clamps a 1-based cell coordinate to the grid. */
export function clampCell(value: number, max: number): number {
    return Math.min(Math.max(1, value), Math.max(1, max));
}

/**
 * Converts a wheel delta to a number of scroll notches, sign preserved.
 * Negative is up. Returns 0 when there is nothing to report.
 */
export function wheelNotches(input: WheelInput, geom: WheelGeometry): number {
    let lines: number;
    if (input.deltaMode === DELTA_LINE) {
        lines = input.deltaY;
    } else if (input.deltaMode === DELTA_PAGE) {
        lines = input.deltaY * geom.rows;
    } else {
        lines = input.deltaY / Math.max(1, geom.cellHeight);
    }
    if (lines === 0) return 0;

    const magnitude = Math.min(Math.max(1, Math.round(Math.abs(lines))), WHEEL_MAX_NOTCHES);
    return lines < 0 ? -magnitude : magnitude;
}

/**
 * Encodes a wheel event as one or more mouse-button reports.
 *
 * Emits SGR (DEC mode 1006) when the application has negotiated it, and falls
 * back to legacy X10 otherwise. Returns an empty string when there is nothing
 * to send — including the X10 case where the pointer sits outside the range a
 * single byte can address.
 */
export function encodeWheelReport(input: WheelInput, geom: WheelGeometry, sgr: boolean): string {
    const notches = wheelNotches(input, geom);
    if (notches === 0) return '';

    let button = notches < 0 ? WHEEL_BUTTON_UP : WHEEL_BUTTON_DOWN;
    if (input.shiftKey) button += MOD_SHIFT;
    if (input.altKey) button += MOD_ALT;
    if (input.ctrlKey) button += MOD_CTRL;

    const col = clampCell(Math.floor(input.offsetX / Math.max(1, geom.cellWidth)) + 1, geom.cols);
    const row = clampCell(Math.floor(input.offsetY / Math.max(1, geom.cellHeight)) + 1, geom.rows);

    if (!sgr && (col > X10_MAX_COORD || row > X10_MAX_COORD)) return '';

    const report = sgr
        ? `\x1b[<${button};${col};${row}M`
        : `\x1b[M${String.fromCharCode(X10_OFFSET + button, X10_OFFSET + col, X10_OFFSET + row)}`;

    return report.repeat(Math.abs(notches));
}
