"""Folder endpoints: list added folders, remove one (index + thumbnails only)."""
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from app.auth import verify_api_key
from app.db import db_connect
from app.log import log

router = APIRouter()
auth = [Depends(verify_api_key)]


@router.get("/folders", dependencies=auth)
async def list_folders():
    """List folders added via the desktop app, with photo counts and availability."""
    with db_connect() as conn:
        rows = conn.execute(text("""
            SELECT f.id, f.host_path, f.container_path, f.name, f.added_at, f.last_scanned_at,
                   COUNT(p.id) AS photo_count
            FROM folders f
            LEFT JOIN photos p ON starts_with(p.path, f.container_path || '/')
            GROUP BY f.id, f.host_path, f.container_path, f.name, f.added_at, f.last_scanned_at
            ORDER BY photo_count DESC, f.name ASC
        """)).fetchall()
        folders = []
        for r in rows:
            container_path = r[2]
            folders.append({
                "folder_id": r[0],
                "host_path": r[1],
                "container_path": container_path,
                "name": r[3],
                "added_at": r[4].isoformat() if r[4] else None,
                "last_scanned_at": r[5].isoformat() if r[5] else None,
                "photo_count": r[6] or 0,
                "available": Path(container_path).exists(),
            })
    return {"folders": folders}


@router.delete("/folder/{folder_id}", dependencies=auth)
async def delete_folder(folder_id: str):
    """Remove an added folder and all photos indexed under it (faces, thumbs, orphans)."""
    with db_connect() as conn:
        row = conn.execute(
            text("SELECT container_path FROM folders WHERE id = :id"), {"id": folder_id}
        ).fetchone()
        if not row:
            raise HTTPException(404, "Folder not found")
        container_path = row[0]
        prefix = container_path.rstrip("/") + "/"

        # Collect thumbnails to unlink *after* the DB commit succeeds
        thumbs = conn.execute(
            text("SELECT thumb_path FROM photos WHERE starts_with(path, :prefix)"), {"prefix": prefix}
        ).fetchall()

        faces_deleted = conn.execute(text("""
            DELETE FROM faces
            WHERE photo_id IN (SELECT id FROM photos WHERE starts_with(path, :prefix))
        """), {"prefix": prefix}).rowcount
        photos_deleted = conn.execute(
            text("DELETE FROM photos WHERE starts_with(path, :prefix)"), {"prefix": prefix}
        ).rowcount
        conn.execute(text("DELETE FROM folders WHERE id = :id"), {"id": folder_id})
        # Drop persons that no longer have any faces anywhere
        conn.execute(text("""
            DELETE FROM persons
            WHERE id NOT IN (SELECT DISTINCT person_id FROM faces WHERE person_id IS NOT NULL)
        """))
        conn.commit()

    thumbs_deleted = 0
    for (tp,) in thumbs:
        if tp and Path(tp).exists():
            try:
                Path(tp).unlink()
                thumbs_deleted += 1
            except OSError:
                pass

    log.info(f"Folder {folder_id} removed: {photos_deleted} photos, {faces_deleted} faces, {thumbs_deleted} thumbs")
    return {"status": "ok", "folder_id": folder_id,
            "photos_deleted": photos_deleted, "faces_deleted": faces_deleted,
            "thumbs_deleted": thumbs_deleted}
