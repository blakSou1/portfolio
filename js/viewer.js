import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
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

  let raf, running = true, shaderOn = true;
  let timeScale = 1, paramA = 0.5, paramB = 0.5, paramC = 0.5;
  const start = performance.now();
  let elapsed = 0, last = start;

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
    if (!running) return;
    const now = performance.now();
    if (shaderOn) {
      elapsed += (now - last) * timeScale;
      gl.uniform1f(uni.u_time, elapsed / 1000);
      gl.uniform2f(uni.u_resolution, canvas.width, canvas.height);
      gl.uniform1f(uni.u_a, paramA);
      gl.uniform1f(uni.u_b, paramB);
      gl.uniform1f(uni.u_c, paramC);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else {
      gl.clearColor(0.04, 0.04, 0.06, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    last = now;
    raf = requestAnimationFrame(loop);
  }
  loop();

  if (withControls) {
    const p = panel(canvas.parentElement, "Шейдер");
    let playing = true;
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
    dispose() { running = false; cancelAnimationFrame(raf); ro.disconnect(); },
  };
}

/* ---------- Model viewer (Three.js) ---------- */
export function openModelViewer(stage, modelUrl, opts = {}) {
  const withControls = !!opts.withControls;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07070c);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 1, 4);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 5, 4); scene.add(key);
  const rim = new THREE.DirectionalLight(0x7c5cff, 1.5);
  rim.position.set(-4, 2, -3); scene.add(rim);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.2;
  controls.enablePan = true;

  let mixer = null, clock = new THREE.Clock();
  let actions = [], current = null, grid = null, wire = false;
  let raf;

  const loader = new GLTFLoader();
  loader.load(
    modelUrl,
    (gltf) => {
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      model.position.sub(center);
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      model.scale.setScalar(2.2 / maxDim);
      scene.add(model);

      if (gltf.animations && gltf.animations.length) {
        mixer = new THREE.AnimationMixer(model);
        actions = gltf.animations.map((clip) => mixer.clipAction(clip));
        current = actions[0];
        current.play();
      }
      grid = new THREE.GridHelper(6, 12, 0x333355, 0x1a1a2a);
      grid.position.y = -1.2;
      scene.add(grid);

      if (withControls) buildModelControls();
    },
    undefined,
    (err) => {
      console.warn("Model load failed:", err);
      const txt = document.createElement("div");
      txt.style.cssText = "color:#ff8080;padding:20px;font-family:monospace;";
      txt.textContent = "Не удалось загрузить модель: " + modelUrl;
      stage.appendChild(txt);
    }
  );

  function buildModelControls() {
    const p = panel(stage, "Модель");
    let playing = true;
    const playBtn = p.btn("⏸", () => {}, true);
    playBtn.addEventListener("click", () => {
      if (!mixer) return;
      playing = !playing;
      actions.forEach((a) => (a.paused = !playing));
      playBtn.textContent = playing ? "⏸" : "▶";
      playBtn.classList.toggle("active", playing);
    });
    p.btn("Auto", () => {}, true).addEventListener("click", (e) => {
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
      camera.position.set(0, 1, 4);
      controls.target.set(0, 0, 0);
      controls.update();
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
