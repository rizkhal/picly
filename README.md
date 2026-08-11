# Picly

Face search from local drives. Desktop app, no cloud required.

## Stack

- **ML engine**: InsightFace `buffalo_l` (CPU) — run natively in the desktop via **ONNX Runtime** (`onnxruntime-node`), ported 1:1 from the Python reference (`desktop/src/main/ml/`)
- **Storage**: local **SQLite** (`desktop/src/main/db/`) — photos, faces, persons, embeddings (BLOB) + JS cosine search
- **Scanner**: local, hash dedup + thumbnails + centroid clustering (`desktop/src/main/scanner.ts`)
- **Desktop**: Electron + React (see `desktop/`) — **100% local, works fully offline**
- **Backend**: minimal **Hono** service (`backend/`) — **only for in-app update manifest** (`GET /app/update`)
- **Mobile**: PWA (planned)

## Run the desktop app (local, no backend needed)

```bash
cd desktop
npm install          # postinstall compiles better-sqlite3 for host + Electron ABI
npm run electron:dev # compile local services + run the app (needs a GUI session)
```

> The ML models are read from `~/.insightface/models` (override with `PICLY_MODELS_DIR`).
> No Python, Docker, or backend is required for scan/search/browse — everything is local.

## Backend (in-app update only)

The desktop checks for a newer release against the Hono service:

```bash
cd backend
bun install
bun run src/index.ts   # serves GET /app/update, /app/update/check, /health
```

Or via Docker: `docker compose up -d --build` (binds `127.0.0.1:8000`).

The manifest (version/url/notes) lives in `backend/src/update.ts` — bump it when releasing.

## Env vars

| Var | Default | Description |
|---|---|---|
| `PICLY_MODELS_DIR` | `~/.insightface/models` | ONNX model dir (`buffalo_l`) |
| `PICLY_API_KEY` | empty | Optional API key auth for the update backend |
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
  `cd docs/ml-parity && <run gen_fixtures.py inside the old picly-api container or any
  insightface 0.7.3 env, see script header> --photos <host paths...> --out golden.json`
- Models are read from `~/.insightface/models` (override with `PICLY_MODELS_DIR`).
- Pipeline is config-driven (`desktop/src/main/ml/config.ts`) — switching to the
  lighter `buffalo_s` pack later = new model paths + regenerate fixtures, no code change.

### Local storage + scanner (Fase 2)

`desktop/src/main/db/` is a local SQLite store (better-sqlite3) mirroring the
backend schema (folders/photos/faces/persons), with embeddings as BLOB and
JS typed-array cosine search; `desktop/src/main/scanner.ts` scans folders
(hash dedup + thumbnails + centroid clustering at threshold 0.6, progress/cancel).
The DB lives under `desktop/data/` (gitignored). Test harnesses:

```bash
cd desktop
bun run scan:test      # scan ~/picly-photos-local: dedup + search + self-match
bun run cluster:test   # 6 LFW people x 4 photos: cluster purity + coverage
bun run parity:cluster # dump assignments; diff vs docs/ml-parity/parity_cluster.py
```

Search is **multi-face**: a query photo with several people searches with ALL
faces, results are deduped per photo (ranked by best match), and each hit shows
the distinct persons matched (`matchedPersons`).

Clustering is byte-for-byte parity with the Python backend (27/28 face
assignments identical on the parity set; the 1 remaining flip is a near-threshold
0.6 decision, expected from the accepted sub-pixel warp differences).

### Electron integration (Fase 3) — fully local, no backend

`desktop/src/main/main.cjs` wires local IPC handlers over the compiled services
(`dist-main/local.js`, from `src/main/local.ts`): scan folder with live progress
(streamed via IPC events, no polling), search by photo, list folders/persons/photos,
rename/delete, and a `picly://thumb/` protocol handler that serves cached thumbnails
to the renderer.

The **renderer is 100% local** — every action (scan, search, browse, rename,
delete, thumbnails) goes through the SQLite store + ONNX pipeline. **No Python
backend / Docker is required** to run the desktop app; it works fully offline.

The backend (`backend/`, Hono) is now only for **in-app update**: the
desktop checks `GET /app/update` (via `app:check-update` IPC) for a newer release
manifest. Everything else is local.

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
- Models live in `~/.insightface/models/buffalo_l/` (det_10g.onnx + w600k_r50.onnx) — required for scan/search
