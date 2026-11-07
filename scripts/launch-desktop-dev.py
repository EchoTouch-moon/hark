#!/usr/bin/env python3
"""Local development launcher. Never configures a key or sends model requests."""
import fcntl
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
BINARY = ROOT / 'apps/desktop/target/debug/hark-desktop'
UI = ROOT / 'apps/desktop/ui'
URL = 'http://127.0.0.1:1420/'


def running_pid():
    result = subprocess.run(['/usr/bin/pgrep', '-f', '^' + re.escape(str(BINARY)) + '$'],
                            capture_output=True, text=True)
    rows = result.stdout.strip().splitlines()
    return int(rows[0]) if rows and rows[0].isdigit() else None


def server_ready():
    # No proxy and no business API: inspect only the local Vite HTML shell.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(URL, timeout=0.5) as response:
            body = response.read(16384).decode('utf-8', errors='replace')
            if response.status == 200 and 'Hark' in body and '/src/main.tsx' in body:
                return True
            raise RuntimeError('1420端口不是Hark开发页面，请先处理端口占用。')
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def activate(pid):
    # AppKit activation, without System Events/accessibility or a model call.
    source = ("ObjC.import('AppKit'); var app=$.NSRunningApplication."
              f"runningApplicationWithProcessIdentifier({int(pid)}); "
              "if(app.isNil()) throw Error('Hark进程已退出'); "
              "app.unhide; if(!app.activateWithOptions(3)) throw Error('无法激活窗口');")
    try:
        subprocess.run(['/usr/bin/osascript', '-l', 'JavaScript', '-e', source],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        raise RuntimeError('Hark窗口未能激活，请再次双击，或从托盘选择“显示窗口”。') from None


def private_log(path):
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW, 0o600)
    return os.fdopen(fd, 'ab', buffering=0)


def launch():
    if not BINARY.is_file():
        raise RuntimeError('开发版尚未构建。请先在仓库运行 cargo build --manifest-path apps/desktop/Cargo.toml -p hark-desktop。')
    state = ROOT / 'data/desktop-launcher'
    if (ROOT / 'data').is_symlink() or state.is_symlink():
        raise RuntimeError('启动目录不能是符号链接。')
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock_fd = os.open(str(state / 'launch.lock'), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if not server_ready():
            node = next((p for p in ['/usr/local/bin/node', '/opt/homebrew/bin/node']
                         if os.access(p, os.X_OK)), None)
            vite = ROOT / 'node_modules/vite/bin/vite.js'
            if not node or not vite.is_file():
                raise RuntimeError('缺少Node或前端依赖，请先在仓库运行 npm ci --ignore-scripts。')
            with private_log(state / 'vite.log') as log:
                server = subprocess.Popen([node, str(vite), '--host', '127.0.0.1',
                                           '--port', '1420', '--strictPort'], cwd=UI,
                                          stdin=subprocess.DEVNULL, stdout=log,
                                          stderr=subprocess.STDOUT, start_new_session=True)
            deadline = time.monotonic() + 20
            while not server_ready():
                if server.poll() is not None or time.monotonic() >= deadline:
                    raise RuntimeError('本地页面服务未就绪，请查看仓库data/desktop-launcher/vite.log。')
                time.sleep(0.2)
        pid = running_pid()
        if pid is None:
            with private_log(state / 'native.log') as log:
                process = subprocess.Popen([str(BINARY)], cwd=ROOT, stdin=subprocess.DEVNULL,
                                           stdout=log, stderr=subprocess.STDOUT,
                                           start_new_session=True)
            pid = process.pid
            time.sleep(1)
            if process.poll() is not None:
                raise RuntimeError('Hark启动后退出，请查看仓库data/desktop-launcher/native.log。')
        activate(pid)
        print('Hark已打开。若窗口已隐藏到托盘，请从托盘选择“显示窗口”。')


if __name__ == '__main__':
    try:
        launch()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
