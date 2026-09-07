import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/* ---------- Control panel helper ---------- */
function panel(stage, title) {
  const c = document.createElement("div");
  c.className = "vp-controls";
  if (title) {
    const t = document.createElement("div");
    t.className = "vp-title";
    t.textContent = title;
    c.appendChild(t);
  }
  stage.appendChild(c);
  return {
    el: c,
    btn(label, onClick, active = false) {
      const b = document.createElement("button");
      b.className = "vp-btn" + (active ? " active" : "");
      b.textContent = label;
      if (onClick) b.addEventListener("click", () => onClick(b));
      c.appendChild(b);
      return b;
    },
    slider(label, min, max, val, onInput) {
      const w = document.createElement("label");
      w.className = "vp-slider";
      const s = document.createElement("input");
      s.type = "range"; s.min = min; s.max = max;
      s.step = (max - min) / 200; s.value = val;
      const t = document.createElement("span");
      t.textContent = label;
      const v = document.createElement("em");
      v.textContent = val.toFixed(2);
      s.addEventListener("input", () => {
        const n = parseFloat(s.value);
        v.textContent = n.toFixed(2);
        onInput(n);
      });
      w.append(t, s, v);
      c.appendChild(w);
      return s;
    },
    select(label, options, onChange, current) {
      const w = document.createElement("label");
      w.className = "vp-select";
      const s = document.createElement("select");
      options.forEach((o) => {
        const op = document.createElement("option");
        op.value = o; op.textContent = o;
        s.appendChild(op);
      });
      if (current) s.value = current;
      const t = document.createElement("span");
      t.textContent = label;
      s.addEventListener("change", () => onChange(s.value));
      w.append(t, s);
      c.appendChild(w);
      return s;
    },
  };
}

/* ---------- Procedural studio environment (Sketchfab-like) ---------- */
function makeEnv(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  // Создаём процедурную сцену-окружение с мягким студийным светом
  const envScene = new THREE.Scene();

  // Тёплый верхний свет (key light)
  const keyGeo = new THREE.SphereGeometry(1, 16, 16);
  const keyMat = new THREE.MeshBasicMaterial({ color: 0xfff0dd });
  const keyLight = new THREE.Mesh(keyGeo, keyMat);
  keyLight.scale.set(20, 1, 20);
  keyLight.position.set(5, 10, 5);
  envScene.add(keyLight);

  // Холодный боковой свет (fill)
  const fillMat = new THREE.MeshBasicMaterial({ color: 0xc8d8f0 });
  const fillLight = new THREE.Mesh(keyGeo.clone(), fillMat);
  fillLight.scale.set(16, 1, 16);
  fillLight.position.set(-8, 4, -3);
  envScene.add(fillLight);

  // Мягкий задний свет (rim)
  const rimMat = new THREE.MeshBasicMaterial({ color: 0xe8e0f0 });
  const rimLight = new THREE.Mesh(keyGeo.clone(), rimMat);
  rimLight.scale.set(14, 1, 14);
  rimLight.position.set(-2, 6, -10);
  envScene.add(rimLight);

  // Нижний отражённый свет (bounce)
  const bounceMat = new THREE.MeshBasicMaterial({ color: 0x222230 });
  const bounce = new THREE.Mesh(keyGeo.clone(), bounceMat);
  bounce.scale.set(40, 1, 40);
  bounce.position.set(0, -6, 0);
  envScene.add(bounce);

  const envTexture = pmrem.fromScene(envScene, 0.04).texture;
  pmrem.dispose();
  return envTexture;
}

