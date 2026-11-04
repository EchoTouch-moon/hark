"""Real browser check against a disposable, synthetic-only local service."""
import os
import socket
import sqlite3
import subprocess
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / "handoff/EVIDENCE/m1-browser-2026-11-04"
NODE = r"""
import { openDatabase } from './dist/storage.js';
import { createSyntheticServer } from './dist/fixture-api.js';
const db=openDatabase(process.argv[1]), server=createSyntheticServer(db);
server.listen(Number(process.argv[2]),'127.0.0.1');
process.on('SIGTERM',()=>server.close(()=>{db.close();process.exit(0)}));
"""


def available_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def start_server(database, port):
    proc = subprocess.Popen(["node", "--input-type=module", "-e", NODE, str(database), str(port)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
    with tempfile.TemporaryDirectory(prefix="hark-browser-synthetic-") as directory:
        database = Path(directory) / "demo.sqlite"
        proc = start_server(database, port)
        try:
            with sync_playwright() as playwright:
                chrome = os.environ.get("HARK_CHROME_PATH", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
                browser = playwright.chromium.launch(headless=True, **({"executable_path": chrome} if Path(chrome).is_file() else {}))
                try:
                    page = browser.new_page(viewport={"width": 1280, "height": 800})
                    errors = []
                    page.on("pageerror", lambda error: errors.append(str(error)))
                    base = f"http://127.0.0.1:{port}"
                    page.goto(base, wait_until="networkidle")
                    expect(page.get_by_text("这是合成演示。")).to_be_visible()
                    page.get_by_role("button", name="盘点预置项目").click()
                    expect(page.locator("#content").get_by_role("button", name="星光书签", exact=False)).to_be_visible()
                    expect(page.locator("#content").get_by_role("button", name="雨滴记录", exact=False)).to_be_visible()
                    expect(page.get_by_text("归属未知")).to_be_visible()
                    identities = page.evaluate("async () => (await (await fetch('/api/inventory')).json()).projects.map(p => p.id)")
                    assert identities == ["project-a", "project-b"]
                    page.screenshot(path=str(EVIDENCE / "inventory.png"), full_page=True)
                    page.locator("#content").get_by_role("button", name="星光书签", exact=False).click()
                    expect(page.get_by_text("制作一个用于整理虚构阅读笔记的书签清单。")).to_be_visible()
                    expect(page.get_by_text("合成来源 · source-project-a-1").first).to_be_visible()
                    page.screenshot(path=str(EVIDENCE / "project-a.png"), full_page=True)
                    page.locator("#question").fill("依据是什么？")
                    page.get_by_role("button", name="追问", exact=True).click()
                    expect(page.get_by_text("Mock：", exact=False)).to_be_visible()
                    page.locator("#question").fill('<img src=x onerror="window.__harkXss=1">')
                    page.get_by_role("button", name="追问", exact=True).click()
                    expect(page.get_by_text('<img src=x onerror="window.__harkXss=1">', exact=True)).to_be_visible()
                    assert page.evaluate("window.__harkXss === undefined")

                    # A failed request must preserve the pending request and allow an explicit recovery.
                    page.route("**/api/projects/project-a/challenge", lambda route: route.abort())
                    page.locator("#question").fill("合成测试：检查失败后的恢复")
                    page.get_by_role("button", name="质疑并保存").click()
                    expect(page.get_by_text("未确认保存结果", exact=False)).to_be_visible()
                    page.unroute_all(behavior="wait")
                    page.get_by_role("button", name="放弃重试并重新读取").click()
                    expect(page.get_by_role("button", name="质疑并保存")).to_be_visible()

                    page.locator("#question").fill("合成测试：请更谨慎地表达")
                    page.get_by_role("button", name="质疑并保存").click()
                    expect(page.get_by_text("v2 · 合成规则观点")).to_be_visible()
                    page.get_by_text("查看旧版与反馈").click()
                    expect(page.get_by_text("v1 · 合成规则观点")).to_be_visible()
                    expect(page.get_by_text("合成测试：请更谨慎地表达", exact=False).first).to_be_visible()
                    assert "feedback-" not in page.locator("#content").inner_text()
                    page.screenshot(path=str(EVIDENCE / "feedback-v2.png"), full_page=True)

                    page.locator("#navigation").get_by_role("button", name="雨滴记录", exact=False).click()
                    expect(page.get_by_text("整理一份虚构的每日天气观察记录。")).to_be_visible()
                    expect(page.get_by_text("合成测试：请更谨慎地表达", exact=False)).to_have_count(0)
                    page.locator("#question").fill("合成项目B：依据？")
                    page.get_by_role("button", name="追问", exact=True).click()
                    expect(page.get_by_text("合成项目B：依据？", exact=True)).to_be_visible()
                    page.locator("#navigation").get_by_role("button", name="星光书签", exact=False).click()
                    expect(page.get_by_text("v2 · 合成规则观点")).to_be_visible()
                    page.get_by_role("button", name="暂停访问").click()
                    expect(page.get_by_text("星光书签 · 已暂停")).to_be_visible()
                    page.get_by_role("button", name="恢复", exact=True).click()
                    expect(page.get_by_text("星光书签 · 可用")).to_be_visible()

                    stop_server(proc)
                    page.locator("#navigation").get_by_role("button", name="雨滴记录", exact=False).click()
                    expect(page.get_by_text("暂时无法获取内容")).to_be_visible()
                    expect(page.get_by_text("整理一份虚构的每日天气观察记录。")).to_have_count(0)
                    page.screenshot(path=str(EVIDENCE / "service-failure.png"), full_page=True)
                    proc = start_server(database, port)
                    page.reload(wait_until="networkidle")
                    assert page.evaluate("async () => (await (await fetch('/api/inventory')).json()).projects.map(p => p.id)") == identities
                    page.locator("#content").get_by_role("button", name="星光书签", exact=False).click()
                    expect(page.get_by_text("v2 · 合成规则观点")).to_be_visible()
                    expect(page.get_by_text("依据是什么？", exact=True)).to_be_visible()
                    page.get_by_text("查看旧版与反馈").click()
                    expect(page.get_by_text("合成测试：请更谨慎地表达", exact=False).first).to_be_visible()
                    page.locator("#question").fill("合成测试：再次核对")
                    page.get_by_role("button", name="质疑并保存").click()
                    expect(page.get_by_text("v3 · 合成规则观点")).to_be_visible()
                    page.get_by_text("查看旧版与反馈").click()
                    expect(page.get_by_text("v2 · 合成规则观点")).to_be_visible()
                    expect(page.get_by_text("v1 · 合成规则观点")).to_be_visible()
                    page.on("dialog", lambda dialog: dialog.accept())
                    page.get_by_role("button", name="撤销访问").click()
                    expect(page.get_by_text("星光书签 · 已撤销")).to_be_visible()
                    stop_server(proc)
                    proc = start_server(database, port)
                    page.reload(wait_until="networkidle")
                    expect(page.get_by_text("星光书签 · 已撤销")).to_be_visible()
                    expect(page.locator("#content").get_by_role("button", name="星光书签", exact=False)).to_have_count(0)

                    with sqlite3.connect(database) as connection:
                        connection.execute("UPDATE fixture_sources SET enabled=0 WHERE id='source-project-b-1'")
                    page.locator("#content").get_by_role("button", name="雨滴记录", exact=False).click()
                    expect(page.get_by_text("未知或来源不可用").first).to_be_visible()
                    expect(page.get_by_text("暂无可用观点", exact=False)).to_be_visible()
                    expect(page.get_by_text("合成项目B：依据？", exact=True)).to_have_count(0)
                    page.screenshot(path=str(EVIDENCE / "source-unavailable.png"), full_page=True)
                    for width in (1280, 1440):
                        page.set_viewport_size({"width": width, "height": 800})
                        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), f"horizontal overflow at {width}"
                    assert not errors, f"Browser script errors: {errors}"
                    print("PASS M1-R01 through R06: isolated synthetic browser journey; restart, revocation and failure observed")
                    print("PASS layouts: 1280x800 and 1440x800; screenshots saved in handoff/EVIDENCE/m1-browser-2026-11-04")
                finally:
                    browser.close()
        finally:
            stop_server(proc)


if __name__ == "__main__":
    main()
