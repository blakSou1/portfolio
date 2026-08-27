import { openModelViewer, openShaderViewer, mountBackground } from "./viewer.js";

const state = {
  data: null,
  activeCategory: "all",
  secretOk: false,
  currentViewer: null,
};

const $ = (sel) => document.querySelector(sel);

const SCAN = [
  { path: "assets/models",   ext: ["glb", "gltf"],           type: "model",  category: "modeling" },
  { path: "assets/shaders",  ext: ["frag"],                  type: "shader", category: "shaders" },
  { path: "assets/previews", ext: ["png","jpg","jpeg","webp","svg"], type: "image", category: "graphics" },
  { path: "assets/videos",   ext: ["mp4","webm"],            type: "video",  category: "animation" },
];

function humanize(name) {
  const base = name.replace(/\.[^.]+$/, "");
  return base.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

async function githubList(owner, repo, branch, path) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GitHub API ${r.status} для ${path}`);
  return r.json();
}

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
      item[cfg.type] = it.download_url;
      found.push(item);
    }
  }
  return found;
}

async function loadData() {
  const res = await fetch("data/projects.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Не удалось загрузить data/projects.json");
  const data = await res.json();

  let projects = (data.projects || []).map((p) => ({ ...p }));

  if (data.github && data.github.auto) {
    try {
      const auto = await discover(data.github);
      const known = new Set(
        projects.flatMap((p) => [p.model, p.shader, p.image, p.video].filter(Boolean))
      );
      for (const a of auto) {
        if (known.has(a[a.type])) continue;
        const ov = projects.find((p) => p.file === a.id || p.file === a.title);
        projects.push(ov ? { ...a, ...ov } : a);
      }
    } catch (e) {
      console.warn("Авто-подтягивание не сработало:", e.message);
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
    requestAnimationFrame(() => openShaderViewer(cv, p.shader, { small: true }));
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
  } else {
    // model / default
    media.style.background =
      "radial-gradient(circle at 50% 40%, rgba(124,92,255,0.25), #07070c 70%)";
  }
  return media;
}

function renderGallery() {
  const gallery = $("#gallery");
  gallery.innerHTML = "";
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
    year.textContent = p.year || "";
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
  $("#modal-meta").textContent =
    [categoryLabel(p.category), p.year, p.type].filter(Boolean).join("  •  ");

  const stage = $("#modal-stage");
  stage.innerHTML = "";

  if (state.currentViewer && state.currentViewer.dispose) {
    state.currentViewer.dispose();
    state.currentViewer = null;
  }

  if (p.type === "model") {
    state.currentViewer = openModelViewer(stage, p.model, { withControls: true });
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
  }

  modal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeModal() {
  const modal = $("#modal");
  modal.hidden = true;
  document.body.style.overflow = "";
  if (state.currentViewer && state.currentViewer.dispose) {
    state.currentViewer.dispose();
    state.currentViewer = null;
  }
  $("#modal-stage").innerHTML = "";
}

function init() {
  loadData()
    .then((data) => {
      state.data = data;
      state.secretOk = isHiddenVisible();
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
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
}

init();