/* ---------- Post-load material fixup for FBX ---------- */
function fixFbxMaterials(model) {
  model.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    o.material = mats.map((m) => {
      if (!m) return m;
      // MeshBasicMaterial → MeshStandardMaterial
      if (m.isMeshBasicMaterial) {
        const fixed = new THREE.MeshStandardMaterial({
          color: m.color.clone(),
          map: m.map,
          side: THREE.DoubleSide,
          roughness: 0.55,
          metalness: 0.1,
        });
        return fixed;
      }
      // MeshPhongMaterial / MeshLambertMaterial → MeshStandardMaterial (PBR)
      if (m.isMeshPhongMaterial || m.isMeshLambertMaterial) {
        const fixed = new THREE.MeshStandardMaterial({
          color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
          map: m.map || null,
          side: THREE.DoubleSide,
          roughness: 0.55,
          metalness: 0.15,
          transparent: m.transparent,
          opacity: m.opacity,
          emissive: m.emissive ? m.emissive.clone() : new THREE.Color(0x000000),
          emissiveMap: m.emissiveMap || null,
          emissiveIntensity: m.emissiveIntensity !== undefined ? m.emissiveIntensity : 1,
          normalMap: m.normalMap || null,
          normalScale: m.normalScale ? m.normalScale.clone() : new THREE.Vector2(1, 1),
          alphaMap: m.alphaMap || null,
          vertexColors: !!m.vertexColors,
        });
        return fixed;
      }
      // Убедимся что roughness/metalness адекватные
      if (m.isMeshStandardMaterial) {
        if (m.roughness === 0 && m.metalness === 0) {
          // Похоже на дефолтный FBX материал — дадим разумные PBR-свойства
          m.roughness = 0.55;
          m.metalness = 0.1;
        }
        // Если color слишком тёмный — осветлим
        const hsl = {};
        m.color.getHSL(hsl);
        if (hsl.l < 0.05) {
          m.color.setHSL(hsl.h, hsl.s, 0.15);
        }
        m.side = THREE.DoubleSide;
        m.needsUpdate = true;
      }
      return m;
    });
  });
}

// Камера по умолчанию: смотрим вдоль наименьшего размера модели, чтобы
// показать её самую «широкую» сторону (а не узкий профиль).
function defaultViewDir(size, elev = 0.35) {
  const v = size.x <= size.y && size.x <= size.z
    ? new THREE.Vector3(1, elev, 0)
    : new THREE.Vector3(0, elev, 1);
  return v.normalize();
}

function pickLoader(url) {
  const ext = url.split("?")[0].toLowerCase().split(".").pop();
  return ext === "fbx" ? new FBXLoader() : new GLTFLoader();
}

/* ---------- Side texture discovery (color_<model>.png etc.) ---------- */
const SIDE_TEX_SLOTS = {
  map: ["color", "diffuse", "albedo", "basecolor"],
  metalnessMap: ["metal", "metalic", "metallic", "metalness"],
  roughnessMap: ["rough", "roughness", "gloss"],
  normalMap: ["normal", "nrm", "bump"],
  aoMap: ["ao", "occlusion"],
  emissiveMap: ["emissive", "glow"],
};
const SIDE_TEX_LOADER = new THREE.TextureLoader();

function sideTexCandidates(modelUrl) {
  const path = modelUrl.split("?")[0];
  const dir = path.substring(0, path.lastIndexOf("/") + 1);
  const stem = path.split("/").pop().toLowerCase().replace(/\.[^.]+$/, "");
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const qs = modelUrl.indexOf("?") >= 0 ? "?" + modelUrl.split("?")[1] : "";
  const out = {};
  Object.keys(SIDE_TEX_SLOTS).forEach((slot) => {
    const names = [];
    SIDE_TEX_SLOTS[slot].forEach((p) => {
      names.push(p + cap(stem), p + "_" + stem, p + "-" + stem);
    });
    out[slot] = names.map((n) => dir + n + ".png" + qs);
  });
  return out;
}

function fetchFirstTex(urls, sink) {
  let i = 0;
  const next = () => {
    if (i >= urls.length) return sink && sink(null);
    SIDE_TEX_LOADER.load(urls[i++], (t) => sink && sink(t), undefined, next);
  };
  next();
}

