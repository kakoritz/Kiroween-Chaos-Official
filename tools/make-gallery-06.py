#!/usr/bin/env python3
"""Regenerate submission/gallery/06-skeleton-crew.png (1500x1000): one skeleton, three apps. Usage: make-gallery-06.py [REPO_ROOT]
Needs python3 + playwright chromium. CHROME_NO_SANDBOX=1 adds --no-sandbox. Sprites live in submission/gallery-src/."""
import base64, os, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
repo = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent)
b64 = lambda n: base64.b64encode((repo / "submission/gallery-src" / n).read_bytes()).decode()
ghost = """<svg width="110" height="130" viewBox="0 0 110 130"><path d="M10 120V55C10 25 30 8 55 8s45 17 45 47v65l-15-12-15 12-15-12-15 12-15-12z" fill="#e9e4ff" stroke="#9b8cc4" stroke-width="4"/><circle cx="38" cy="55" r="9" fill="#14101f"/><circle cx="72" cy="55" r="9" fill="#14101f"/><ellipse cx="55" cy="84" rx="9" ry="12" fill="#14101f"/></svg>"""
pill = lambda c, t: f"<div class='pill' style='border-color:{c};color:{c}'>{t}</div>"
card = lambda c, name, l1, l2, art: f"<div class='card' style='border-color:{c}'><div class='cn' style='color:{c}'>{name}</div><div class='l'>{l1}</div><div class='l'>{l2}</div><div class='art'>{art}</div></div>"
html = f"""<body style='margin:0;width:1500px;height:1000px;background:linear-gradient(#0d0a16 70%,#1a1230);font-family:"DejaVu Sans Mono",monospace;color:#f3ead2;position:relative;overflow:hidden'>
<style>.t{{position:absolute;top:28px;width:100%;text-align:center;font-size:76px;font-weight:800;color:#ff9a3c}}
.h{{position:absolute;left:330px;top:140px;width:840px;height:440px;border:6px solid #ff9a3c;border-radius:34px;background:#151030}}
.hn{{text-align:center;font-size:40px;font-weight:700;margin-top:14px}}
.pill{{margin:14px 40px 0;height:52px;border:5px solid;border-radius:20px;background:#120e1f;text-align:center;font-size:30px;font-weight:700;line-height:52px}}
.card{{position:absolute;top:650px;width:420px;height:250px;border:6px solid;border-radius:30px;background:#1a1530;text-align:center}}
.cn{{font-size:38px;font-weight:700;margin-top:14px}} .l{{font-size:26px;margin-top:10px}}
.art{{position:absolute;left:0;right:0;top:-100px;text-align:center;display:none}}
.link{{position:absolute;top:580px;width:10px;height:70px}}
.sp{{position:absolute;top:905px;height:90px}}
.foot{{position:absolute;bottom:14px;width:100%;text-align:center;font-size:34px;color:#9b8cc4}}</style>
<div class='t'>ONE SKELETON, THREE APPS</div>
<div class='h'><div class='hn'>THE HARNESS</div>{pill('#7fb8ff','Event contract')}{pill('#5be08a','Runner')}{pill('#ffc13c','Fake provider + ledger')}{pill('#a06cf5','Scoring')}{pill('#ff9a3c','Arena UI')}</div>
<div class='link' style='left:240px;background:#5be08a'></div><div class='link' style='left:745px;background:#7fb8ff'></div><div class='link' style='left:1250px;background:#ffc13c'></div>
{card('#5be08a','ORDERS','Node / TypeScript','11 stages','')}{card('#7fb8ff','TICKET DESK','Python, stdlib only','11 stages','')}{card('#ffc13c','STREAM','Node','5 stages','')}
<style>.card:nth-of-type(1){{left:30px}}</style>
<img class='sp' style='left:210px;top:800px;height:95px' src='data:image/png;base64,{b64("skeleton.png")}'>
<img class='sp' style='left:715px;top:800px;height:95px' src='data:image/png;base64,{b64("demon.png")}'>
<div class='sp' style='left:1217px;top:795px;transform:scale(.7);transform-origin:top left'>{ghost}</div>
<div class='foot'>same journal format, no engine change</div></body>"""
html = html.replace("<style>.card:nth-of-type(1){left:30px}</style>", "")
html = html.replace("class='card' style='border-color:#5be08a'", "class='card' style='left:30px;border-color:#5be08a'").replace("class='card' style='border-color:#7fb8ff'", "class='card' style='left:540px;border-color:#7fb8ff'").replace("class='card' style='border-color:#ffc13c'", "class='card' style='left:1050px;border-color:#ffc13c'")
args = ["--no-sandbox"] if os.environ.get("CHROME_NO_SANDBOX") else []
with sync_playwright() as p:
    b = p.chromium.launch(args=args); pg = b.new_page(viewport={"width": 1500, "height": 1000})
    pg.set_content(html); pg.wait_for_timeout(300)
    pg.screenshot(path=str(repo / "submission/gallery/06-skeleton-crew.png")); b.close()
