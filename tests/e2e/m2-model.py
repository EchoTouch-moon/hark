"""Browser check for the manual model preview. The provider is the local Mock, never StepFun."""
import os
import socket
import sqlite3
import subprocess
import tempfile
import time
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / "handoff/EVIDENCE/m2-model-browser-2026-11-04"
NODE = r"""
import { openDatabase } from './dist/storage.js';
import { createSyntheticServer } from './dist/fixture-api.js';
const db = openDatabase(process.argv[1]);
const server = createSyntheticServer(db);
server.listen(Number(process.argv[2]), '127.0.0.1');
process.on('SIGTERM', () => server.close(() => { db.close(); process.exit(0); }));
"""


def available_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def start_server(database, port, env):
    proc = subprocess.Popen(["node", "--input-type=module", "-e", NODE, str(database), str(port)], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(100):
        if proc.poll() is not None:
            raise RuntimeError("Synthetic server exited during startup")
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.1):
                return proc
        except OSError:
            time.sleep(0.05)
    proc.terminate()
    raise RuntimeError("Synthetic server did not start")


def stop_server(proc):
    if proc and proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)


def main():
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    subprocess.run(["pnpm", "exec", "tsc", "-p", "tsconfig.build.json"], cwd=ROOT, check=True)
    port = available_port()
    base_env = os.environ.copy()
    for key in ("HARK_MODEL_MODE", "HARK_PI_BIN", "HARK_PI_PROVIDER", "HARK_PI_MODEL", "HARK_PI_PROVIDER_EXTENSION", "STEP_API_KEY", "STEP_PLAN_API_KEY"):
        base_env.pop(key, None)
    with tempfile.TemporaryDirectory(prefix="hark-m2-model-") as directory:
        database = Path(directory) / "demo.sqlite"
        disabled = base_env | {"HARK_MODEL_MODE": "disabled"}
        proc = start_server(database, port, disabled)
        try:
            with sync_playwright() as playwright:
                chrome = os.environ.get("HARK_CHROME_PATH", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
                browser = playwright.chromium.launch(headless=True, **({"executable_path": chrome} if Path(chrome).is_file() else {}))
                try:
                    page = browser.new_page(viewport={"width": 1280, "height": 900})
                    errors = []
                    page.on("pageerror", lambda error: errors.append(str(error)))
                    base = f"http://127.0.0.1:{port}"
                    page.goto(base, wait_until="networkidle")
                    expect(page.get_by_text("这是合成演示。")).to_be_visible()
                    expect(page.get_by_text("模型未配置", exact=False).first).to_be_visible()
                    page.get_by_role("button", name="盘点预置项目").click()
                    page.locator("#content").get_by_role("button", name="星光书签", exact=False).click()
                    expect(page.get_by_role("button", name="预览外发")).to_be_disabled()
                    page.screenshot(path=str(EVIDENCE / "unconfigured.png"), full_page=True)
                    stop_server(proc)
                    proc = start_server(database, port, base_env | {"HARK_MODEL_MODE": "mock", "HARK_PI_MODEL": "synthetic-mock"})
                    page.reload(wait_until="networkidle")
                    page.locator("#content").get_by_role("button", name="星光书签", exact=False).click()
                    expect(page.get_by_text("模型 Mock", exact=True)).to_be_visible()
                    page.locator("#question").fill("这个目标是什么？")
                    page.get_by_role("button", name="预览外发").click()
                    expect(page.get_by_text("即将发送的内容")).to_be_visible()
                    expect(page.locator(".preview-box")).to_contain_text("书签清单")
                    expect(page.locator(".preview-box")).not_to_contain_text("雨滴")
                    expect(page.get_by_text("尚未请求模型", exact=False)).to_be_visible()
                    page.screenshot(path=str(EVIDENCE / "preview.png"), full_page=True)
                    page.get_by_role("button", name="取消预览").click()
                    expect(page.get_by_text("已取消预览", exact=False)).to_be_visible()
                    with sqlite3.connect(database) as connection:
                        assert connection.execute("SELECT count(*) FROM model_runs").fetchone()[0] == 0
                    page.locator("#question").fill("这个目标是什么？")
                    page.get_by_role("button", name="预览外发").click()
                    page.get_by_role("button", name="确认发送").click()
                    expect(page.get_by_text("合成 Mock 模型回复", exact=False)).to_be_visible()
                    expect(page.get_by_text("未验证", exact=False).first).to_be_visible()
                    expect(page.get_by_text("这是固定的示意回复", exact=False)).to_have_count(0)
                    page.get_by_role("button", name="保存为观点草案").click()
                    expect(page.get_by_text("已保存为观点草案", exact=False)).to_be_visible()
                    page.screenshot(path=str(EVIDENCE / "answered.png"), full_page=True)
                    page.reload(wait_until="networkidle")
                    page.locator("#content").get_by_role("button", name="星光书签", exact=False).click()
                    expect(page.get_by_text("合成 Mock 模型回复", exact=False)).to_be_visible()
                    page.locator("#navigation").get_by_role("button", name="雨滴记录", exact=False).click()
                    expect(page.get_by_text("合成 Mock 模型回复", exact=False)).to_have_count(0)
                    page.locator("#navigation").get_by_role("button", name="星光书签", exact=False).click()
                    page.locator("#question").fill("服务故障时不能显示成功")
                    page.get_by_role("button", name="预览外发").click()
                    expect(page.get_by_role("button", name="确认发送")).to_be_visible()
                    page.route("**/api/model/runs", lambda route: route.abort())
                    page.get_by_role("button", name="确认发送").click()
                    expect(page.get_by_text("没有确认模型结果", exact=False)).to_be_visible()
                    expect(page.get_by_text("模型已回答", exact=False)).to_have_count(0)
                    page.screenshot(path=str(EVIDENCE / "confirm-failed.png"), full_page=True)
                    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
                    page.set_viewport_size({"width": 390, "height": 844})
                    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
                    assert not errors, errors
                finally:
                    browser.close()
        finally:
            stop_server(proc)


if __name__ == "__main__":
    main()
