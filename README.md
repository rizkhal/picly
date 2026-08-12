<p align="center">
  <img src="assets/logo-128.png" width="96" alt="Picly logo" />
</p>

<h1 align="center">Picly</h1>

<p align="center">
  <strong>Face search from your local drives.</strong><br/>
  Desktop app, no cloud required — everything runs on your device.
</p>

<p align="center">
  <a href="#features"><img alt="Features" src="https://img.shields.io/badge/-Features-3b82f6" /></a>
  <a href="#stack"><img alt="Stack" src="https://img.shields.io/badge/-Stack-3b82f6" /></a>
  <a href="#run-the-desktop-app-local-no-backend-needed"><img alt="Run" src="https://img.shields.io/badge/-Run-3b82f6" /></a>
  <a href="#build--package-macos"><img alt="Build" src="https://img.shields.io/badge/-Build-3b82f6" /></a>
  <a href="#desktop-ml-pipeline-node--onnx-runtime"><img alt="ML" src="https://img.shields.io/badge/-ML%20Pipeline-3b82f6" /></a>
  <br/>
  <img alt="Platform" src="https://img.shields.io/badge/macOS-Apple%20Silicon-000000" />
  <img alt="ML" src="https://img.shields.io/badge/ML-ONNX%20Runtime-3b82f6" />
  <img alt="Storage" src="https://img.shields.io/badge/Storage-SQLite-3b82f6" />
  <img alt="Offline" src="https://img.shields.io/badge/Offline-100%25-22c55e" />
</p>

---

## Features

- **🔍 Face search** — drop a photo and find every matching face across your drives
- **👤 Auto-tagging** — InsightFace clustering groups the same person across photos
- **📁 Local-first** — SQLite + ONNX run entirely on-device; your photos never leave your machine
- **⚡ Built for macOS** — Apple Silicon native, packaged as a DMG
- **🌐 Optional account** — login only for updates; all local features work without it

## Stack

- **ML engine**: InsightFace `buffalo_l` (CPU) — run natively in the desktop via **ONNX Runtime** (`onnxruntime-node`), ported 1:1 from the Python reference (`desktop/src/main/ml/`)
- **Storage**: local **SQLite** (`desktop/src/main/db/`) — photos, faces, persons, embeddings (BLOB) + JS cosine search
- **Scanner**: local, hash dedup + thumbnails + centroid clustering (`desktop/src/main/scanner.ts`)
- **Desktop**: Electron + React (see `desktop/`) — **100% local, works fully offline**
- **Backend**: minimal **Hono** service (`backend/`) — **auth** (register/login) + **in-app update manifest** (`GET /app/update`)
- **Mobile**: PWA (planned)

## Run the desktop app (local, no backend needed)

```bash
cd desktop
npm install          # postinstall compiles better-sqlite3 for host + Electron ABI
npm run electron:dev # compile local services + run the app (needs a GUI session)
```

> **Dev** reads the ML models from `~/.insightface/models` (override with `PICLY_MODELS_DIR`).
> **Packaged** builds bundle the models inside the app (`Contents/Resources/models`) via
> `electron:build` — a fresh install needs no manual model setup.
> No Python, Docker, or backend is required for scan/search/browse — everything is local.

## Build & package (macOS)

```bash
cd desktop
npm run electron:build   # fetches ONNX models if missing, then electron-builder → dist/Picly-*.dmg
```

- `scripts/fetch-models.mjs` downloads `buffalo_l` from GitHub releases and extracts
  **only** the two models Picly loads — `det_10g.onnx` (~17 MB) + `w600k_r50.onnx`
  (~174 MB) — into `desktop/models/buffalo_l/` (gitignored, never committed).
- electron-builder copies them via `extraResources` into `Contents/Resources/models`;
  the packaged app resolves them automatically (`config.ts` → `process.resourcesPath`).
- CI (`.github/workflows/build.yml`) runs the same fetch step before building, so the
  repo stays free of the ~190 MB model files.
