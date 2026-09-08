/**
 * PTY session management.
 *
 * The shell runs behind a small Python stdlib `pty` proxy rather than
 * `node-pty`. That is deliberate: node-pty is a native addon, which means
 * rebuilding it against whichever Electron version Obsidian ships this month.
 * Python 3 is already present on every macOS and essentially every Linux box,
 * and `pty` is in its standard library.
 *
 * Protocol, mirrored in pty_helper.py:
 *   argv[1] is the shell, stdin/stdout carry raw bytes, and fd 3 is a resize
 *   control pipe taking 4-byte big-endian frames (rows uint16, cols uint16).
 */

import * as child_process from 'child_process';
import type { Writable } from 'stream';

/** Interpreters to try, in order, when the user has not named one. */
const PYTHON_CANDIDATES = ['python3', 'python'];

/** The helper needs these; a Python without them is no use to us. */
const PYTHON_PROBE = ['-c', 'import pty, termios, fcntl, selectors'];

let cachedPython: string | null | undefined;

/**
 * Finds a usable Python 3, preferring an explicit setting. Probing rather than
 * assuming means a missing interpreter surfaces as a clear message instead of
 * an opaque spawn failure. The result is cached for the session.
 */
export function resolvePython(override?: string): string | null {
    if (override) {
        return probePython(override) ? override : null;
    }
    if (cachedPython !== undefined) return cachedPython;

    cachedPython = PYTHON_CANDIDATES.find(probePython) ?? null;
    return cachedPython;
}

/** Clears the cached interpreter, so a settings change is picked up. */
export function forgetPython(): void {
    cachedPython = undefined;
}

function probePython(command: string): boolean {
    try {
        const result = child_process.spawnSync(command, PYTHON_PROBE, {
            timeout: 5000,
            stdio: 'ignore',
        });
        return result.status === 0;
    } catch {
        return false;
    }
}

export interface PtyOptions {
    /** Absolute path to the shell binary. */
    shell: string;
    /** Absolute path to the working directory. */
    cwd: string;
    /** Absolute path to pty_helper.py. */
    helperPath: string;
    /** Python interpreter to run the helper with. */
    python: string;
    cols: number;
    rows: number;
}

export interface PtyHandlers {
    onData: (chunk: Uint8Array) => void;
    onExit: (code: number | null) => void;
    onError: (error: Error) => void;
}

/** Delay before escalating SIGTERM to SIGKILL. */
const KILL_GRACE_MS = 500;

/**
 * One shell process behind a PTY. Owns its stdio, its resize pipe, and its
 * teardown; a view holds one of these and nothing else about the process.
 */
export class PtySession {
    private process: child_process.ChildProcess | null = null;
    private resizePipe: Writable | null = null;
    private running = false;
    /** Set once kill() runs, so a deliberate teardown reports nothing. */
    private stopped = false;

    constructor(private readonly options: PtyOptions, private readonly handlers: PtyHandlers) {}

    get alive(): boolean {
        return this.running;
    }

    /** Spawns the shell. Throws if the spawn itself fails synchronously. */
    start(): void {
        const { python, helperPath, shell, cwd, cols, rows } = this.options;

        const proc = child_process.spawn(python, [helperPath, shell], {
            cwd,
            env: {
                ...process.env,
                TERM: 'xterm-256color',
                TERM_PROGRAM: 'uncommon-terminal',
                COLORTERM: 'truecolor',
                COLUMNS: String(cols),
                LINES: String(rows),
            },
            // stdio[3] is the resize control pipe, write-only from this side.
            stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
        });

        this.process = proc;
        this.resizePipe = (proc.stdio as unknown as Writable[])[3] ?? null;
        this.running = true;

        // No encoding is set: raw Buffers keep multi-byte UTF-8 sequences
        // intact for the VT parser to decode.
        proc.stdout?.on('data', (data: Buffer) => {
            if (this.stopped) return;
            this.handlers.onData(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        });

        proc.on('close', (code: number | null) => {
            this.running = false;
            // A close we asked for is not news: it is a restart or a closing
            // pane, and the caller already knows.
            if (!this.stopped) this.handlers.onExit(code);
        });

        proc.on('error', (error: Error) => {
            this.running = false;
            if (!this.stopped) this.handlers.onError(error);
        });
    }

    /** Sends input to the shell. No-op once the process is gone. */
    write(data: string): void {
        if (!this.running) return;
        this.process?.stdin?.write(data, 'utf8');
    }

    /** Sends a resize frame over fd 3 for the helper to hand to TIOCSWINSZ. */
    resize(rows: number, cols: number): void {
        if (!this.running || !this.resizePipe) return;
        const frame = Buffer.alloc(4);
        frame.writeUInt16BE(rows, 0);
        frame.writeUInt16BE(cols, 2);
        this.resizePipe.write(frame);
    }

    /**
     * Tears the process down. Closing the pipes first gives the helper its
     * stdin EOF, which it treats as "the parent is gone" — so the shell dies
     * even in the case where SIGTERM never lands.
     */
    kill(): void {
        const proc = this.process;
        this.stopped = true;
        this.process = null;
        this.resizePipe = null;
        this.running = false;
        if (!proc) return;

        for (const stream of [proc.stdin, proc.stdout, proc.stderr, ...(proc.stdio ?? [])]) {
            try { (stream as { destroy?: () => void } | null)?.destroy?.(); } catch { /* already closed */ }
        }

        try { proc.kill('SIGTERM'); } catch { /* already dead */ }

        const pid = proc.pid;
        if (pid === undefined) return;
        window.setTimeout(() => {
            try {
                process.kill(pid, 0); // throws if it already exited
                process.kill(pid, 'SIGKILL');
            } catch { /* already dead */ }
        }, KILL_GRACE_MS);
    }
}
