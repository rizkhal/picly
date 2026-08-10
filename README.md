# Picly

Face search from local drives. Desktop + mobile, no cloud required.

## Stack

- **ML engine**: InsightFace `buffalo_l` (CPU)
- **API**: FastAPI (`/scan`, `/search`, `/person`, `/person/:id/photos`, `/stats`)
- **Database**: PostgreSQL 16
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
| `GET` | `/stats` | DB statistics |
| `GET` | `/health` | Status |
| `GET` | `/ready` | Readiness probe |

## Env vars

| Var | Default | Description |
|---|---|---|
| `POSTGRES_PASSWORD` | `picly` | Postgres password |
| `PICLY_API_KEY` | empty | Optional API key auth |
| `SCAN_THRESHOLD` | `1000` | Background scan if files > N |

## Notes

- Storage: PostgreSQL + JSONB embeddings + cosine similarity search
- Face clustering: centroid-based with running average
- For production: use reverse proxy, enable `PICLY_API_KEY`, bind to private network only
