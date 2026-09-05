#!/usr/bin/env python3
"""Build data/games.json for the portfolio "Мои игры" tab.

Собирает по трём платформам:
- аккаунт (информация о профиле, доступная публично),
- игры,
- джемы, в которых участвуют игры (полная статистика: участники,
  оценки, место/результат если подведён).

Sources (all public):
- itch.io   -- HTML scrape user game grid + per-game jam entries +
               jam page stats + results page rank
- MyIndie   -- HTML scrape profile (account + games) + jam pages
- SibGameJam-- public JSON API: https://naspeh.tech/api/v1/games/public/<user>
               + статический конфиг джемов из data/projects.json -> games.jams

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
PROJECTS = os.path.join(ROOT, "data", "projects.json")

ITCH_USER = "someshboy"
MYINDIE_USER = "someshboy"
SIB_USER = "onemella"

ITCH_URL = f"https://{ITCH_USER}.itch.io/"
ITCH_JAM_URL = "https://itch.io/jam/"
MYINDIE_URL = f"https://myindie.net/users/user/{MYINDIE_USER}"
MYINDIE_JAM_URL = "https://myindie.net/jams/jam/"
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
# helpers
# --------------------------------------------------------------------------

def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")


def _attr(tag, name):
    m = re.search(name + r'="([^"]*)"', tag)
    return m.group(1) if m else ""


def load_static_jams():
    """Статические джемы из data/projects.json -> games.jams (для платформ,
    где публичного API джемов нет). Имеют вид:
    {"source": "sibgamejam", "game_ids": ["inkdarkunk"],
     "title": "...", "url": "...", "date_start": "...", "date_end": "..."}"""
    try:
        with open(PROJECTS, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        return cfg.get("games", {}).get("jams", []) or []
    except Exception:  # noqa: BLE001
        return []


def attach_static_jams(games):
    for j in load_static_jams():
        src = j.get("source")
        wanted = set(j.get("game_ids", []) or [])
        if not src or not wanted:
            continue
        for g in games:
            if g.get("source") != src:
                continue
            key = g.get("id", "").split("/", 1)[-1]
            if key in wanted:
                g.setdefault("jams", []).append({
                    "source": src,
                    "title": j.get("title", ""),
                    "url": j.get("url", ""),
                    "date_start": j.get("date_start") or None,
                    "date_end": j.get("date_end") or None,
                    "entries": j.get("entries"),
                    "place": j.get("place"),
                    "score": j.get("score"),
                })


# --------------------------------------------------------------------------
# itch.io
# --------------------------------------------------------------------------

def parse_itch(html):
    res = SourceResult()
    # Сканируем теги <div ...> и фильтруем по обоим атрибутам — порядок атрибутов не важен.
    open_tags = re.finditer(r'<div[^>]*>', html)
    starts = []
    for m in open_tags:
        gm = re.search(r'data-game_id="(\d+)"', m.group(0))
        if gm and "game_cell" in m.group(0):
            starts.append((m.start(), gm.group(1)))
    for i, (cell_start, game_id) in enumerate(starts):
        end = starts[i + 1][0] if i + 1 < len(starts) else len(html)
        cell = html[cell_start:end]
        url = ""
        title = ""
        for am in re.finditer(r'<a[^>]*>.*?</a>', cell, re.S):
            tag = am.group(0)
            cls = _attr(tag, "class")
            if "game_link" not in cls:
                continue
            if "thumb_link" in cls:
                url = _attr(tag, "href")
            if "title" in cls:
                inner = re.sub(r"^<a[^>]*>", "", tag)
                inner = re.sub(r"</a>$", "", inner)
                title = htmllib.unescape(re.sub(r"<[^>]+>", "", inner)).strip()
        if not url or not title:
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
            "id": "itch/" + game_id,
            "title": title,
            "source": "itch",
            "url": url,
            "cover": cover_m.group(1) if cover_m else "",
            "genre": htmllib.unescape(genre_m.group(1)).strip() if genre_m else "",
            "platforms": platforms,
            "description": htmllib.unescape(desc_m.group(1)).strip() if desc_m and desc_m.group(1).strip() else "",
            "game_id": int(game_id),
        })
    res.count = len(res.games)
    if not res.games:
        start = html.find("game_cell")
        snippet = html[start:start + 200] if start >= 0 else html[:200]
        res.error = f"no game cells parsed (len={len(html)}, snippet={snippet!r})"
    return res


def parse_itch_game_jams(html):
    """Джемы, в которых участвует игра (из страницы игры)."""
    found = []
    for m in re.finditer(
            r'<li class="jam_entry"><a class="action_btn" href="'
            r'https://itch\.io/jam/([^"/]+)/rate/(\d+)"[^>]*>'
            r'(?:<svg.*?</svg>\s*)?Submission to ([^<]+)</a></li>',
            html, re.S):
        found.append({
            "slug": m.group(1),
            "game_id": int(m.group(2)),
            "title": htmllib.unescape(m.group(3)).strip(),
        })
    return found


def parse_itch_jam_page(html):
    """Статистика джема: Entries / Ratings из шапки страницы джема."""
    stats = {}
    for val, label in re.findall(
            r'<div class="stat_value">([\d,]+)</div><div class="stat_label">(Entries|Ratings)</div>',
            html):
        stats[label.lower()] = int(val.replace(",", ""))
    return stats


def parse_itch_results(html, game_url):
    """Результат конкретной игры в джеме (страница /results)."""
    blocks = re.split(r'<div class="game_rank[^"]*">', html)
    for part in blocks[1:]:
        if 'href="' + game_url + '"' not in part:
            continue
        m = re.search(
            r'Ranked <strong class="ordinal_rank">([^<]+)</strong> with ([\d,]+) '
            r'ratings? \(Score: ([0-9.]+)\)', part)
        if m:
            return {
                "place": m.group(1),
                "ratings": int(m.group(2).replace(",", "")),
                "score": float(m.group(3)),
            }
        return {}
    return {}


def enrich_itch(games):
    """По каждой игре — страница игры → джемы; страницы джемов → статистика."""
    note = {}
    jam_page_stats = {}
    for game in games:
        try:
            text, status, length = fetch(game["url"])
        except Exception as e:  # noqa: BLE001
            note[game["id"]] = f"game_page failed: {type(e).__name__}"
            game["jams"] = []
            continue
        entries = parse_itch_game_jams(text)
        jams = []
        for j in entries:
            slug = j["slug"]
            stats = jam_page_stats.get(slug)
            if stats is None:
                stats = {}
                try:
                    jt, st, ln = fetch(ITCH_JAM_URL + slug)
                    stats.update(parse_itch_jam_page(jt))
                except Exception:  # noqa: BLE001
                    pass
                jam_page_stats[slug] = stats
            jam = {
                "source": "itch",
                "slug": slug,
                "title": j["title"],
                "url": ITCH_JAM_URL + slug,
                "entries": stats.get("entries"),
                "ratings": stats.get("ratings"),
            }
            try:
                rt, st2, ln2 = fetch(ITCH_JAM_URL + slug + "/results")
                jam.update(parse_itch_results(rt, game["url"]))
            except Exception:  # noqa: BLE001
                pass
            jams.append(jam)
        game["jams"] = jams
    return note


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
            if "jam" in low or "lvl" in low or "rush" in low:
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
        if jam:
            game["badges"] = [jam]
        if stats:
            game["stats"] = stats
        res.games.append(game)
    res.count = len(res.games)
    return res


def parse_myindie_account(html):
    acc = {"source": "myindie", "username": MYINDIE_USER, "url": MYINDIE_URL}
    m = re.search(r'profile-card__title[^>]*>([^<]+)<', html)
    if m:
        acc["nickname"] = htmllib.unescape(m.group(1)).strip()
    m = re.search(r'class="text-secondary"[^>]*>([^<]+)</div>', html)
    if m:
        line = m.group(1)
        acc["line"] = htmllib.unescape(line).strip()
    m = re.search(r'<meta property="og:image" content="([^"]+)"', html)
    if m:
        acc["avatar"] = m.group(1)
    labels = {"games": "Игр", "likes": "Лайков", "subscribers": "Подписчиков",
              "comments": "Комментариев", "reviews": "Рецензий"}
    counts = {}
    for key, label in labels.items():
        m = re.search(label + r'[^а-яa-z0-9]{1,10}(\d+)', html)
        if m:
            counts[key] = int(m.group(1))
    if counts:
        acc["counts"] = counts
    m = re.search(r'bi-star-fill[^>]*></i>\s*(\d+)', html)
    if m:
        acc["score"] = int(m.group(1))
    return acc


def parse_myindie_jam(html):
    meta = {}
    m = re.search(r'"startDate"\s*:\s*"([^"]+)"', html)
    if m:
        meta["date_start"] = m.group(1)
    m = re.search(r'"endDate"\s*:\s*"([^"]+)"', html)
    if m:
        meta["date_end"] = m.group(1)
    m = re.search(r'Игр[:]\s*(\d+)', html)
    if m:
        meta["entries"] = int(m.group(1))
    m = re.search(r'Участников[:]\s*([\d ]+)', html)
    if m:
        meta["participants"] = int(m.group(1).replace(" ", ""))
    return meta


def enrich_myindie(games):
    """Джемы из бейджей карточек: "MyIndie January Rush Lvl 8" → страница джема."""
    note = {}
    cache = {}
    for game in games:
        jams = []
        for badge in game.get("badges", []) or []:
            low = badge.lower()
            if not ("jam" in low or "lvl" in low or "rush" in low):
                continue
            slug = slugify(badge)
            url = MYINDIE_JAM_URL + slug
            meta = cache.get(slug)
            if meta is None:
                meta = {}
                try:
                    jt, st, ln = fetch(url)
                    meta.update(parse_myindie_jam(jt))
                except Exception:  # noqa: BLE001
                    pass
                cache[slug] = meta
            jam = {
                "source": "myindie",
                "slug": slug,
                "title": badge,
                "url": url,
                "entries": meta.get("entries"),
                "participants": meta.get("participants"),
                "date_start": meta.get("date_start"),
                "date_end": meta.get("date_end"),
                "level": slug.split("lvl-")[-1] if "lvl-" in slug else None,
            }
            jams.append(jam)
        game["jams"] = jams
    return note


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
    old_snapshot = {}
    if os.path.exists(OUT):
        try:
            with open(OUT, "r", encoding="utf-8") as f:
                old_snapshot = json.load(f)
        except Exception:  # noqa: BLE001
            old_snapshot = {}

    old_by_source = {}
    for g in old_snapshot.get("games", []):
        old_by_source.setdefault(g.get("source"), []).append(g)
    old_accounts = old_snapshot.get("accounts", {}) or {}

    jobs = [
        ("itch", ITCH_URL, lambda t: parse_itch(t)),
        ("myindie", MYINDIE_URL, lambda t: parse_myindie(t)),
        ("sibgamejam", SIB_URL, lambda t: parse_sibgamejam(t)),
    ]
    fetched = {}
    results = {}
    for name, url, fn in jobs:
        try:
            text, status, length = fetch(url)
            fetched[name] = text
            results[name] = fn(text)
            meta[name] = {"url": url, "http": status, "len": length}
        except Exception as e:  # noqa: BLE001 -- keep the snapshot built with the rest
            r = SourceResult()
            r.error = f"{type(e).__name__}: {e}"
            results[name] = r
            meta[name] = {"url": url}

    # Обогащение джемами (ждём только для успешных источников)
    if results["itch"].count and fetched.get("itch"):
        try:
            note = enrich_itch(results["itch"].games)
            meta["itch"]["games_fetched"] = len(results["itch"].games)
            if note:
                meta["itch"]["game_page_notes"] = note
        except Exception as e:  # noqa: BLE001
            meta["itch"]["enrich_failed"] = f"{type(e).__name__}: {e}"
    if results["myindie"].count and fetched.get("myindie"):
        try:
            meta["myindie"]["account"] = parse_myindie_account(fetched["myindie"])
            note = enrich_myindie(results["myindie"].games)
            if note:
                meta["myindie"]["jam_notes"] = note
        except Exception as e:  # noqa: BLE001
            meta["myindie"]["enrich_failed"] = f"{type(e).__name__}: {e}"

    games = []
    for name in ("itch", "myindie", "sibgamejam"):
        r = results[name]
        meta[name]["count"] = r.count
        if r.error:
            meta[name]["error"] = r.error
        if r.count:
            games.extend(r.games)
        else:
            # Источник отдал 0 игр (блокировка/сбой) → сохраняем прошлые данные
            # (включая их джемы).
            kept = old_by_source.get(name, [])
            meta[name]["kept_previous"] = len(kept)
            games.extend(kept)

    attach_static_jams(games)

    accounts = {}
    accounts_src = {}
    if fetched.get("myindie"):
        try:
            accounts_src["myindie"] = parse_myindie_account(fetched["myindie"])
        except Exception:  # noqa: BLE001
            pass
    accounts_src["itch"] = {
        "source": "itch",
        "username": ITCH_USER,
        "nickname": ITCH_USER,
        "url": ITCH_URL,
        "games_count": len(results["itch"].games) or None,
    }
    accounts_src["sibgamejam"] = {
        "source": "sibgamejam",
        "username": SIB_USER,
        "nickname": SIB_USER,
        "url": "https://naspeh.tech/profile/" + SIB_USER,
        "games_count": len(results["sibgamejam"].games) or None,
    }
    for key in ("itch", "myindie", "sibgamejam"):
        acc = accounts_src.get(key)
        if not acc:
            acc = old_accounts.get(key, {})
        accounts[key] = acc

    for src in ("itch", "myindie", "sibgamejam"):
        print(f"{src}: {meta[src]}")
    print(f"total games: {len(games)}")
    print(f"accounts: {list(accounts)}")
    jam_total = sum(len(g.get("jams", [])) for g in games)
    print(f"jam entries: {jam_total}")

    out = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "accounts": accounts,
        "games": games,
        "sources": meta,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()