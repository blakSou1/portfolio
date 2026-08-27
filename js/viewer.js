import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/* ---------- Animated background (lightweight 2D canvas) ---------- */
export function mountBackground(container) {
  const canvas = document.createElement("canvas");
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  let w, h, raf;
  const blobs = Array.from({ length: 5 }, () => ({
    x: Math.random(), y: Math.random(),
    vx: (Math.random() - 0.5) * 0.0006,
    vy: (Math.random() - 0.5) * 0.0006,
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
      const g = ctx.createRadialGradient(
        b.x * w, b.y * h, 0, b.x * w, b.y * h, b.r
      );
      g.addColorStop(0, `rgba(${b.c},0.10)`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
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

export function openShaderViewer(canvas, fragUrl, small = false) {
  const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
  if (!gl) return { dispose() {} };

  let raf, running = true;
  const prog = gl.createProgram();
  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, VERT); gl.compileShader(vs); gl.attachShader(prog, vs);

  let fragSrc = DEFAULT_FRAG;
  if (fragUrl) {
    fetch(fragUrl).then((r) => r.text()).then((t) => {
      fragSrc = t;
      rebuild();
    }).catch(() => { /* keep default */ });
  }

  function buildFrag(src) {
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, src); gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      console.warn("Shader error:", gl.getShaderInfoLog(fs));
      return null;
    }
    return fs;
  }

  let fsShader = buildFrag(fragSrc);
  gl.attachShader(prog, fsShader);
  gl.linkProgram(prog);
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const uTime = gl.getUniformLocation(prog, "u_time");
  const uRes = gl.getUniformLocation(prog, "u_resolution");

  function rebuild() {
    const nf = buildFrag(fragSrc);
    if (!nf) return;
    gl.detachShader(prog, fsShader);
    fsShader = nf;
    gl.attachShader(prog, fsShader);
    gl.linkProgram(prog);
    gl.useProgram(prog);
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, small ? 1 : 2);
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  const start = performance.now();
  function loop() {
    if (!running) return;
    gl.uniform1f(uTime, (performance.now() - start) / 1000);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    raf = requestAnimationFrame(loop);
  }
  loop();

  return {
    dispose() {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
    },
  };
}

/* ---------- Model viewer (Three.js) ---------- */
export function openModelViewer(stage, modelUrl) {
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
  key.position.set(3, 5, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x7c5cff, 1.5);
  rim.position.set(-4, 2, -3);
  scene.add(rim);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.2;

  let mixer = null;
  const clock = new THREE.Clock();
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
        mixer.clipAction(gltf.animations[0]).play();
      }
      const grid = new THREE.GridHelper(6, 12, 0x333355, 0x1a1a2a);
      grid.position.y = -1.2;
      scene.add(grid);
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