function loadSideTextures(modelUrl, model, onDone) {
  const isFbx = modelUrl.split("?")[0].toLowerCase().endsWith(".fbx");
  const slots = isFbx ? sideTexCandidates(modelUrl) : {};
  const keys = Object.keys(slots);
  if (!keys.length) return onDone && onDone();
  const applied = {};
  let pending = keys.length;
  keys.forEach((slot) => {
    fetchFirstTex(slots[slot], (tex) => {
      if (tex) applied[slot] = tex;
      if (--pending > 0) return;
      if (Object.keys(applied).length) {
        model.traverse((o) => {
          if (!o.isMesh) return;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => {
            if (!m) return;
            if (applied.map) {
              applied.map.colorSpace = THREE.SRGBColorSpace;
              m.map = applied.map;
              if (m.color) m.color.set(0xffffff);
            }
            if (applied.metalnessMap) {
              applied.metalnessMap.colorSpace = THREE.LinearSRGBColorSpace;
              m.metalnessMap = applied.metalnessMap;
              m.metalness = 1;
              if (m.envMapIntensity !== undefined) m.envMapIntensity = 1;
            }
            if (applied.roughnessMap) {
              applied.roughnessMap.colorSpace = THREE.LinearSRGBColorSpace;
              m.roughnessMap = applied.roughnessMap;
            } else if (applied.metalnessMap && m.isMeshStandardMaterial) {
              m.roughness = 0.4;
            }
            if (applied.normalMap) {
              applied.normalMap.colorSpace = THREE.LinearSRGBColorSpace;
              m.normalMap = applied.normalMap;
              if (!m.normalScale) m.normalScale = new THREE.Vector2(1, 1);
              m.normalScale.set(1, 1);
            }
            if (applied.aoMap) {
              applied.aoMap.colorSpace = THREE.LinearSRGBColorSpace;
              m.aoMap = applied.aoMap;
              if (!m.aoMapIntensity) m.aoMapIntensity = 1;
            }
            if (applied.emissiveMap) {
              applied.emissiveMap.colorSpace = THREE.SRGBColorSpace;
              m.emissiveMap = applied.emissiveMap;
              if (m.emissive) m.emissive.set(0xffffff);
            }
            if (m.needsUpdate !== undefined) m.needsUpdate = true;
          });
        });
      }
      onDone && onDone();
    });
  });
}

/* ---------- Meshes with mirrored scale (determinant < 0) render inside-out ---------- */
function applyMirrorSide(model) {
  model.updateMatrixWorld(true);
  model.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.matrixWorld.elements;
    const det = m[0]*(m[5]*m[10]-m[6]*m[9]) - m[1]*(m[4]*m[10]-m[6]*m[8]) + m[2]*(m[4]*m[9]-m[5]*m[8]);
    if (det < 0) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((mat) => { if (mat) mat.side = THREE.DoubleSide; });
    }
  });
}

/* ---------- Model thumbnail for gallery cards (single render, then frees GPU) ---------- */
export function renderModelThumbnail(canvas, modelUrl) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch (e) {
    return;
  }
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.environment = makeEnv(renderer);
  const ambient = new THREE.HemisphereLight(0xd0d0e0, 0x1a1a2e, 1.0); scene.add(ambient);
  const key = new THREE.DirectionalLight(0xfff8f0, 3.0);
  key.position.set(5, 8, 6); scene.add(key);
  const fill = new THREE.DirectionalLight(0xe0e8ff, 1.3);
  fill.position.set(-5, 4, -3); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 1.5);
  rim.position.set(-3, 6, -6); scene.add(rim);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);

  const w = canvas.clientWidth || 300, h = canvas.clientHeight || 200;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  pickLoader(modelUrl).load(
    modelUrl,
    (res) => {
      const model = res.scene || res;
      if (modelUrl.split("?")[0].toLowerCase().endsWith(".fbx")) fixFbxMaterials(model);
      scene.add(model);
      applyMirrorSide(model);
      const box = new THREE.Box3().setFromObject(model);
      const cc = box.getCenter(new THREE.Vector3());
      const s = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(s.x, s.y, s.z) || 2;
      const dist = (maxDim / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.25;
      camera.position.copy(cc).addScaledVector(defaultViewDir(s), dist);
      camera.near = Math.max(dist / 1000, 0.001);
      camera.far = dist * 4 + maxDim;
      camera.updateProjectionMatrix();
      camera.lookAt(cc);

      const present = () => {
        try {
          const copy = document.createElement("canvas");
          copy.width = canvas.width;
          copy.height = canvas.height;
          copy.getContext("2d").drawImage(canvas, 0, 0);
          copy.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;";
          if (canvas.parentNode) canvas.parentNode.replaceChild(copy, canvas);
        } catch (e) { /* keep webgl canvas if copy fails */ }
        try { renderer.dispose(); renderer.forceContextLoss(); } catch (e) {}
      };

      loadSideTextures(modelUrl, model, () => {
        renderer.render(scene, camera);
        present();
      });
    },
    undefined,
    () => { /* keep gradient fallback behind canvas */ }
  );
}

