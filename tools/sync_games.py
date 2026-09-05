#!/usr/bin/env python3
"""Build data/games.json for the portfolio "Мои игры" tab.

Sources (all public):
- itch.io   -- HTML scrape of the user's game grid (someshboy.itch.io)
- MyIndie   -- HTML scrape of the user profile page + per-card stats
- SibGameJam-- public JSON API: https://naspeh.tech/api/v1/games/public/<user>

Run: python3 tools/sync_games.py   (GitHub Actions runs it on a schedule)
"""

import html as htmllib
import json
import os
import re
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "games.json")

ITCH_USER = "someshboy"
MYINDIE_USER = "someshboy"
SIB_USER = "onemella"

ITCH_URL = f"https://{ITCH_USER}.itch.io/"
MYINDIE_URL = f"https://myindie.net/users/user/{MYINDIE_USER}"
SIB_URL = f"https://naspeh.tech/api/v1/games/public/{SIB_USER}"

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")


def fetch(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        status = resp.status
    ctype = resp.headers.get_content_charset()
    return raw.decode(ctype or "utf-8", errors="replace"), status, len(raw)


class SourceResult:
    def __init__(self):
        self.games = []
        self.count = 0
        self.error = None


# --------------------------------------------------------------------------
# itch.io
# --------------------------------------------------------------------------

def parse_itch(html):
    res = SourceResult()
    starts = list(re.finditer(r'<div[^>]*data-game_id="(\d+)"[^>]*class="game_cell', html))
    for i, m in enumerate(starts):
        end = starts[i + 1].start() if i + 1 < len(starts) else len(html)
        cell = html[m.start():end]
        url_m = re.search(r'<a[^>]*class="thumb_link game_link"[^>]*href="(https://[^"]+)"', cell)
        title_m = re.search(r'<a[^>]*class="title game_link"[^>]*>([^<]+)</a>', cell)
        if not url_m or not title_m:
            continue
        cover_m = re.search(r'<img[^>]*data-lazy_src="([^"]+)"', cell)
        desc_m = re.search(r'class="game_text"[^>]*>([^<]*)</div>', cell)
        genre_m = re.search(r'class="game_genre"[^>]*>([^<]+)</div>', cell)
        platforms = []
        if "web_flag" in cell:
            platforms.append("web")
        for icon in re.findall(r'icon-(windows8|linux|apple|android|windows)', cell):
            mapped = "windows" if icon == "windows8" else icon
            if mapped not in platforms:
                platforms.append(mapped)
        res.games.append({
            "id": "itch/" + m.group(1),
            "title": htmllib.unescape(title_m.group(1)).strip(),
            "source": "itch",
            "url": url_m.group(1),
            "cover": cover_m.group(1) if cover_m else "",
            "genre": htmllib.unescape(genre_m.group(1)).strip() if genre_m else "",
            "platforms": platforms,
            "description": htmllib.unescape(desc_m.group(1)).strip() if desc_m and desc_m.group(1).strip() else "",
            "game_id": int(m.group(1)),
        })
    res.count = len(res.games)
    if not res.games and html and "game_cell" not in html:
        res.error = ("empty grid (bot-wall/captcha or layout change?) "
                     f"len={len(html)}")
    return res


# --------------------------------------------------------------------------
# MyIndie
# --------------------------------------------------------------------------

ENGINES = {"unity", "unreal", "unreal engine", "godot", "game maker", "gamemaker",
           "construct", "rpg maker", "twine", "bitsy", "ren'py", "renpy", "coppercube"}
PLATFORM_ICONS = {"windows": "windows", "linux": "linux", "apple": "mac", "android": "android"}


def parse_myindie(html):
    res = SourceResult()
    starts = list(re.finditer(r'<article[^>]*itemtype="https://schema\.org/VideoGame"', html))
    for i, m in enumerate(starts):
        end = starts[i + 1].start() if i + 1 < len(starts) else len(html)
        card = html[m.start():end]
        slug_m = re.search(r'<a href="(/games/game/[^?"]+)', card)
        title_m = re.search(r'<p class="h4" itemprop="name"[^>]*>([^<]+)</p>', card)
        if not slug_m or not title_m:
            continue
        cover_m = re.search(r'<img src="([^"]+)"[^>]*itemprop="image"', card)
        badges = []
        for bm in re.finditer(r'<span class="app-badge me-2 mb-2"[^>]*>(.*?)</span>', card, re.S):
            inner = bm.group(1)
            if "bi-star-fill" in inner:
                continue
            txt = re.sub(r"<[^>]+>", "", inner).strip()
            if txt:
                badges.append(htmllib.unescape(txt))
        genre = ""
        jam = ""
        for b in badges:
            low = b.lower()
            if low in ENGINES or re.match(r"^v[\d.]", b):
                continue
            if len(b) == 2 and b.isalpha():
                continue
            if "jam" in low or "lvl" in low:
                jam = b
                continue
            if not genre:
                genre = b
        platforms = []
        pm = re.search(r'app-badge app-badge-black[^>]*>.*?bi-([a-z0-9]+)', card, re.S)
        if pm and pm.group(1) in PLATFORM_ICONS:
            platforms.append(PLATFORM_ICONS[pm.group(1)])
        stats = {}
        like = re.search(r'LikeAction"[^>]*><meta itemprop="userInteractionCount" content="(\d+)"', card)
        down = re.search(r'DownloadAction"[^>]*><meta itemprop="userInteractionCount" content="(\d+)"', card)
        view = re.search(r'bi-eye-fill[^>]*></i><span[^>]*>(\d+)</span>', card)
        if down:
            stats["downloads"] = int(down.group(1))
        if view:
            stats["views"] = int(view.group(1))
        if like:
            stats["likes"] = int(like.group(1))
        game = {
            "id": "myindie/" + slug_m.group(1).split("/")[-1],
            "title": htmllib.unescape(title_m.group(1)).strip(),
            "source": "myindie",
            "url": "https://myindie.net" + slug_m.group(1),
            "cover": cover_m.group(1) if cover_m else "",
            "genre": genre,
            "platforms": platforms,
        }
        extra = []
        if jam:
            extra.append(jam)
        if extra:
            game["badges"] = extra
        if stats:
            game["stats"] = stats
        res.games.append(game)
    res.count = len(res.games)
    return res


# --------------------------------------------------------------------------
# SibGameJam
# --------------------------------------------------------------------------

def parse_sibgamejam(text):
    res = SourceResult()
    try:
        data = json.loads(text)
    except ValueError as e:
        res.error = f"bad JSON: {e}"
        return res
    if not isinstance(data, list):
        res.error = f"unexpected shape: {type(data).__name__}"
        return res
    for item in data:
        slug = item.get("slug") or ""
        res.games.append({
            "id": "sibgamejam/" + slug,
            "title": (item.get("title") or slug).strip(),
            "source": "sibgamejam",
            "url": ("https://naspeh.tech/games/" + slug) if slug else "https://naspeh.tech/",
            "cover": item.get("capsuleImage") or "",
            "description": (item.get("description") or "").strip(),
            "genre": "",
            "platforms": [],
        })
    res.count = len(res.games)
    return res


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def main():
    meta = {}

    jobs = [
        ("itch", ITCH_URL, lambda t: parse_itch(t)),
        ("myindie", MYINDIE_URL, lambda t: parse_myindie(t)),
        ("sibgamejam", SIB_URL, lambda t: parse_sibgamejam(t)),
    ]
    results = {}
    for name, url, fn in jobs:
        try:
            text, status, length = fetch(url)
            results[name] = fn(text)
            meta[name] = {"url": url, "http": status, "len": length}
        except Exception as e:  # noqa: BLE001 -- keep the snapshot built with the rest
            r = SourceResult()
            r.error = f"{type(e).__name__}: {e}"
            results[name] = r
            meta[name] = {"url": url}

    games = []
    old_by_source = {}
    if os.path.exists(OUT):
        try:
            with open(OUT, "r", encoding="utf-8") as f:
                old = json.load(f)
            for g in old.get("games", []):
                old_by_source.setdefault(g.get("source"), []).append(g)
        except Exception:  # noqa: BLE001 -- corrupt old snapshot, start fresh
            old = {}

    for name in ("itch", "myindie", "sibgamejam"):
        r = results[name]
        meta[name]["count"] = r.count
        if r.error:
            meta[name]["error"] = r.error
        if r.count:
            games.extend(r.games)
        else:
            # Источник отдал 0 игр (блокировка/сбой) → сохраняем прошлые данные.
            kept = old_by_source.get(name, [])
            meta[name]["kept_previous"] = len(kept)
            games.extend(kept)

    for src in ("itch", "myindie", "sibgamejam"):
        print(f"{src}: {meta[src]}")
    print(f"total games: {len(games)}")

    out = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "games": games,
        "sources": meta,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()