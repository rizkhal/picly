"""Environment configuration for the Picly API."""
import os
from pathlib import Path

UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "/tmp/picly_uploads"))
THUMB_DIR = Path(os.getenv("THUMB_DIR", "/tmp/picly_thumbs"))
DB_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost/picly")
API_KEY = os.getenv("PICLY_API_KEY")
THUMB_SIZE = int(os.getenv("THUMB_SIZE", "300"))

# Host filesystem mounts exposed at /host. Compose mounts each host root read-only
# (e.g. /Volumes -> /host/Volumes, $HOME -> /host$HOME). HOST_MOUNTS is a
# comma-separated list of "source=target" pairs; when unset it falls back to the
# legacy single-mount HOST_MOUNT_SOURCE/HOST_MOUNT_TARGET vars.
def _parse_host_mounts() -> list[tuple[str, str]]:
    raw = os.getenv("HOST_MOUNTS", "").strip()
    mounts: list[tuple[str, str]] = []
    if raw:
        for pair in raw.split(","):
            pair = pair.strip()
            if not pair:
                continue
            if "=" in pair:
                src, tgt = pair.split("=", 1)
            else:
                src = tgt = pair
            mounts.append((src.rstrip("/") or "/", tgt.rstrip("/") or "/host"))
    if not mounts:
        src = os.getenv("HOST_MOUNT_SOURCE", "/").rstrip("/") or "/"
        tgt = os.getenv("HOST_MOUNT_TARGET", "/host").rstrip("/") or "/host"
        mounts = [(src, tgt)]
    return mounts

HOST_MOUNTS = _parse_host_mounts()
# Legacy single-mount accessors (first mount) for callers that only need one.
HOST_MOUNT_SOURCE, HOST_MOUNT_TARGET = HOST_MOUNTS[0]

# A face joins an existing person cluster only if cosine similarity to its centroid exceeds this
CLUSTER_MATCH_THRESHOLD = 0.6

# Image extensions recognized by the scanner
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
THUMB_DIR.mkdir(parents=True, exist_ok=True)
