# Picly

Face search from local drives. Desktop + mobile, no cloud required.

## Stack

- **ML engine**: InsightFace `buffalo_l` (CPU)
- **API**: FastAPI (`/scan`, `/search`, `/person`, `/person/:id/photos`, `/thumb/:id`, `/stats`)
- **Database**: PostgreSQL 16 + JSONB + cosine similarity search
- **Desktop**: Tauri (planned)
- **Mobile**: PWA (planned)

## Quick start with Docker

```bash
# 1. Clone + cd
git clone git@github.com:rizkhal/picly.git && cd picly

# 2. Copy env
cp .env.example .env

# 3. Mount your photo folder
mkdir -p photos
# symlink or copy photos into ./photos

# 4. Start
docker compose up -d

# 5. Scan
curl -X POST "http://localhost:8000/scan" -F "folder=/photos"

# 6. Search
curl -X POST "http://localhost:8000/search" -F "file=@query.jpg"
```

## API

| Method | Path | Description |
|---|---|---|
| `POST` | `/scan` | Scan folder, detect faces, auto-cluster |
| `POST` | `/search` | Search by uploaded face image |
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
| `SCAN_THRESHOLD` | `1000` | Background scan if files > N |
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

## Storage model

| Component | Storage |
|---|---|
| Postgres DB + embeddings | ~50–150MB |
| Thumb cache (300px JPEG) | ~30–80KB per photo |
| 10k photos | ~400MB thumb cache |
| 100k photos | ~4–8GB thumb cache |
| Original photos | 0 bytes on server |

## Notes

- Storage: PostgreSQL + JSONB embeddings + cosine similarity search
- Face clustering: centroid-based with running average
- Drive handling is **desktop app responsibility**, not backend
- For production: use reverse proxy, enable `PICLY_API_KEY`, bind to private network only