- Target saat ini: **macOS arm64 (Apple Silicon)** — DMG. Windows/Linux menyusul.
- DevTools dinonaktifkan di packaged app (`devTools: !app.isPackaged`); dev tetap bisa buka.

## Backend (auth + in-app update)

The backend serves **auth** (register/login) and the **in-app update manifest**:

```bash
cd backend
bun install
bun run src/index.ts   # serves /auth/*, /app/update, /health
```

Or via Docker: `docker compose up -d --build` (binds `127.0.0.1:8000`).

| Endpoint | Auth | Description |
|---|---|---|
| `POST /auth/register` | public | Create account (email + password ≥ 8 chars), rate-limited 5/15min/IP |
| `POST /auth/login` | public | Login → JWT access + refresh token pair, rate-limited 5/15min/IP |
| `POST /auth/refresh` | public | Rotate refresh token → new token pair (old one revoked) |
| `POST /auth/logout` | public | Revoke refresh token |
| `GET /app/update` | public | Update manifest `{ version, url, notes }` |
| `GET /app/update/check?current=` | public | Convenience: is there a newer version? |
| `GET /health`, `/ready` | public | Health / readiness |

- Passwords hashed with argon2id (`Bun.password`), refresh tokens stored hashed + revocable
- The update manifest is **public** — it only carries a version + GitHub release URL, and staying available matters more than being gated
- The manifest (version/url/notes) lives in `backend/src/update.ts` — bump it when releasing

### Desktop auth (account is optional — local features work without it)

The desktop lets you register/login from the **Settings page** (sidebar footer gear
button). When logged in, the sidebar footer shows your **email** instead of the
"Settings" label. Tokens are stored via **Electron `safeStorage`** (OS-level
encryption: Keychain/DPAPI), and the renderer never sees raw tokens (only status +
email). Account is for **entitlement + update** — photos stay 100% local to the
device and are never scoped or synced per account.

### In-app update (v1: banner → browser)

On startup the renderer checks `GET /app/update` (public) via `app:check-update`;
if a newer version exists it shows a dismissible **update banner** with an **Update**
button that opens the release page in the system browser (`app:open-update`).
The **Settings → Update** section also exposes a **Cek update** button with a
loading state — it shows "Mengecek update…" while the request runs, then a clear
result message (ada update / sudah versi terbaru / gagal bila backend unreachable).
Auto-download/install (electron-updater) is a future phase — v1 is banner + open
browser to keep the update path simple and safe.

## Env vars

| Var | Default | Description |
|---|---|---|
| `PICLY_MODELS_DIR` | `~/.insightface/models` | ONNX model dir (`buffalo_l`) — dev; packaged app uses bundled `Contents/Resources/models` |
| `JWT_SECRET` | (ephemeral) | JWT signing secret — **required in production** (`openssl rand -base64 32`) |
| `DB_PATH` | `/data/picly.db` | Backend SQLite DB path |
| `PORT` (backend) | `8000` | Backend listen port |

## Desktop ML pipeline (Node / ONNX Runtime)

The face pipeline (SCRFD `det_10g` detection + ArcFace `w600k_r50` embedding,
`buffalo_l`) is ported to TypeScript under `desktop/src/main/ml/` — runs fully in
Node via `onnxruntime-node`, **no Python / Docker needed** for inference. It mirrors
insightface's `FaceAnalysis` (det_size 640): letterbox → SCRFD decode + NMS →
`estimate_norm` (exact skimage `_umeyama` port) → warp 112×112 → ArcFace → L2 norm.

Verified against the Python reference with golden fixtures:

```bash
cd desktop && bun run verify:pipeline   # IoU ~0.999, cosSim ~0.9999, umeyama M diff ~1e-5
```

