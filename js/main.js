import { openModelViewer, openShaderViewer, mountBackground, renderModelThumbnail } from "./viewer.js?v=20260905d";

// GitHub Pages ставит долгий cache-control на статику. Чтобы браузер НЕ хранил
// старые файлы, к URL подставляем "v". Для ассетов (модели, рендеры) берём blob-SHA
// файла из GitHub API: перезалил файл → sha сменился → URL новый → кэш не мешает.
// Остальным файлам хватает статической версии ниже.
const ASSET_VERSION = "20260906a";

function assetUrl(path, fileSha) {
  const v = fileSha || ASSET_VERSION;
  return path + (path.includes("?") ? "&" : "?") + "v=" + v;
}

const state = {
  data: null,
  activeCategory: "all",
  secretOk: false,
  currentViewer: null,
};

const $ = (sel) => document.querySelector(sel);

/* Lazy rendering: model thumbnails render once when visible; shader previews
   animate only while on screen, and free their context when scrolled away. */
const cardViewers = [];
const lazy = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const el = e.target;
if (el.__kind === "shader") {
      if (e.isIntersecting) {
        if (!el.__viewer) {
          el.__viewer = openShaderViewer(el, el.__shader, { small: true });
          cardViewers.push(el.__viewer);
        } else {
          el.__viewer.setVisible(true);
        }
      } else if (el.__viewer) {
        el.__viewer.setVisible(false);
      }
    } else if (e.isIntersecting && el.__lazy) {
      el.__lazy();
      el.__lazy = null;
      lazy.unobserve(el);
    }
  }
}, { rootMargin: "300px" });

const SCAN = [
  { path: "assets/models",   ext: ["glb", "gltf", "fbx", "blend"], type: "model", category: "modeling" },
  { path: "assets/shaders",  ext: ["frag"],                  type: "shader", category: "shaders" },
  { path: "assets/previews", ext: ["png","jpg","jpeg","webp","svg"], type: "image", category: "graphics" },
  { path: "assets/videos",   ext: ["mp4","webm"],            type: "video",  category: "animation" },
];

