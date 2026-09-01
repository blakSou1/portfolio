import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

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

/* ---------- Environment for PBR (Blender-like look) ---------- */
function makeEnv(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return env;
}

function pickLoader(url) {
  const ext = url.toLowerCase().split(".").pop();
  return ext === "fbx" ? new FBXLoader() : new GLTFLoader();
}

// Меши с зеркальным масштабом (детерминант матрицы < 0) рендерятся изнутри-наружу
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
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 5, 4); scene.add(key);
  const rim = new THREE.DirectionalLight(0x7c5cff, 1.4);
  rim.position.set(-4, 2, -3); scene.add(rim);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);

  const w = canvas.clientWidth || 300, h = canvas.clientHeight || 200;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  pickLoader(modelUrl).load(
    modelUrl,
    (res) => {
      const model = res.scene || res;
      scene.add(model);
      applyMirrorSide(model);
      const box = new THREE.Box3().setFromObject(model);
      const cc = box.getCenter(new THREE.Vector3());
      const s = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(s.x, s.y, s.z) || 2;
      const dist = (maxDim / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.5;
      camera.position.copy(cc).addScaledVector(new THREE.Vector3(0, 0.35, 1).normalize(), dist);
      camera.near = Math.max(dist / 1000, 0.001);
      camera.far = dist * 4 + maxDim;
      camera.updateProjectionMatrix();
      camera.lookAt(cc);
      renderer.render(scene, camera);

      // Copy pixels to a plain 2D canvas, then release the WebGL context
      try {
        const copy = document.createElement("canvas");
        copy.width = canvas.width;
        copy.height = canvas.height;
        copy.getContext("2d").drawImage(canvas, 0, 0);
        copy.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;";
        if (canvas.parentNode) canvas.parentNode.replaceChild(copy, canvas);
      } catch (e) { /* keep webgl canvas if copy fails */ }
      try { renderer.dispose(); renderer.forceContextLoss(); } catch (e) {}
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
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x000000, 0);
  scene.environment = makeEnv(renderer);
  stage.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 5, 4); scene.add(key);
  const rim = new THREE.DirectionalLight(0x7c5cff, 1.5);
  rim.position.set(-4, 2, -3); scene.add(rim);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.autoRotate = false;
  controls.autoRotateSpeed = 1.2;
  controls.enablePan = true;

  const loading = document.createElement("div");
  loading.className = "sf-loading";
  loading.innerHTML = '<div class="spinner"></div>';
  stage.appendChild(loading);
  const stopLoading = () => loading.remove();

  const hint = document.createElement("div");
  hint.className = "sf-hint";
  hint.textContent = "ЛКМ — вращать · колесо — масштаб · ПКМ — сдвиг";
  stage.appendChild(hint);

  let mixer = null, clock = new THREE.Clock();
  let actions = [], current = null, grid = null, wire = false;
  let raf;
  const homePos = new THREE.Vector3(0, 1, 4);
  const homeTarget = new THREE.Vector3(0, 0, 0);

  if (modelUrl.toLowerCase().endsWith(".blend")) {
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
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist = (maxDim / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.4;
    const dir = new THREE.Vector3(0, 0.35, 1).normalize();
    homePos.copy(center).addScaledVector(dir, dist);
    homeTarget.copy(center);
    camera.position.copy(homePos);
    controls.target.copy(homeTarget);
    camera.near = Math.max(dist / 1000, 0.001);
    camera.far = dist * 4 + maxDim;
    camera.updateProjectionMatrix();
    controls.update();

    let totalTris = 0;
    model.traverse((o) => {
      if (o.isMesh && o.geometry && o.geometry.attributes.position) {
        const g = o.geometry;
        totalTris += Math.round((g.index ? g.index.count : g.attributes.position.count) / 3);
      }
    });

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

    if (withControls) buildModelControls();
  }

  const ext = modelUrl.toLowerCase().split(".").pop();
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
    const playBtn = p.btn("⏸", () => {}, true);
    playBtn.addEventListener("click", () => {
      if (!mixer) return;
      playing = !playing;
      actions.forEach((a) => (a.paused = !playing));
      playBtn.textContent = playing ? "⏸" : "▶";
      playBtn.classList.toggle("active", playing);
    });
    p.btn("Spin", () => {}, false).addEventListener("click", (e) => {
      controls.autoRotate = !controls.autoRotate;
      e.currentTarget.classList.toggle("active", controls.autoRotate);
    });
    p.btn("Wire", () => {}, false).addEventListener("click", (e) => {
      wire = !wire;
      scene.traverse((o) => {
        if (o.isMesh) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => { if (m) m.wireframe = wire; });
        }
      });
      e.currentTarget.classList.toggle("active", wire);
    });
    p.btn("Grid", () => {}, true).addEventListener("click", (e) => {
      if (grid) { grid.visible = !grid.visible; e.currentTarget.classList.toggle("active", grid.visible); }
    });
    p.btn("Reset", () => {}, false).addEventListener("click", () => {
      camera.position.copy(homePos);
      controls.target.copy(homeTarget);
      controls.update();
    });
    p.btn("⤢", () => {}, false).addEventListener("click", (e) => {
      const box = stage.closest(".modal-body") || stage;
      if (document.fullscreenElement) document.exitFullscreen();
      else box.requestFullscreen && box.requestFullscreen();
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