- Fixtures: `docs/ml-parity/golden.json` (bbox/kps/M/embedding per face).
- Regenerate from the archived Python reference (kept under `docs/ml-parity/` for
  provenance — the desktop itself runs fully on ONNX and never needs Python):
  run `docs/ml-parity/gen_fixtures.py` in any insightface 0.7.3 + onnxruntime
  env (see script header for usage), then write the output to `docs/ml-parity/golden.json`.
- Models are read from `~/.insightface/models` in dev (override with `PICLY_MODELS_DIR`);
  packaged builds bundle them under `Contents/Resources/models` (see Build & package).
- Pipeline is config-driven (`desktop/src/main/ml/config.ts`) — switching to the
  lighter `buffalo_s` pack later = new model paths + regenerate fixtures, no code change.

### Local storage + scanner

`desktop/src/main/db/` is a local SQLite store (better-sqlite3) with
folders/photos/faces/persons tables, embeddings as BLOB and
JS typed-array cosine search; `desktop/src/main/scanner.ts` scans folders
(hash dedup + thumbnails + centroid clustering at threshold 0.6, progress/cancel).
The DB lives under `desktop/data/` (gitignored). Test harnesses:

```bash
cd desktop
bun run scan:test      # scan ~/picly-photos-local: dedup + search + self-match
bun run cluster:test   # 6 LFW people x 4 photos: cluster purity + coverage
bun run parity:cluster # dump assignments; diff vs docs/ml-parity/parity_cluster.py
bun run auth:smoke     # headless auth flow against a running backend (PICLY_API_URL)
```

Search is **multi-face**: a query photo with several people searches with ALL
faces, results are deduped per photo (ranked by best match), and each hit shows
the distinct persons matched (`matchedPersons`).

Clustering is byte-for-byte parity with the archived Python reference (27/28 face
assignments identical on the parity set; the 1 remaining flip is a near-threshold
0.6 decision, expected from the accepted sub-pixel warp differences).

### Electron integration — fully local, no backend

`desktop/src/main/main.cjs` wires local IPC handlers over the compiled services
(`dist-main/local.js`, from `src/main/local.ts`): scan folder with live progress
(streamed via IPC events, no polling), search by photo, list folders/persons/photos,
rename/delete, and a `picly://thumb/` protocol handler that serves cached thumbnails
to the renderer.

The **renderer is 100% local** — every action (scan, search, browse, rename,
delete, thumbnails) goes through the SQLite store + ONNX pipeline. **No Python
backend / Docker is required** to run the desktop app; it works fully offline.

The only backend touchpoints are **optional**: auth (login/register) and the
in-app update banner — both degrade gracefully when the backend is unreachable.

```bash
cd desktop
bun run electron:dev   # compile local services + run the app (needs a GUI session)
bun run abi:check      # headless: native modules + scan/search under Electron's Node
```

**Native modules & ABI.** sharp and onnxruntime-node are pure N-API — they load
in Electron as-is. better-sqlite3 is the exception: **v13 (node-addon-api v8)
SIGSEGVs inside Electron 33's Node 20** (`node_module_register` →
`node::SetCppgcReference`, a Node ≥22 path), so the project pins **v11.10.0** and
compiles it twice during `postinstall` (`scripts/rebuild-native.mjs`):
`abi/host.node` (host Node, for the tsx test harnesses) and `abi/electron.node`
(Electron ABI). `scripts/prepare-native.mjs` copies the active binary into the
slot `bindings` loads — `bun run electron:*` select electron, test scripts select
host Node. (Node 24's ABI is 137; Electron 33's is 130 — the two can never share
one binary.)

## Notes

- Storage is fully local: SQLite under `desktop/data/` (gitignored) — thumbnails cached as 300px JPEG
- Face clustering: centroid-based with running average (threshold 0.6), done at scan time
- Drive handling is **desktop app responsibility**, not backend
- Models: **dev** reads `~/.insightface/models/buffalo_l/` (override `PICLY_MODELS_DIR`);
  **packaged** apps ship them inside `Contents/Resources/models` — no manual setup needed

## License

MIT