function humanize(name) {
  const base = name.replace(/\.[^.]+$/, "");
  return base.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/* Вкладка «Мои игры»: данные подтягиваются с itch.io / MyIndie /
   SibGameJam скриптом tools/sync_games.py (GitHub Actions) в data/games.json. */
const GAME_SOURCES = {
  itch: { label: "itch.io" },
  myindie: { label: "MyIndie" },
  sibgamejam: { label: "SibGameJam" },
};
const PLATFORM_LABELS = {
  web: "В браузере", windows: "Windows", linux: "Linux",
  mac: "macOS", android: "Android", ios: "iOS",
};

function gameSourceLabel(src) {
  return (GAME_SOURCES[src] && GAME_SOURCES[src].label) || src;
}
function gamePlatforms(p) {
  return (p.game.platforms || []).map((pl) => PLATFORM_LABELS[pl] || pl);
}
function gameStatsParts(p) {
  const s = p.game.stats;
  if (!s) return [];
  const parts = [];
  if (s.downloads) parts.push("⬇ " + s.downloads);
  if (s.likes != null) parts.push("♥ " + s.likes);
  if (s.views) parts.push("👁 " + s.views);
  if (s.comments) parts.push("💬 " + s.comments);
  return parts;
}
function matchPlayable(g) {
  return (g.platforms || []).includes("web");
}

async function fetchGamesSnapshot() {
  try {
    const res = await fetch("data/games.json", { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn("Не удалось загрузить data/games.json:", e.message);
    return null;
  }
}

function normalizeGames(snap) {
  return (snap.games || []).map((g) => ({
    id: "game-" + g.id,
    title: g.title,
    description: g.description || "",
    category: "games",
    year: g.year || "",
    type: "game",
    game: {
      source: g.source,
      url: g.url,
      cover: g.cover,
      genre: g.genre || "",
      platforms: g.platforms || [],
      stats: g.stats || null,
      badges: g.badges || [],
      jams: g.jams || [],
      game_id: g.game_id || null,
      verified: false,
    },
    auto: true,
    hidden: false,
  }));
}

function isItchConnected() {
  try {
    return !!localStorage.getItem("itch_token");
  } catch (e) {
    return false;
  }
}

function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

function fmtShortDate(s) {
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s).slice(0, 10);
  return d.toLocaleDateString("ru-RU");
}

function accountChip(label, value) {
  const chip = el("span", "gblk-chip");
  const k = el("span", "gblk-chip-k");
  k.textContent = label;
  const v = el("span", "gblk-chip-v");
  v.textContent = value;
  chip.append(k, v);
  return chip;
}

function renderGamesTab() {
  const host = $("#games-strip");
  if (!host) return;
  host.innerHTML = "";
  if (state.activeCategory !== "games") {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  const snap = state.gamesSnapshot;
  const projects = ((state.data && state.data.projects) || []).filter((p) => p.type === "game");

  const bar = el("div", "gs-row");
  const counts = {};
  projects.forEach((p) => { counts[p.game.source] = (counts[p.game.source] || 0) + 1; });
  ["itch", "myindie", "sibgamejam"].forEach((s) => {
    if (!counts[s]) return;
    const pill = el("span", "gs-pill");
    pill.textContent = gameSourceLabel(s) + ": " + counts[s];
    bar.appendChild(pill);
  });
  if (snap && snap.generated_at) {
    const up = el("span", "gs-updated");
    up.textContent = "Обновлено: " + new Date(snap.generated_at).toLocaleString("ru-RU");
    bar.appendChild(up);
  }
  host.appendChild(bar);
  host.appendChild(renderItchControls());

  if (!snap || !projects.length) {
    if (!snap) {
      const pill = el("span", "gs-pill");
      pill.textContent = "Синк данных ещё не выполнен — появится после первого запуска GitHub Actions";
      host.appendChild(pill);
    }
    return;
  }
  ["itch", "myindie", "sibgamejam"].forEach((s) => {
    const group = projects.filter((p) => p.game.source === s);
    if (!group.length) return;
    host.appendChild(renderPlatformBlock(snap, s, group));
  });
}

function renderPlatformBlock(snap, source, projects) {
  const acc = (snap.accounts && snap.accounts[source]) || {};
  const blk = el("section", "gblk");
  blk.id = "gblk-" + source;

  const head = el("div", "gblk-head");
  const ident = el("div", "gblk-ident");
  let avatar;
  if (acc.avatar) {
    avatar = el("img", "gblk-avatar");
    avatar.src = acc.avatar;
    avatar.alt = acc.nickname || source;
  } else {
    avatar = el("div", "gblk-avatar gblk-avatar--text");
    avatar.textContent = (acc.nickname || source || "?").slice(0, 1).toUpperCase();
  }
  ident.appendChild(avatar);
  const info = el("div", "gblk-info");
  const nm = el("div", "gblk-name");
  nm.textContent = (acc.nickname || gameSourceLabel(source)) + " · " + gameSourceLabel(source);
  info.appendChild(nm);
  if (acc.line || acc.username) {
    const alias = el("div", "gblk-alias");
    alias.textContent = acc.line || acc.username;
    info.appendChild(alias);
  }
  ident.appendChild(info);
  head.appendChild(ident);

  const chips = el("div", "gblk-chips");
  if (acc.url) chips.appendChild(accountChip("Профиль", acc.url));
  const counts = acc.counts || {};
  [["games", "Игр"], ["likes", "Лайков"], ["subscribers", "Подписчиков"],
   ["comments", "Комментариев"], ["reviews", "Рецензий"]].forEach(([k, label]) => {
    if (typeof counts[k] === "number") chips.appendChild(accountChip(label, counts[k]));
  });
  if (typeof acc.score === "number") chips.appendChild(accountChip("Балл", "★ " + acc.score));
  if (typeof acc.games_count === "number" && typeof counts.games !== "number") {
    chips.appendChild(accountChip("Игр", acc.games_count));
  }
  if (chips.childElementCount) head.appendChild(chips);
  blk.appendChild(head);

  const gTitle = el("h3", "gblk-subtitle");
  gTitle.textContent = "Игры · " + projects.length;
  blk.appendChild(gTitle);
  const grid = el("div", "gblk-games");
  projects.forEach((p) => grid.appendChild(gameTabCard(p)));
  blk.appendChild(grid);

  const seen = new Map();
  projects.forEach((p) => {
    (p.game.jams || []).forEach((jam) => {
      const key = jam.url || (jam.source + "/" + jam.title);
      if (seen.has(key)) seen.get(key).games.push(p.title);
      else seen.set(key, { jam, games: [p.title] });
    });
  });
  const jTitle = el("h3", "gblk-subtitle");
  jTitle.textContent = "Джемы · " + seen.size;
  blk.appendChild(jTitle);
  const jamsBox = el("div", "gblk-jams");
  if (!seen.size) {
    const empty = el("p", "gblk-empty");
    empty.textContent = "Публичных данных о джемах на этой платформе нет.";
    jamsBox.appendChild(empty);
  } else {
    seen.forEach(({ jam, games }) => jamsBox.appendChild(jamRow(jam, games)));
  }
  blk.appendChild(jamsBox);
  return blk;
}

function jamRow(jam, games) {
  const row = el("div", "jam-row");
  const main = el("div", "jam-main");
  const title = el("a", "jam-title");
  title.textContent = jam.title || jam.slug || "";
  if (jam.url) {
    title.href = jam.url;
    title.target = "_blank";
    title.rel = "noopener";
  }
  const meta = el("div", "jam-meta");
  const parts = [];
  if (jam.level) parts.push("Уровень " + jam.level);
  if (jam.date_start || jam.date_end) parts.push(fmtShortDate(jam.date_start) + " – " + fmtShortDate(jam.date_end || jam.date_start));
  if (typeof jam.entries === "number") parts.push("Заявок: " + jam.entries);
  if (typeof jam.participants === "number") parts.push("Участников: " + jam.participants);
  if (typeof jam.ratings === "number") parts.push("Оценок: " + jam.ratings);
  if (jam.place) parts.push("Место: #" + jam.place);
  if (typeof jam.score === "number") parts.push("Средний балл: " + jam.score);
  meta.textContent = parts.join("  •  ");
  main.append(title, meta);
  row.appendChild(main);
  const chips = el("div", "jam-games");
  games.forEach((t) => {
    const c = el("span", "jam-game");
    c.textContent = t;
    chips.appendChild(c);
  });
  row.appendChild(chips);
  return row;
}

function gameTabCard(p) {
  const g = p.game;
  const card = el("div", "card game-tab-card");
  const media = el("div", "card-media");
  const badge = el("div", "card-badge");
  badge.textContent = "Игра";
  media.appendChild(badge);
  if (g.cover) {
    const img = el("img");
    img.src = g.cover;
    img.alt = p.title;
    img.loading = "lazy";
    media.appendChild(img);
  } else {
    media.style.background = "linear-gradient(135deg,#2a2350,#10302a)";
  }
  const src2 = el("div", "card-source");
  src2.textContent = gameSourceLabel(g.source);
  media.appendChild(src2);
  if (g.verified) {
    const v = el("div", "card-verified");
    v.textContent = "✓ подтверждено";
    media.appendChild(v);
  }
  card.appendChild(media);

  const body = el("div", "card-body");
  const title = el("div", "card-title");
  title.textContent = p.title;
  const desc = el("p", "card-desc");
  const rawDesc = (g.description || "").replace(/\s*\n+/g, " ").trim();
  desc.textContent = rawDesc.length > 120 ? rawDesc.slice(0, 120) + "…" : rawDesc;
  const meta = el("div", "card-year");
  const chips = [];
  if (g.genre) chips.push(g.genre);
  chips.push(...gamePlatforms(p));
  chips.push(...gameStatsParts(p));
  meta.textContent = chips.filter(Boolean).join("  •  ");
  body.append(title, desc, meta);
  if (g.jams && g.jams.length) {
    const jrow = el("div", "card-jams");
    g.jams.forEach((j) => {
      const c = el("span", "jam-chip");
      c.textContent = (j.place ? "#" + j.place + " · " : "") + (j.title || "");
      jrow.appendChild(c);
    });
    body.appendChild(jrow);
  }
  card.appendChild(body);
  card.addEventListener("click", () => openModal(p));
  return card;
}

function renderItchControls() {
  const row = el("div", "gs-row gs-actions");
  const btn = el("button", "gs-btn");
  btn.id = "itch-connect";
  btn.textContent = isItchConnected() ? "itch.io подключён ✓" : "Подключить itch.io";
  btn.addEventListener("click", () => itchOAuth(btn));
  const note = el("span", "gs-note");
  note.id = "itch-note";
  note.textContent = isItchConnected()
    ? "Токен itch.io сохранён в этом браузере — карточки отмечены как подтверждённые."
    : "Подтверждение через твой аккаунт itch.io. OAuth-приложение не обязательно — достаточно API-ключа (Settings → API Keys).";
  const keyWrap = el("div", "gs-keywrap");
  keyWrap.id = "itch-keywrap";
  keyWrap.hidden = true;
  const input = el("input", "gs-key-input");
  input.type = "password";
  input.id = "itch-key-input";
  input.placeholder = "API-ключ itch.io (Settings → API Keys)";
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") saveItchKey(); });
  const save = el("button", "gs-btn gs-btn--sm");
  save.type = "button";
  save.id = "itch-key-save";
  save.textContent = "Сохранить";
  save.addEventListener("click", saveItchKey);
  keyWrap.append(input, save);
  row.append(btn, note, keyWrap);
  return row;
}

function itchOAuth(btn) {
  const cfg = state.data && state.data.games && state.data.games.itch;
  const note = $("#itch-note");
  const keyWrap = $("#itch-keywrap");
  if (!cfg) {
    if (note) note.textContent = "Конфиг games.itch не найден в data/projects.json.";
    return;
  }
  const clientId = (cfg.oauth && cfg.oauth.clientId) || "";
  if (clientId) {
    const redirect = location.origin + location.pathname;
    const url = "https://itch.io/user/oauth?client_id=" + encodeURIComponent(clientId) +
      "&scope=" + encodeURIComponent("profile:games") +
      "&response_type=token&redirect_uri=" + encodeURIComponent(redirect);
    location.href = url;
    return;
  }
  if (keyWrap) keyWrap.hidden = !keyWrap.hidden;
  if (!keyWrap || keyWrap.hidden === false) {
    if (note) {
      note.textContent = "OAuth-приложение пока не настроено. Проще всего: itch.io → Settings → API Keys → скопируй ключ и вставь ниже. ЛИБО создай OAuth-приложение на itch.io/settings/oauth-apps (redirect_uri = " +
        location.origin + location.pathname + ") и впиши clientId в data/projects.json → games.itch.oauth.clientId.";
    }
  }
}

async function saveItchKey() {
  const input = $("#itch-key-input");
  const note = $("#itch-note");
  if (!input) return;
  const token = input.value.trim();
  if (!token) return;
  const games = await fetchItchMyGames(token);
  if (games && games.length) {
    try { localStorage.setItem("itch_token", token); } catch (e) {}
    markItchVerified(games);
    if (note) note.textContent = "Готово: подтверждено " + games.length + " игр itch.io.";
    renderGamesTab();
  } else if (note) {
    note.textContent = "Ключ не подошёл: список игр не получен. Проверь, что это API-ключ из itch.io → Settings → API Keys.";
  }
}

async function fetchItchMyGames(token) {
  try {
    const r = await fetch("https://api.itch.io/profile/games", {
      headers: { Authorization: "Bearer " + token },
    });
    const b = await r.json();
    if (b && Array.isArray(b.games)) return b.games;
  } catch (e) {}
  try {
    const r = await fetch("https://itch.io/api/1/" + token + "/my-games");
    const b = await r.json();
    if (b && Array.isArray(b.games)) return b.games;
  } catch (e) {}
  return [];
}

function markItchVerified(games) {
  const ids = new Set();
  games.forEach((g) => {
    if (typeof g.id !== "undefined") ids.add(String(g.id));
  });
  (state.data.projects || []).forEach((p) => {
    if (p.type === "game" && p.game.source === "itch" && p.game.game_id != null &&
        ids.has(String(p.game.game_id))) {
      p.game.verified = true;
    }
  });
}

async function handleItchToken() {
  let token = null;
  if (location.hash) {
    const m = location.hash.match(/access_token=([^&\s]+)/);
    if (m) {
      token = m[1];
      try { localStorage.setItem("itch_token", token); } catch (e) {}
      try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    }
  }
  if (!token) {
    try { token = localStorage.getItem("itch_token"); } catch (e) {}
  }
  if (!token) return;
  const games = await fetchItchMyGames(token);
  if (games && games.length) {
    markItchVerified(games);
    if (state.data) {
      renderGamesTab();
      renderGallery();
    }
  }
}

async function githubList(owner, repo, branch, path) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GitHub API ${r.status} для ${path}`);
  return r.json();
}

async function loadRenders(modelUrl) {
  const g = state.data && state.data.github;
  if (!g) return [];
  const seg = modelUrl.split("/").pop().split("?")[0];
  const base = seg.replace(/\.[^.]+$/, "");
  const rendersPath = "assets/renders/" + base;
  try {
    const items = await githubList(g.owner, g.repo, g.branch, rendersPath);
    if (!Array.isArray(items)) return [];
    return items
      .filter((it) => /\.(png|jpe?g|webp)$/i.test(it.name))
      .map((it) => assetUrl((g.pagesBase || "") + it.path, it.sha));
  } catch (e) {
    return [];
  }
}

const lightbox = { list: [], idx: 0, zoom: 1, tx: 0, ty: 0, dragging: false, sx: 0, sy: 0, stx: 0, sty: 0 };

function lbImg() { return $("#render-lightbox img"); }

function openLightbox(list, idx) {
  lightbox.list = list;
  lightbox.idx = idx;
  lbReset();
  lbImg().src = list[idx];
  setLightboxCount();
  $("#render-lightbox").hidden = false;
}

function lbReset() { lightbox.zoom = 1; lightbox.tx = 0; lightbox.ty = 0; applyLightbox(); }

function applyLightbox() {
  const img = lbImg();
  if (lightbox.zoom <= 1) { lightbox.tx = 0; lightbox.ty = 0; }
  const lb = $("#render-lightbox");
  const maxTx = Math.max((img.offsetWidth * lightbox.zoom - lb.clientWidth) / 2, 0);
  const maxTy = Math.max((img.offsetHeight * lightbox.zoom - lb.clientHeight) / 2, 0);
  lightbox.tx = Math.max(-maxTx, Math.min(maxTx, lightbox.tx));
  lightbox.ty = Math.max(-maxTy, Math.min(maxTy, lightbox.ty));
  img.style.transform = `translate(${lightbox.tx}px, ${lightbox.ty}px) scale(${lightbox.zoom})`;
}

function setLightboxCount() {
  const el = $("#rl-count");
  if (el) el.textContent = (lightbox.idx + 1) + " / " + lightbox.list.length;
}

function lbStep(d) {
  const n = lightbox.list.length;
  if (!n) return;
  lightbox.idx = (lightbox.idx + d + n) % n;
  lbReset();
  lbImg().src = lightbox.list[lightbox.idx];
  setLightboxCount();
}

function closeLightbox() { $("#render-lightbox").hidden = true; }

async function discover(g) {
  const found = [];
  for (const cfg of SCAN) {
    let items;
    try { items = await githubList(g.owner, g.repo, g.branch, cfg.path); }
    catch (e) { console.warn(e.message); continue; }
    if (!Array.isArray(items)) continue;
    for (const it of items) {
      const ext = (it.name.split(".").pop() || "").toLowerCase();
      if (!cfg.ext.includes(ext)) continue;
      const item = {
        id: it.path,
        title: humanize(it.name),
        category: cfg.category,
        year: new Date().getFullYear(),
        type: cfg.type,
        auto: true,
      };
      // Скрытый раздел: файлы с префиксом "hidden" или в папке /hidden/ видны только по секретному ключу
      if (it.name.toLowerCase().startsWith("hidden") || it.path.toLowerCase().includes("/hidden/")) {
        item.hidden = true;
      }
      item[cfg.type] = assetUrl((g.pagesBase || "") + it.path, it.sha);
      found.push(item);
    }
  }
  return found;
}

async function loadData() {
  const res = await fetch("data/projects.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Не удалось загрузить data/projects.json");
  const data = await res.json();

  // Галерея строится только из файлов репозитория (авто-подтягивание).
  let projects = [];
  if (data.github && data.github.auto) {
    try {
      projects = await discover(data.github);
    } catch (e) {
      console.warn("Авто-подтягивание не сработало:", e.message);
    }
  }
  const snap = await fetchGamesSnapshot();
  state.gamesSnapshot = snap;
  if (snap) {
    try {
      projects = projects.concat(normalizeGames(snap));
    } catch (e) {
      console.warn("Не удалось разобрать data/games.json:", e.message);
    }
  }
  data.projects = projects;
  return data;
}

function isHiddenVisible() {
  const params = new URLSearchParams(location.search);
  const key = params.get("key");
  return key && state.data?.site?.secretKey && key === state.data.site.secretKey;
}

function renderHeader() {
  const s = state.data.site;
  $("#site-title").textContent = s.title;
  document.title = s.title;
  $("#site-subtitle").textContent = s.subtitle;
  $("#footer-author").textContent = "© " + new Date().getFullYear() + " " + s.author;
  $("#intro").innerHTML = state.secretOk
    ? "Добро пожаловать в <b>скрытый раздел</b> — здесь видны черновики и работы, скрытые от зрителей. Чтобы открыть публичную версию, перейди на сайт без параметра <code>?key=</code>."
    : "Портфолио с интерактивными 3D-моделями, живыми шейдерами и анимацией. Кликни по работе, чтобы открыть просмотрщик. Исходные файлы проектов остаются в <b>private/</b> и недоступны зрителям.";
}

function renderFilters() {
  const nav = $("#filters");
  nav.innerHTML = "";
  state.data.categories.forEach((c) => {
    const btn = document.createElement("button");
    btn.className = "filter-btn" + (c.id === state.activeCategory ? " active" : "");
    btn.textContent = c.label;
    btn.addEventListener("click", () => {
      state.activeCategory = c.id;
      renderFilters();
      renderGallery();
    });
    nav.appendChild(btn);
  });
}

function visibleProjects() {
  return state.data.projects.filter((p) => {
    if (p.hidden && !state.secretOk) return false;
    if (p.type === "game" && state.activeCategory !== "games") return false;
    if (state.activeCategory !== "all" && p.category !== state.activeCategory) return false;
    return true;
  });
}

function categoryLabel(id) {
  const c = state.data.categories.find((x) => x.id === id);
  return c ? c.label : id;
}

function makeCardMedia(p) {
  const media = document.createElement("div");
  media.className = "card-media";

  const badge = document.createElement("div");
  badge.className = "card-badge";
  badge.textContent = categoryLabel(p.category);
  media.appendChild(badge);

  if (p.type === "shader") {
    const live = document.createElement("div");
    live.className = "card-live";
    live.textContent = "LIVE";
    media.appendChild(live);
    const cv = document.createElement("canvas");
    media.appendChild(cv);
    cv.__kind = "shader";
    cv.__shader = p.shader;
    lazy.observe(cv);
  } else if (p.type === "image") {
    if (p.image) {
      const img = document.createElement("img");
      img.src = p.image;
      img.alt = p.title;
      media.appendChild(img);
    } else {
      media.style.background = "linear-gradient(135deg,#2a2350,#102a2a)";
    }
  } else if (p.type === "video") {
    if (p.video) {
      const v = document.createElement("video");
      v.src = p.video; v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
      media.appendChild(v);
    } else {
      media.style.background = "linear-gradient(135deg,#1a2a50,#2a1030)";
    }
  } else if (p.type === "game") {
    if (p.game.cover) {
      const img = document.createElement("img");
      img.src = p.game.cover;
      img.alt = p.title;
      img.loading = "lazy";
      media.appendChild(img);
    } else {
      media.style.background = "linear-gradient(135deg,#2a2350,#10302a)";
    }
    const src = document.createElement("div");
    src.className = "card-source";
    src.textContent = gameSourceLabel(p.game.source);
    media.appendChild(src);
    if (p.game.verified) {
      const v = document.createElement("div");
      v.className = "card-verified";
      v.textContent = "✓ подтверждено";
      media.appendChild(v);
    }
  } else {
    // model / default -> lazy single thumbnail render
    media.style.background =
      "radial-gradient(circle at 50% 40%, rgba(124,92,255,0.25), #07070c 70%)";
    const cv = document.createElement("canvas");
    media.appendChild(cv);
    cv.__lazy = () => renderModelThumbnail(cv, p.model);
    lazy.observe(cv);
  }
  return media;
}

function renderGallery() {
  const gallery = $("#gallery");
  gallery.querySelectorAll("canvas").forEach((c) => lazy.unobserve(c));
  cardViewers.forEach((v) => v.dispose && v.dispose());
  cardViewers.length = 0;
  gallery.innerHTML = "";
  gallery.hidden = false;
  renderGamesTab();
  if (state.activeCategory === "games") {
    gallery.hidden = true;
    return;
  }
  const projects = visibleProjects();
  if (!projects.length) {
    gallery.innerHTML = '<p style="color:var(--muted)">Нет работ в этой категории.</p>';
    return;
  }
  projects.forEach((p) => {
    const card = document.createElement("div");
    card.className = "card";

    card.appendChild(makeCardMedia(p));

    const body = document.createElement("div");
    body.className = "card-body";
    const title = document.createElement("div");
    title.className = "card-title";
    title.innerHTML = p.title + (p.hidden ? '<span class="hidden-flag">скрыто</span>' : "");
    const desc = document.createElement("p");
    desc.className = "card-desc";
    desc.textContent = p.description || "";
    const year = document.createElement("div");
    year.className = "card-year";
    if (p.type === "game") {
      const meta = [];
      if (p.game.genre) meta.push(p.game.genre);
      meta.push(...gamePlatforms(p));
      meta.push(...gameStatsParts(p));
      year.textContent = meta.filter(Boolean).join("  •  ");
    } else {
      year.textContent = p.year || "";
    }
    body.append(title, desc, year);
    card.appendChild(body);

    card.addEventListener("click", () => openModal(p));
    gallery.appendChild(card);
  });
}

function openModal(p) {
  const modal = $("#modal");
  $("#modal-title").textContent = p.title;
  $("#modal-desc").textContent = p.description || "";
  $("#modal-links").innerHTML = "";

  let metaParts = [categoryLabel(p.category), "Игра", p.year].filter(Boolean);
  if (p.type === "game") {
    const mm = [];
    if (p.game.genre) mm.push(p.game.genre);
    mm.push(gamePlatforms(p).join(", "));
    mm.push(...gameStatsParts(p));
    if (mm.filter(Boolean).length) metaParts.push(mm.filter(Boolean).join(" • "));
  } else if (p.category !== "games") {
    metaParts = [categoryLabel(p.category), p.year, p.type].filter(Boolean);
  }
  $("#modal-meta").textContent = metaParts.join("  •  ");

  const stage = $("#modal-stage");
  stage.innerHTML = "";
  $("#modal-renders").innerHTML = "";
  $("#modal-renders").style.display = "none";
  $("#render-lightbox").hidden = true;

  if (state.currentViewer && state.currentViewer.dispose) {
    state.currentViewer.dispose();
    state.currentViewer = null;
  }

  if (p.type === "model") {
    state.currentViewer = openModelViewer(stage, p.model, { withControls: true });
    loadRenders(p.model).then((urls) => {
      const strip = $("#modal-renders");
      strip.innerHTML = "";
      if (!urls.length) { strip.style.display = "none"; return; }
      const label = document.createElement("div");
      label.className = "label";
      label.textContent = "Рендеры модели";
      strip.appendChild(label);
      urls.forEach((u, i) => {
        const img = document.createElement("img");
        img.src = u;
        img.alt = p.title + " render";
        img.addEventListener("click", () => openLightbox(urls, i));
        strip.appendChild(img);
      });
      strip.style.display = "flex";
    });
  } else if (p.type === "shader") {
    const cv = document.createElement("canvas");
    cv.style.cssText = "width:100%;height:100%;display:block;";
    stage.appendChild(cv);
    state.currentViewer = openShaderViewer(cv, p.shader, { small: false, withControls: true });
  } else if (p.type === "image") {
    const img = document.createElement("img");
    img.src = p.image; img.style.cssText = "width:100%;height:100%;object-fit:contain;";
    stage.appendChild(img);
  } else if (p.type === "video") {
    const v = document.createElement("video");
    v.src = p.video; v.controls = true; v.autoplay = true; v.style.cssText = "width:100%;height:100%;";
    stage.appendChild(v);
  } else if (p.type === "game") {
    const img = document.createElement("img");
    img.src = p.game.cover || "";
    img.alt = p.title;
    img.style.cssText = "width:100%;max-height:100%;object-fit:cover;object-position:top;";
    stage.appendChild(img);
    if (p.game.url) {
      const links = $("#modal-links");
      const a = document.createElement("a");
      a.className = "game-link-btn";
      a.href = p.game.url;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = matchPlayable(p.game) ? "Играть на " + gameSourceLabel(p.game.source)
                                            : "Открыть на " + gameSourceLabel(p.game.source);
      links.appendChild(a);
    }
    const mj = $("#modal-jams");
    mj.innerHTML = "";
    if (p.game.jams && p.game.jams.length) {
      const label = el("div", "label");
      label.textContent = "Джемы";
      mj.appendChild(label);
      const list = el("div", "modal-jams-list");
      p.game.jams.forEach((j) => list.appendChild(jamRow(j, [p.title])));
      mj.appendChild(list);
      mj.hidden = false;
    } else {
      mj.hidden = true;
    }
  }

  modal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeModal() {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
  const modal = $("#modal");
  modal.hidden = true;
  document.body.style.overflow = "";
  if (state.currentViewer && state.currentViewer.dispose) {
    state.currentViewer.dispose();
    state.currentViewer = null;
  }
  $("#modal-stage").innerHTML = "";
  $("#render-lightbox").hidden = true;
  $("#modal-jams").hidden = true;
}

function init() {
  loadData()
    .then((data) => {
      state.data = data;
      state.secretOk = isHiddenVisible();
      const cat = new URLSearchParams(location.search).get("cat");
      if (cat && data.categories.some((c) => c.id === cat)) state.activeCategory = cat;
      handleItchToken();
      renderHeader();
      renderFilters();
      renderGallery();
      mountBackground($("#bg-canvas"));
    })
    .catch((err) => {
      document.querySelector("main").innerHTML =
        '<p style="padding:40px 6vw;color:#ff8080">Ошибка: ' + err.message +
        "<br>Убедись, что сайт открыт через http:// (локальный сервер), а не file://</p>";
    });

  document.querySelectorAll("[data-close]").forEach((el) =>
    el.addEventListener("click", closeModal)
  );
  const lb = $("#render-lightbox");
  const lbNavPrev = document.createElement("button");
  lbNavPrev.className = "rl-nav prev";
  lbNavPrev.textContent = "‹";
  lbNavPrev.setAttribute("aria-label", "Предыдущий рендер");
  const lbNavNext = document.createElement("button");
  lbNavNext.className = "rl-nav next";
  lbNavNext.textContent = "›";
  lbNavNext.setAttribute("aria-label", "Следующий рендер");
  const lbClose = document.createElement("button");
  lbClose.className = "rl-close";
  lbClose.textContent = "×";
  lbClose.setAttribute("aria-label", "Закрыть просмотр");
  const lbCount = document.createElement("div");
  lbCount.className = "rl-count";
  lbCount.id = "rl-count";
  lbNavPrev.addEventListener("click", (e) => { e.stopPropagation(); lbStep(-1); });
  lbNavNext.addEventListener("click", (e) => { e.stopPropagation(); lbStep(1); });
  lbClose.addEventListener("click", (e) => { e.stopPropagation(); closeLightbox(); });
  lb.append(lbNavPrev, lbNavNext, lbClose, lbCount);

  const lbUrl = lb.querySelector("img");
  lbUrl.addEventListener("dblclick", lbReset);
  lbUrl.addEventListener("wheel", (e) => {
    e.preventDefault();
    const prev = lightbox.zoom;
    lightbox.zoom = Math.min(8, Math.max(1, prev * (e.deltaY < 0 ? 1.12 : 0.9)));
    const k = lightbox.zoom / prev;
    const cx = lb.clientWidth / 2, cy = lb.clientHeight / 2;
    const rx = e.clientX - cx - lightbox.tx;
    const ry = e.clientY - cy - lightbox.ty;
    lightbox.tx = e.clientX - cx - rx * k;
    lightbox.ty = e.clientY - cy - ry * k;
    applyLightbox();
  }, { passive: false });
  lbUrl.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    lightbox.dragging = true;
    lightbox.sx = e.clientX; lightbox.sy = e.clientY;
    lightbox.stx = lightbox.tx; lightbox.sty = lightbox.ty;
    lbUrl.setPointerCapture(e.pointerId);
  });
  lbUrl.addEventListener("pointermove", (e) => {
    if (!lightbox.dragging) return;
    lightbox.tx = lightbox.stx + (e.clientX - lightbox.sx);
    lightbox.ty = lightbox.sty + (e.clientY - lightbox.sy);
    applyLightbox();
  });
  ["pointerup", "pointercancel"].forEach((ev) =>
    lbUrl.addEventListener(ev, () => { lightbox.dragging = false; })
  );

  lb.addEventListener("click", (e) => { if (e.target === lb) closeLightbox(); });

  document.addEventListener("keydown", (e) => {
    const lbOpen = !$("#render-lightbox").hidden;
    if (e.key === "Escape") {
      if (lbOpen) closeLightbox();
      else closeModal();
    } else if (lbOpen && e.key === "ArrowLeft") lbStep(-1);
    else if (lbOpen && e.key === "ArrowRight") lbStep(1);
  });
}

init();
