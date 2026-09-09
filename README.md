# Portfolio: 3D / Shaders / Animation

**Website:** https://blaksou1.github.io/portfolio/

A static graphic-design portfolio, hosted for free on **GitHub Pages**.
Works are uploaded through git — the site picks up files automatically from the repository folders (`assets/...`).

## What's inside
- Interactive **3D model** viewing (Three.js + OrbitControls, auto-rotation, skeletal animation).
- Live **shaders** (GLSL, running right in the browser on WebGL).
- **Video** and **images** as previews.
- Category filter: modeling / shaders / animation / graphics.
- **Hidden section** — files prefixed with `hidden` (e.g. `hidden-concept.glb`) or placed in a `hidden/` folder are not shown to visitors. They appear only when the site is opened with a secret key:
  `https://blaksou1.github.io/portfolio/?key=my-secret-key-123`
- Project sources (`.blend`, `.fbx`, raw files) go into `private/source/` and are **not served to visitors** — only renders/previews appear on the site.

## Structure
```
portfolio/
├── index.html
├── css/style.css
├── js/main.js          # gallery, filters, hidden section
├── js/viewer.js        # Three.js + WebGL viewers
├── data/projects.json  # work manifest (edit this)
├── assets/
│   ├── previews/       # preview images
│   ├── models/<model>/  # exported model file (+ .blend source, textures)
│   └── shaders/        # .frag shader files
└── private/source/     # sources, hidden from visitors
```

## How to add a work

### Method 1 — automatic (recommended)
Just drop a file into the right folder and push. The site picks it up automatically through the GitHub API:

| Folder            | What to place         | Becomes                          |
|-------------------|-----------------------|----------------------------------|
| `assets/models/<model>/` | `.glb`, `.gltf`, `.fbx` | 3D model (animated if it has animations) |
| `assets/shaders/` | `.frag`               | live shader                      |
| `assets/previews/`| `.png/.jpg/.webp/.svg`| image work                       |
| `assets/videos/`  | `.mp4/.webm`          | video animation                  |

Each model lives in its own subfolder, e.g. `assets/models/chuba/` holds the exported
model (`chuba.fbx`), its Blender source (`chuba.blend`, optional) and the textures.
Only the exported model becomes a gallery card — a `.blend` next to it is kept as a
source and is not duplicated into a second card. Renders/previews for the model go to
`assets/renders/<model>/`.

The card title is taken from the file name. The category is determined automatically from the folder.
Extra metadata (description, custom category label) is optional — the site works
from the files in `assets/` alone.

To **remove** a work, just delete the file from the repository and push. The card disappears by itself.

`data/projects.json` now only contains settings (site, GitHub, secret, categories)
and does not manage the list of works.

Then:
```bash
git add .
git commit -m "add work"
git push
```

## Viewing controls
- **Models:** use the mouse to rotate/zoom/pan (OrbitControls); buttons `⏸` play/pause animation,
  `Auto` auto-rotation, `Wire` wireframe, `Grid` grid, `Reset` reset camera, `Speed` speed,
  `Anim` selector when there are multiple animations.
- **Shaders:** `⏸` pauses time, `Shader` toggles rendering, `Speed` and the `A/B/C` sliders
  (passed into the shader as `u_a`, `u_b`, `u_c` uniforms).
- Add your own uniforms in the `.frag` file; standard ones: `u_time`, `u_resolution`, `u_a/b/c`.

## Local development
ES modules and `fetch` require http, not `file://`. From the `portfolio` folder:
```bash
python -m http.server 8000
# open http://localhost:8000
```

## Deploying to GitHub Pages
The site is already live: **https://blaksou1.github.io/portfolio/**

To recreate it from scratch:
1. Create a repository and put the `portfolio` folder into it.
2. GitHub → Settings → Pages → Source: `main` / `/root`.
3. In about a minute the site will be at `https://your-login.github.io/project/`.
   If the repository is named `username.github.io`, the site is served from the root.

> The secret key is changed in `data/projects.json`, field `site.secretKey`.
> Note: this is "hidden from view", not real protection — the key is visible in the JS code.
> For actual privacy, keep sources in a private repository / cloud.