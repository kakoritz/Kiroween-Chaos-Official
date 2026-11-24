#!/usr/bin/env python3
"""Render the architecture SVG and the end card to 1920x1080 PNGs. Usage: assets.py REPO_ROOT OUT_DIR"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
repo = Path(sys.argv[1]).resolve(); out = Path(sys.argv[2]) / "assets"; out.mkdir(parents=True, exist_ok=True)
svg = (repo / "docs/img/architecture.svg").read_text()
arch = f"<body style='margin:0;background:#14101f;display:flex;align-items:center;justify-content:center;height:100vh'><div style='width:1778px'>{svg.replace('width=\"960\" height=\"520\"','width=\"1778\" height=\"963\"')}</div></body>"
end = """<body style='margin:0;height:100vh;background:radial-gradient(#2a1f45,#0d0a16);color:#f3ead2;font-family:"DejaVu Sans",sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center'>
<div style='font-size:120px;letter-spacing:14px;font-weight:800;text-shadow:0 0 40px #ff9a3c'>KIROWEEN CHAOS</div>
<div style='font-size:44px;color:#ff9a3c;margin:30px 0 70px'>Chaos engineering for AI agents, played as a haunted house.</div>
<div style='font-size:40px;margin:10px'>github.com/kakoritz/Kiroween-Chaos-Official</div>
<div style='font-size:40px;margin:10px'>kakoritz.github.io/Kiroween-Chaos-Official/</div>
<div style='font-size:30px;color:#9b8cc4;margin-top:60px'>Break your bots before the world does.</div></body>"""
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1920, "height": 1080})
    for name, html in (("architecture", arch), ("endcard", end)):
        pg.set_content(html); pg.wait_for_timeout(300); pg.screenshot(path=str(out / f"{name}.png"))
    b.close()
