"""Unix PTY proxy for the Obsidian Ghostty Terminal plugin.

Protocol:
  - argv[1]:  shell binary path
  - argv[2+]: shell arguments
  - stdin  → shell stdin  (raw bytes)
  - stdout ← shell stdout (raw bytes)
  - fd 3   ← resize control frames: 4 bytes big-endian (rows uint16, cols uint16)
"""

from __future__ import annotations

import os
import signal
import sys
import threading
from selectors import EVENT_READ, DefaultSelector
from struct import unpack
from typing import Optional

_CHUNK = 4096
_CMDIO = 3  # resize pipe fd


def _write_all(fd: int, data: bytes) -> None:
    while data:
        data = data[os.write(fd, data):]


def main() -> None:
    if sys.platform == "win32":
        _main_win32()
    else:
        _main_unix()


# ── Unix (macOS / Linux) ──────────────────────────────────────────────────────

def _main_unix() -> None:
    import pty
    from fcntl import ioctl
    from termios import TIOCSWINSZ
    import struct

    if len(sys.argv) < 2:
        sys.exit("Usage: pty_helper.py <shell> [args...]")

    shell = sys.argv[1]
    args = sys.argv[1:]  # execvp expects argv[0] = program name

    # Standard convention for login shells: prepend '-' to argv[0]
    # This ensures ~/.zprofile, ~/.bash_profile, etc. are sourced.
    args[0] = "-" + os.path.basename(shell)

    # Fork a PTY
    child_pid, pty_fd = pty.fork()

    if child_pid == 0:
        # ─── Child: close inherited pipe fds before exec ──────────────────────
        for _fd in (_CMDIO,):
            try:
                os.close(_fd)
            except OSError:
                pass
        os.execvp(shell, args)
        sys.exit(1)  # unreachable unless execvp fails

    # ─── Parent: proxy I/O ───────────────────────────────────────────────────

    def _shutdown(signum, frame):
        """Graceful shutdown on SIGTERM/SIGHUP."""
        try:
            os.kill(child_pid, signal.SIGTERM)
        except OSError:
            pass
        try:
            os.waitpid(child_pid, 0)
        except ChildProcessError:
            pass
        os._exit(0)

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGHUP, _shutdown)

    stdin_fd  = sys.stdin.fileno()
    stdout_fd = sys.stdout.fileno()

    # Put stdin in raw mode so we don't double-process input
    import tty
    import termios
    old_attrs: Optional[list] = None
    try:
        old_attrs = termios.tcgetattr(stdin_fd)
        tty.setraw(stdin_fd)
    except termios.error:
        pass  # stdin not a tty (e.g. piped) — that's fine

    # Check if the resize pipe fd is open
    has_cmdio = False
    try:
        os.fstat(_CMDIO)
        has_cmdio = True
    except OSError:
        pass

    # ── Watchdog thread ───────────────────────────────────────────────────────
    # Monitors whether our parent (Obsidian/Electron) is still alive by
    # periodically checking if our stdin pipe is still connected.
    # When the parent dies, we kill the child shell and force-exit.
    _parent_pid = os.getppid()
    _stop_event = threading.Event()

    def _watchdog():
        """Background thread: detect parent death and force-exit."""
        import select as _sel
        while not _stop_event.wait(timeout=2.0):
            # Method 1: check if parent PID changed (reparented to launchd/init)
            if os.getppid() != _parent_pid:
                break
            # Method 2: poll stdin for hangup — most reliable on macOS
            try:
                r, _, _ = _sel.select([], [], [stdin_fd], 0)
            except (OSError, ValueError):
                break
            # Method 3: try to fstat the resize pipe — fails if closed
            if has_cmdio:
                try:
                    os.fstat(_CMDIO)
                except OSError:
                    break
        # Parent is gone — tear down
        try:
            os.kill(child_pid, signal.SIGTERM)
        except OSError:
            pass
        try:
            os.waitpid(child_pid, os.WNOHANG)
        except ChildProcessError:
            pass
        os._exit(0)

    watchdog = threading.Thread(target=_watchdog, daemon=True)
    watchdog.start()

    sel = DefaultSelector()
    sel.register(stdin_fd, EVENT_READ, "stdin")
    sel.register(pty_fd,   EVENT_READ, "pty")
    if has_cmdio:
        sel.register(_CMDIO, EVENT_READ, "cmd")

    try:
        while True:
            events = sel.select(timeout=None)
            for key, _ in events:
                name = key.data

                if name == "pty":
                    try:
                        data = os.read(pty_fd, _CHUNK)
                    except OSError:
                        data = b""
                    if not data:
                        return  # PTY closed → shell exited
                    _write_all(stdout_fd, data)

                elif name == "stdin":
                    try:
                        data = os.read(stdin_fd, _CHUNK)
                    except OSError:
                        data = b""
                    if not data:
                        # Parent closed our stdin → Obsidian is gone; tear down.
                        return
                    _write_all(pty_fd, data)

                elif name == "cmd":
                    # Resize frame: 4 bytes big-endian (rows, cols)
                    try:
                        frame = os.read(_CMDIO, 4)
                    except OSError:
                        frame = b""
                    if not frame:
                        # Resize pipe closed → parent is gone; tear down.
                        return
                    if len(frame) == 4:
                        rows, cols = unpack("!HH", frame)
                        winsize = struct.pack("HHHH", rows, cols, 0, 0)
                        try:
                            ioctl(pty_fd, TIOCSWINSZ, winsize)
                        except OSError:
                            pass
    finally:
        _stop_event.set()
        sel.close()
        if old_attrs is not None:
            try:
                termios.tcsetattr(stdin_fd, termios.TCSADRAIN, old_attrs)
            except termios.error:
                pass
        try:
            os.kill(child_pid, signal.SIGTERM)
        except OSError:
            pass
        try:
            os.waitpid(child_pid, 0)
        except ChildProcessError:
            pass


# ── Windows stub (not currently supported) ────────────────────────────────────

def _main_win32() -> None:
    sys.exit("Windows PTY not supported in this version.")


if __name__ == "__main__":
    main()
