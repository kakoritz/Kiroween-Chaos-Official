#!/usr/bin/env python3
"""Record the hosted demo to a webm. Usage: make-readme-gif.py URL OUT.webm [seconds]. Called by make-readme-gif.mjs.
Loopback only. CHROME_NO_SANDBOX=1 adds --no-sandbox."""
import os, sys, shutil, tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright
url, out = sys.argv[1], Path(sys.argv[2]); secs = float(sys.argv[3]) if len(sys.argv) > 3 else 30
tmp = tempfile.mkdtemp(prefix="readme-gif-")
args = ["--no-sandbox"] if os.environ.get("CHROME_NO_SANDBOX") else []
with sync_playwright() as p:
    b = p.chromium.launch(args=args)
    ctx = b.new_context(viewport={"width": 960, "height": 600}, record_video_dir=tmp, record_video_size={"width": 960, "height": 600})
    pg = ctx.new_page(); pg.goto(url); pg.wait_for_timeout(int(secs * 1000))
    ctx.close(); b.close()
vid = next(Path(tmp).glob("*.webm")); shutil.move(str(vid), out); shutil.rmtree(tmp, ignore_errors=True)
