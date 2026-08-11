"""System endpoints: health, readiness, stats, disks, config."""
from datetime import datetime

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.auth import verify_api_key
from app.config import HOST_MOUNTS
from app.db import db_connect
from app.log import log
from app.utils import enumerate_mounts

router = APIRouter()
auth = [Depends(verify_api_key)]


@router.get("/health")
async def health():
    """Health check with DB connectivity."""
    try:
        with db_connect() as conn:
            photo_count = conn.execute(text("SELECT COUNT(*) FROM photos")).scalar()
            person_count = conn.execute(text("SELECT COUNT(*) FROM persons")).scalar()
            db_status = "connected"
    except Exception as e:
        log.error(f"Health check DB error: {e}")
        db_status = "disconnected"
        photo_count = person_count = -1

    return {
        "status": "ok",
        "database": db_status,
        "photos": photo_count,
        "persons": person_count,
        "timestamp": datetime.utcnow().isoformat()
    }


@router.get("/ready")
async def ready():
    """Kubernetes-style readiness probe."""
    try:
        with db_connect() as conn:
            conn.execute(text("SELECT 1")).scalar()
        return {"status": "ready"}
    except Exception:
        return JSONResponse(status_code=503, content={"status": "not ready"})


@router.get("/stats", dependencies=auth)
async def get_stats():
    """Get database statistics."""
    with db_connect() as conn:
        stats = conn.execute(text("""
            SELECT
                (SELECT COUNT(*) FROM photos) as total_photos,
                (SELECT COUNT(*) FROM persons) as total_persons,
                (SELECT COUNT(*) FROM faces) as total_faces,
                (SELECT COUNT(*) FROM photos WHERE thumb_path IS NOT NULL) as photos_with_thumbs,
                (SELECT pg_size_pretty(pg_database_size('picly'))) as db_size
        """)).fetchone()
    return {
        "total_photos": stats[0],
        "total_persons": stats[1],
        "total_faces": stats[2],
        "photos_with_thumbs": stats[3],
        "db_size": stats[4]
    }


@router.get("/disks", dependencies=auth)
async def list_disks():
    """List real mounted volumes/drives (no hardcoded host paths)."""
    return {"roots": enumerate_mounts()}


@router.get("/config", dependencies=auth)
async def get_config():
    """Expose the host mount mapping(s) so the desktop app can translate picked folders."""
    mounts = [{"source": s, "target": t} for s, t in HOST_MOUNTS]
    first = mounts[0] if mounts else {"source": "/", "target": "/host"}
    return {
        "mounts": mounts,
        # Legacy single-mount keys (first root) for older desktop builds
        "host_mount_source": first["source"],
        "host_mount_target": first["target"],
    }
