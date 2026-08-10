# Picly

Face search from local drives. Desktop + mobile, no cloud required.

## Stack

- **ML engine**: InsightFace `buffalo_l` (CPU)
- **API**: FastAPI (`/scan`, `/search`, `/person`, `/person/:id/photos`)
- **Desktop**: Tauri
- **Mobile**: PWA

## Run backend

```bash
cd services/face-search
python3 -m venv .venv && source .venv/bin/activate
pip install insightface fastapi uvicorn python-multipart
uvicorn main:app --host 0.0.0.0 --port 8000
```

## API

| Method | Path | Description |
|---|---|---|
| `POST` | `/scan` | Scan folder, detect faces, auto-cluster |
| `POST` | `/search` | Search by uploaded face image |
| `GET` | `/person` | List known persons |
| `GET` | `/person/:id/photos` | Photos for person |
| `GET` | `/health` | Status |

## Notes

- Storage is in-memory for now; persistence via Postgres + pgvector planned.
- Face clustering uses cosine similarity with a fixed threshold.