/* ---------- Animated background ---------- */
export function mountBackground(container) {
  const canvas = document.createElement("canvas");
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  let w, h, raf;
  const blobs = Array.from({ length: 5 }, () => ({
    x: Math.random(), y: Math.random(),
    vx: (Math.random() - 0.5) * 0.0006, vy: (Math.random() - 0.5) * 0.0006,
    r: 200 + Math.random() * 260,
    c: Math.random() > 0.5 ? "124,92,255" : "0,224,198",
  }));
  function resize() {
    w = canvas.width = container.clientWidth;
    h = canvas.height = container.clientHeight;
  }
  resize();
  window.addEventListener("resize", resize);
  function loop() {
    ctx.clearRect(0, 0, w, h);
    for (const b of blobs) {
      b.x += b.vx; b.y += b.vy;
      if (b.x < -0.2 || b.x > 1.2) b.vx *= -1;
      if (b.y < -0.2 || b.y > 1.2) b.vy *= -1;
      const g = ctx.createRadialGradient(b.x * w, b.y * h, 0, b.x * w, b.y * h, b.r);
      g.addColorStop(0, `rgba(${b.c},0.10)`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
    raf = requestAnimationFrame(loop);
  }
  loop();
  return { dispose() { cancelAnimationFrame(raf); } };
}

/* ---------- Shader viewer (raw WebGL1) ---------- */
const DEFAULT_FRAG = `
precision highp float;
uniform float u_time;
uniform vec2 u_resolution;
void main(){
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec3 col = 0.5 + 0.5 * cos(u_time * 0.5 + uv.xyx * 6.0 + vec3(0.0, 2.0, 4.0));
  gl_FragColor = vec4(col, 1.0);
}`;

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p,0.0,1.0); }`;

export function openShaderViewer(canvas, fragUrl, opts = {}) {
  const small = !!opts.small;
  const withControls = !!opts.withControls;
  const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
  if (!gl) return { dispose() {} };

  const prog = gl.createProgram();
  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, VERT); gl.compileShader(vs); gl.attachShader(prog, vs);

  let fragSrc = DEFAULT_FRAG;
  if (fragUrl) {
    fetch(fragUrl).then((r) => r.text()).then((t) => { fragSrc = t; rebuild(); })
      .catch(() => {});
  }

  const uni = { u_time: null, u_resolution: null, u_a: null, u_b: null, u_c: null };
  let fsShader = buildFrag(fragSrc);
  gl.attachShader(prog, fsShader);
  gl.linkProgram(prog);
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  function buildFrag(src) {
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, src); gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      console.warn("Shader error:", gl.getShaderInfoLog(fs));
      return null;
    }
    return fs;
  }
  function rebuild() {
    const nf = buildFrag(fragSrc);
    if (!nf) return;
    gl.detachShader(prog, fsShader);
    fsShader = nf;
    gl.attachShader(prog, fsShader);
    gl.linkProgram(prog);
    gl.useProgram(prog);
    uni.u_time = gl.getUniformLocation(prog, "u_time");
    uni.u_resolution = gl.getUniformLocation(prog, "u_resolution");
    uni.u_a = gl.getUniformLocation(prog, "u_a");
    uni.u_b = gl.getUniformLocation(prog, "u_b");
    uni.u_c = gl.getUniformLocation(prog, "u_c");
  }
  rebuild();

  let raf, dead = false, visible = true, shaderOn = true;
  let timeScale = 1, paramA = 0.5, paramB = 0.5, paramC = 0.5;
  const start = performance.now();
  let elapsed = 0, last = start, playing = true;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, small ? 1 : 2);
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  function loop() {
    raf = requestAnimationFrame(loop);
    if (dead) return;
    const now = performance.now();
    if (!visible) { last = now; return; }
    if (shaderOn && playing) {
      elapsed += (now - last) * timeScale;
      gl.uniform1f(uni.u_time, elapsed / 1000);
      gl.uniform2f(uni.u_resolution, canvas.width, canvas.height);
      gl.uniform1f(uni.u_a, paramA);
      gl.uniform1f(uni.u_b, paramB);
      gl.uniform1f(uni.u_c, paramC);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else if (!shaderOn) {
      gl.clearColor(0.04, 0.04, 0.06, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    last = now;
  }
  loop();

  if (withControls) {
    const p = panel(canvas.parentElement, "Шейдер");
    const playBtn = p.btn("⏸", null, true);
    playBtn.addEventListener("click", () => {
      playing = !playing;
      last = performance.now();
      playBtn.textContent = playing ? "⏸" : "▶";
      playBtn.classList.toggle("active", playing);
    });
    const shBtn = p.btn("Shader", null, true);
    shBtn.addEventListener("click", () => {
      shaderOn = !shaderOn;
      shBtn.classList.toggle("active", shaderOn);
      shBtn.textContent = shaderOn ? "Shader" : "Off";
    });
    p.slider("Speed", 0, 3, 1, (v) => (timeScale = v));
    p.slider("A", 0, 1, 0.5, (v) => (paramA = v));
    p.slider("B", 0, 1, 0.5, (v) => (paramB = v));
    p.slider("C", 0, 1, 0.5, (v) => (paramC = v));
  }

  return {
    dispose() { dead = true; cancelAnimationFrame(raf); ro.disconnect(); },
    setVisible(v) { visible = v; },
  };
}

/* ---------- Model viewer (Three.js) ---------- */
export function openModelViewer(stage, modelUrl, opts = {}) {
  const withControls = !!opts.withControls;
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 1, 4);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  renderer.setClearColor(0x000000, 0);
  scene.environment = makeEnv(renderer);
  stage.appendChild(renderer.domElement);

  // Sketchfab-like 4-light studio setup
  const ambient = new THREE.HemisphereLight(0xd0d0e0, 0x1a1a2e, 1.0); scene.add(ambient);
  const key = new THREE.DirectionalLight(0xfff8f0, 3.0);
  key.position.set(5, 8, 6); scene.add(key);
  const fill = new THREE.DirectionalLight(0xe0e8ff, 1.3);
  fill.position.set(-5, 4, -3); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 1.5);
  rim.position.set(-3, 6, -6); scene.add(rim);
  const bottom = new THREE.DirectionalLight(0x303040, 0.5);
  bottom.position.set(0, -4, 2); scene.add(bottom);
  const sceneLights = [ambient, key, fill, rim, bottom];

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.35;
  controls.rotateSpeed = 0.6;
  controls.autoRotate = false;
  controls.autoRotateSpeed = 1.2;
  controls.enablePan = true;
  // Вращение — по зажатой средней кнопке (колесо), зум — колесо, сдвиг — ЛКМ.
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.PAN,
    MIDDLE: THREE.MOUSE.ROTATE,
    RIGHT: THREE.MOUSE.PAN,
  };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

  // Не даём браузеру включить нативный автоскролл/выделение при зажатой
  // кнопке над холстом (иначе СКМ-вращение и ЛКМ-сдвиг крутят страницу).
  renderer.domElement.addEventListener("mousedown", (e) => {
    if (e.button === 0 || e.button === 1 || e.button === 2) e.preventDefault();
  });
  renderer.domElement.addEventListener("dragstart", (e) => e.preventDefault());

  const loading = document.createElement("div");
  loading.className = "sf-loading";
  loading.innerHTML = '<div class="spinner"></div>';
  stage.appendChild(loading);
  const stopLoading = () => loading.remove();

  const hint = document.createElement("div");
  hint.className = "sf-hint";
  hint.textContent = "СКМ — вращать · колесо — масштаб · ЛКМ — сдвиг";
  stage.appendChild(hint);

  const fsBtn = document.createElement("button");
  fsBtn.className = "sf-fs";
  fsBtn.textContent = "⤢";
  fsBtn.title = "Во весь экран";
  fsBtn.addEventListener("click", () => {
    const box = stage.closest(".modal-body") || stage;
    if (document.fullscreenElement) document.exitFullscreen();
    else box.requestFullscreen && box.requestFullscreen();
  });
  stage.appendChild(fsBtn);

  let mixer = null, clock = new THREE.Clock();
  let actions = [], current = null, grid = null;
  let raf;
  const homePos = new THREE.Vector3(0, 1, 4);
  const homeTarget = new THREE.Vector3(0, 0, 0);

  // Режимы отображения (левая панель)
  let modelMeshes = [];
  let facesOn = false;
  let showMats = true;
  let grayMats = true;
  let lightsOn = true;
  let flatMaterial = null;

  if (modelUrl.split("?")[0].toLowerCase().endsWith(".blend")) {
    const txt = document.createElement("div");
    txt.style.cssText = "color:#ffb454;padding:24px;font-family:var(--mono);line-height:1.6;";
    txt.innerHTML = "Blender (.blend) нельзя открыть прямо в браузере.<br>" +
      "Экспортируй файл из Blender: <b>File → Export → glTF Binary (.glb)</b> " +
      "или <b>.fbx</b> и закинь в <code>assets/models/</code>.";
    stage.appendChild(txt);
    stopLoading();
    function loop0() { raf = requestAnimationFrame(loop0); controls.update(); renderer.render(scene, camera); }
    loop0();
    return { dispose() { cancelAnimationFrame(raf); controls.dispose(); renderer.dispose(); renderer.domElement.remove(); } };
  }

  function onLoaded(model, animations) {
    // Камеру наводим на центр модели, а модель не двигаем и не масштабируем:
    // у FBX внутри бывают узлы с зеркальным (отрицательным) масштабом, при
    // котором перенос позиции даёт двойной сдвиг и модель уезжает из кадра.
    scene.add(model);
    applyMirrorSide(model);
    // FBX-материалы: исправляем дефолтные свойства для PBR
    if (ext === "fbx") {
      fixFbxMaterials(model);
      loadSideTextures(modelUrl, model);
    }
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist = (maxDim / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.2;
    const dir = defaultViewDir(size);
    homePos.copy(center).addScaledVector(dir, dist);
    homeTarget.copy(center);
    camera.position.copy(homePos);
    controls.target.copy(homeTarget);
    camera.near = Math.max(dist / 1000, 0.001);
    camera.far = dist * 4 + maxDim;
    camera.updateProjectionMatrix();
    controls.update();

    let totalTris = 0, totalVerts = 0;
    modelMeshes = [];
    model.traverse((o) => {
      if (o.isMesh && o.geometry && o.geometry.attributes.position) {
        modelMeshes.push(o);
        o.userData.origMats = o.material;
        const g = o.geometry;
        totalVerts += g.attributes.position.count;
        totalTris += Math.round((g.index ? g.index.count : g.attributes.position.count) / 3);
      }
    });

    const fmt = (n) => n.toLocaleString("ru-RU");
    const stats = document.createElement("div");
    stats.className = "sf-stats";
    stats.textContent = "Треуг.: " + fmt(totalTris) + " · Верш.: " + fmt(totalVerts);
    stage.appendChild(stats);

    if (animations && animations.length) {
      mixer = new THREE.AnimationMixer(model);
      actions = animations.map((clip) => mixer.clipAction(clip));
      current = actions[0];
      current.play();
    }
    grid = new THREE.GridHelper(6, 12, 0x333355, 0x1a1a2a);
    grid.scale.setScalar(maxDim / 6);
    grid.position.y = box.min.y - maxDim * 0.05;
    scene.add(grid);

    if (totalTris > 200000) {
      const hint = document.createElement("div");
      hint.style.cssText =
        "position:absolute;top:44px;left:12px;z-index:4;color:#ffb454;font-size:12px;" +
        "font-family:var(--mono);background:rgba(0,0,0,.55);padding:6px 10px;border-radius:8px;border:1px solid #ffb45444;";
      hint.textContent =
        "Тяжёлая модель: ≈" + (totalTris / 1000000).toFixed(1) +
        " млн треугольников. Уменьши полигонаж в Blender (Decimate / уровни Subdivision).";
      stage.appendChild(hint);
    }

    if (withControls) { buildModelControls(); buildSettingsPanel(); }
    applyView();
  }

  const ext = modelUrl.split("?")[0].toLowerCase().split(".").pop();
  const loader = ext === "fbx" ? new FBXLoader() : new GLTFLoader();
  loader.load(
    modelUrl,
    (result) => {
      stopLoading();
      const model = result.scene || result;
      const animations = result.animations || [];
      onLoaded(model, animations);
    },
    undefined,
    (err) => {
      stopLoading();
      console.warn("Model load failed:", err);
      const txt = document.createElement("div");
      txt.style.cssText = "color:#ff8080;padding:20px;font-family:monospace;line-height:1.6;overflow:auto;max-height:100%;";
      const msg = err && err.message ? err.message : String(err);
      txt.innerHTML = "Не удалось загрузить модель.<br><br>" +
        "<b>Файл:</b> " + modelUrl.split("/").pop() + "<br>" +
        "<b>Ошибка:</b> " + msg + "<br><br>" +
        "<b>Решение:</b> Экспортируй из Blender как <code>glTF 2.0 (.glb)</code><br>" +
        "(File → Export → glTF Binary 2.0)";
      stage.appendChild(txt);
    }
  );

  function buildModelControls() {
    const p = panel(stage, "");
    p.el.classList.add("vp-controls--sf");
    let playing = true;
    if (actions.length) {
      const playBtn = p.btn("⏸", () => {}, true);
      playBtn.addEventListener("click", () => {
        playing = !playing;
        actions.forEach((a) => (a.paused = !playing));
        playBtn.textContent = playing ? "⏸" : "▶";
        playBtn.classList.toggle("active", playing);
      });
      p.slider("Speed", 0, 3, 1, (v) => { if (mixer) mixer.timeScale = v; });
      if (actions.length > 1) {
        p.select("Anim", actions.map((_, i) => "Anim " + (i + 1)), (val) => {
          const idx = parseInt(val.split(" ")[1]) - 1;
          actions.forEach((a) => a.stop());
          current = actions[idx];
          current.reset().play();
          current.paused = !playing;
        }, "Anim 1");
      }
    }
    p.btn("Grid", () => {}, true).addEventListener("click", (e) => {
      if (grid) { grid.visible = !grid.visible; e.currentTarget.classList.toggle("active", grid.visible); }
    });
    p.btn("Reset", () => {}, false).addEventListener("click", () => {
      camera.position.copy(homePos);
      controls.target.copy(homeTarget);
      controls.update();
    });
  }

  function meshMats(o) {
    return Array.isArray(o.material) ? o.material : [o.material];
  }

  function getFlatMat() {
    if (!flatMaterial) {
      flatMaterial = new THREE.MeshStandardMaterial({
        color: grayMats ? 0x8f8f9b : 0x13131a,
        roughness: 0.9, metalness: 0, side: THREE.DoubleSide,
      });
    }
    return flatMaterial;
  }

  // Применяет выбранные режимы отображения ко всем мешам модели
  function applyView() {
    modelMeshes.forEach((o) => {
      meshMats(o).forEach((m) => { if (m) m.wireframe = false; });
      o.material = showMats ? o.userData.origMats : getFlatMat();
      const ms = showMats ? meshMats(o) : [getFlatMat()];
      ms.forEach((m) => { if (m) m.wireframe = facesOn; });
    });
    if (flatMaterial) flatMaterial.color.set(grayMats ? 0x8f8f9b : 0x13131a);
    sceneLights.forEach((l) => { l.visible = lightsOn; });
  }

  function buildSettingsPanel() {
    const wrap = document.createElement("div");
    wrap.className = "sf-settings";

    const btn = document.createElement("button");
    btn.className = "sf-settings-btn";
    btn.title = "Режимы отображения";
    btn.textContent = "⚙";
    btn.setAttribute("aria-label", "Режимы отображения");

    const pop = document.createElement("div");
    pop.className = "sf-settings-pop";
    pop.hidden = true;

    const makeItem = (label, checked, onChange) => {
      const row = document.createElement("label");
      row.className = "sf-mode-item";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = checked;
      box.addEventListener("change", () => onChange(box.checked));
      const sp = document.createElement("span");
      sp.textContent = label;
      row.append(box, sp);
      return row;
    };

    pop.append(makeItem("Треугольники", false, (v) => { facesOn = v; applyView(); }));
    pop.append(makeItem("Материалы", true, (v) => { showMats = v; grayRow.hidden = v; applyView(); }));
    const grayRow = makeItem("Серые материалы", true, (v) => { grayMats = v; applyView(); });
    grayRow.hidden = true;
    pop.append(grayRow);
    pop.append(makeItem("Свет", true, (v) => { lightsOn = v; applyView(); }));

    btn.addEventListener("click", () => {
      pop.hidden = !pop.hidden;
      btn.classList.toggle("active", !pop.hidden);
    });

    wrap.append(btn, pop);
    stage.appendChild(wrap);
  }

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  resize();

  function loop() {
    raf = requestAnimationFrame(loop);
    if (mixer) mixer.update(clock.getDelta());
    controls.update();
    renderer.render(scene, camera);
  }
  loop();

  return {
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      if (flatMaterial) flatMaterial.dispose();
      renderer.dispose();
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => { for (const k in m) if (m[k]?.isTexture) m[k].dispose(); m.dispose(); });
        }
      });
      renderer.domElement.remove();
    },
  };
}
