# Picly

Face search from local drives. Desktop + mobile, no cloud required.

## Stack

- **ML engine**: InsightFace `buffalo_l` (CPU)
- **API**: FastAPI (`/scan`, `/search`, `/person`, `/person/:id/photos`, `/thumb/:id`, `/stats`)
- **Database**: PostgreSQL 16 + pgvector (HNSW index) + cosine similarity search
- **Desktop**: Electron + React (see `desktop/`) — ML pipeline runs natively in Node via ONNX Runtime (Phase 1 complete, see below)
- **Mobile**: PWA (planned)

## Quick start with Docker

```bash
# 1. Clone + cd
git clone git@github.com:rizkhal/picly.git && cd picly

# 2. Copy env
cp .env.example .env

# 3. Start
docker compose up -d

# 4. Scan — the desktop app's "+ Add folder" maps any host folder into the
#    container (via read-only host mounts under /host) and scans it in place —
#    no copying. CLI equivalent (host /Volumes/MyDrive/photos appears at
#    /host/Volumes/MyDrive/photos):
curl -X POST "http://localhost:8000/scan" -F "folder=/host/Volumes/MyDrive/photos"

# 5. Search
curl -X POST "http://localhost:8000/search" -F "file=@query.jpg"
```

## API

| Method | Path | Description |
|---|---|---|
| `POST` | `/scan` | Scan folder, detect faces, auto-cluster (registers the folder; returns a `scan_id`) |
| `GET` | `/scan/status/:id` | Live scan progress (`processed`/`total`, current file) — poll while scanning |
| `POST` | `/scan/:id/cancel` | Stop a queued or running scan |
| `DELETE` | `/folder/:id` | Remove a folder and all photos indexed under it |
| `POST` | `/search` | Search by uploaded face image |
| `GET` | `/folders` | List added folders with photo counts + availability |
| `GET` | `/photos?folder_path=` | List photos, optionally scoped to a folder |
| `GET` | `/config` | Host-mount mapping for the desktop app |
| `GET` | `/person` | List known persons |
| `GET` | `/person/:id/photos` | Photos for person |
| `PATCH` | `/person/:id/rename` | Rename person |
| `DELETE` | `/person/:id` | Delete person |
| `DELETE` | `/photo/:id` | Delete photo |
| `GET` | `/thumb/:id` | Serve cached thumbnail |
| `GET` | `/stats` | DB statistics |
| `GET` | `/health` | Status |
| `GET` | `/ready` | Readiness probe |

## Env vars

| Var | Default | Description |
|---|---|---|
| `POSTGRES_PASSWORD` | `picly` | Postgres password |
| `PICLY_API_KEY` | empty | Optional API key auth |
| `THUMB_DIR` | `/tmp/picly_thumbs` | Thumbnail cache dir |
| `THUMB_SIZE` | `300` | Thumbnail size in px |
| `UPLOAD_DIR` | `/tmp/picly_uploads` | Upload temp dir |

## Architecture

```
Desktop App                    Picly API
     │                              │
     │── POST /scan ──────────────▶│
     │   folder=/mnt/ssd/photos    │
     │◀── ScanStatus ──────────────│
     │                              │
     │── GET /person/:id/photos ──▶│
     │◀── photos + thumb_paths ────│
     │                              │
     │── GET /thumb/:id ──────────▶│
     │◀── JPEG thumbnail ──────────│
     │                              │
```

### Desktop responsibilities
- Detect drive mount/unmount
- Resolve photo paths dynamically
- Trigger scan when drive connects
- Serve original full-res photos when available
- Graceful offline mode when drive disconnected

### Mobile responsibilities
- Consume REST API only
- No drive management needed
- Works via PWA or native wrapper

### Offline behavior
- If drive disconnected → API still returns thumbnails + metadata
- Original paths may be stale → desktop should validate before opening
- Search/cluster/rename still work without drive connected

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

- Fixtures: `desktop/src/main/ml/__fixtures__/golden.json` (bbox/kps/M/embedding per face).
- Regenerate from the running Python backend:
  `docker cp services/face-search/scripts/gen_fixtures.py picly-api-1:/tmp/ && docker exec picly-api-1 python3 /tmp/gen_fixtures.py --photos <host paths...> --out /tmp/golden.json`
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
bun run parity:cluster # dump assignments; diff vs services/face-search/scripts/parity_cluster.py
```

Clustering is byte-for-byte parity with the Python backend (27/28 face
assignments identical on the parity set; the 1 remaining flip is a near-threshold
0.6 decision, expected from the accepted sub-pixel warp differences).

### Electron integration (Fase 3)

`desktop/src/main/main.cjs` wires local IPC handlers over the compiled services
(`dist-main/local.js`, from `src/main/local.ts`): scan folder with live progress,
search by photo, list folders/persons/photos, rename/delete, and a `picly://thumb/`
protocol handler that serves cached thumbnails to the renderer. No Python backend
is required for scan/search anymore.

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

## Storage model

| Component | Storage |
|---|---|
| Postgres DB + embeddings | ~50–150MB |
| Thumb cache (300px JPEG) | ~30–80KB per photo |
| 10k photos | ~400MB thumb cache |
| 100k photos | ~4–8GB thumb cache |
| Original photos | 0 bytes on server |

## Notes

- Storage: PostgreSQL + pgvector (HNSW indexes on `faces.embedding_vector` and `persons.embedding_centroid_vector`) for vector search
- Face clustering: centroid-based with running average; nearest-person match via pgvector (HNSW)
- Drive handling is **desktop app responsibility**, not backend
### Host mounts (why "+ Add folder" can fail)

`docker-compose.yml` mounts two host roots read-only into the API container under
`/host`: `/Volumes` (all external drives) and `$HOME` (the user folder). The desktop
app maps any picked folder inside those roots and scans it in place — no copying.

- **Docker Desktop (macOS)** auto-mounts both paths — nothing to configure.
- **Colima/Lima (QEMU)** only exposes `$HOME` by default, and *setting* `mounts` in
  `~/.colima/default/colima.yaml` replaces that default. List **both** roots:
  ```yaml
  mounts:
    - location: /Volumes
      writable: false
    - location: /Users/you
      writable: true
  ```
  then `colima restart`. If you see only the VM's own filesystem under `/host`
  (or a stale snapshot), this is the fix.
- Colima's sshfs cannot bind-mount individual files, so the DB init script is mounted
  as a directory (`services/face-search/initdb/`).
- For production: use reverse proxy, enable `PICLY_API_KEY`, bind to private network only
