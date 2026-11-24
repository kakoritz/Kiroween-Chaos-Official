#!/usr/bin/env python3
"""Screen capture with Playwright (headless Chromium, recordVideo). Drives the REAL app.
Usage: capture.py REPO_ROOT OUT_DIR [scene ...]   (scenes: s01 s02 s03 s05 s07 s08)
Starts the live server (HAUNT_PORT=17270, provider 17271) and the hosted build (17280) as child
processes and kills only those PIDs. Writes OUT/clips/<scene>.webm and OUT/clips/capture.json
(per-scene 'start' = seconds into the clip where the interesting part begins)."""
import json, os, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

repo = Path(sys.argv[1]).resolve(); out = Path(sys.argv[2]); want = sys.argv[3:]
clips = out / "clips"; clips.mkdir(parents=True, exist_ok=True)
LIVE = "http://127.0.0.1:17270/"; HOSTED = "http://127.0.0.1:17280/"
meta_path = clips / "capture.json"
meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}

def start(cmd, env=None):
    return subprocess.Popen(cmd, cwd=repo, env={**os.environ, **(env or {})}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

live = None
def restart_live():
    global live
    if live: live.terminate(); live.wait(); time.sleep(1)
    live = start(["node", "tools/demo.mjs", "--no-open"], {"HAUNT_PORT": "17270", "HAUNT_PROVIDER_PORT": "17271"}); time.sleep(7)
hosted = start(["node", "tools/serve-hosted.mjs", "17280"]); time.sleep(2)

def js_click(pg, sel_js):
    pg.evaluate(sel_js)

def gear_speed_and_tour(pg, speed):
    pg.click("#gear-btn"); pg.wait_for_timeout(500)
    pg.click(f'text="{speed}"'); pg.wait_for_timeout(500)
    pg.click("#gear-btn"); pg.wait_for_timeout(500)
    pg.click("#gp-tour")

def scene(browser, name, url, w, h, fn):
    if url.startswith(LIVE): restart_live()
    ctx = browser.new_context(viewport={"width": w, "height": h}, record_video_dir=str(out / "raw"), record_video_size={"width": w, "height": h})
    pg = ctx.new_page(); t0 = time.time()
    pg.goto(url); pg.wait_for_timeout(1500)
    start_at = fn(pg, t0) or 1.5
    video = pg.video; ctx.close()
    dst = clips / f"{name}.webm"; Path(video.path()).replace(dst)
    meta[name] = {"start": round(start_at, 2), "length": round(time.time() - t0, 2), "w": w, "h": h}
    meta_path.write_text(json.dumps(meta, indent=1)); print(name, meta[name])

def s01(pg, t0):
    pg.wait_for_timeout(11000)
    pg.evaluate("[...document.querySelectorAll('button,a')].find(b=>b.innerText.trim()==='Skip')?.click()")
    pg.wait_for_timeout(17000)
def s02(pg, t0): pg.wait_for_timeout(38000)
def s03(pg, t0):
    gear_speed_and_tour(pg, "2x"); pg.wait_for_timeout(5000)
    pg.locator("#dial input[type=range]").focus(); pg.keyboard.press("End"); pg.wait_for_timeout(20000)
def s07(pg, t0):
    pg.click('button:text-is("Inbox")'); pg.wait_for_timeout(2500)
    pg.click("#demo-open"); pg.wait_for_timeout(26000)
def s05(pg, t0):
    pg.click("#splash-skip"); pg.wait_for_timeout(500)
    pg.evaluate("document.getElementById('tour-big').click()")
    while pg.evaluate("window.__haunt.getTournament().then(t=>t.phase)") not in ("awaiting_next", "review"): pg.wait_for_timeout(1000)
    pg.wait_for_timeout(4000)
    pg.evaluate("document.getElementById('patterns-btn').click()"); pg.wait_for_timeout(1500)
    begin = time.time() - t0
    pg.evaluate("[...document.querySelectorAll('button')].find(b=>b.innerText.includes('Write fix spec')).click()"); pg.wait_for_timeout(2500)
    pg.evaluate("[...document.querySelectorAll('button')].find(b=>b.innerText.includes('Improve')).click()")
    pg.wait_for_timeout(95000)
    return begin
def s08(pg, t0):
    pg.wait_for_timeout(2500)
    pg.evaluate("""(()=>{const s=[...document.querySelectorAll('select')];for(const e of s){const o=[...e.options].find(o=>/stream/i.test(o.text+o.value));if(o){e.value=o.value;e.dispatchEvent(new Event('change',{bubbles:true}));return}}
      const b=[...document.querySelectorAll('button')].find(b=>/stream/i.test(b.innerText));b?.click()})()""")
    pg.wait_for_timeout(12000)

SCENES = {
    "s01": (LIVE + "?demo=hero", 1920, 1080, s01),
    "s02": (LIVE + "?splash=0", 1920, 1080, s02),
    "s03": (LIVE + "?splash=0&demo=off", 1920, 1080, s03),
    "s07": (LIVE + "?splash=0&demo=off", 1920, 1080, s07),
    "s05": (HOSTED, 2300, 1294, s05),
    "s08": (LIVE + "workflow-lab.html", 1920, 1080, s08),
}
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        for k, (u, w, h, fn) in SCENES.items():
            if want and k not in want: continue
            scene(b, k, u, w, h, fn)
        b.close()
finally:
    for pr in (live, hosted):
        if pr: pr.terminate()
