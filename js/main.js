import { openModelViewer, openShaderViewer, mountBackground, renderModelThumbnail } from "./viewer.js?v=20260905b";

// GitHub Pages ставит долгий cache-control на статику. Чтобы браузер НЕ хранил
// старые файлы, к URL подставляем "v". Для ассетов (модели, рендеры) берём blob-SHA
// файла из GitHub API: перезалил файл → sha сменился → URL новый → кэш не мешает.
// Остальным файлам хватает статической версии ниже.
const ASSET_VERSION = "20260905b";

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
