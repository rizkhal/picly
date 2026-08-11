"""Photo endpoints: listing, thumbnails, face crops, similar, delete."""
from datetime import datetime
from math import atan2, cos, radians, sin, sqrt
from pathlib import Path
from typing import Optional

import cv2
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, Response
from sqlalchemy import text

from app.auth import verify_api_key
from app.db import db_connect
from app.utils import host_path

router = APIRouter()
auth = [Depends(verify_api_key)]


@router.get("/photos", dependencies=auth)
async def list_all_photos(limit: int = 200, offset: int = 0, folder_path: Optional[str] = None):
    """List all photos with thumbnails, optionally scoped to a folder (container path)."""
    params = {"limit": limit, "offset": offset}
    folder_clause = ""
    if folder_path:
        params["fp"] = folder_path
        folder_clause = "WHERE starts_with(p.path, :fp || '/')"
    with db_connect() as conn:
        rows = conn.execute(text(f"""
            SELECT p.id, p.path, p.thumb_path, p.width, p.height, p.created_at,
                   COUNT(f.id) as face_count,
                   MAX(CASE WHEN f.person_id IS NOT NULL THEN p2.name END) as person_name
            FROM photos p
            LEFT JOIN faces f ON p.id = f.photo_id
            LEFT JOIN persons p2 ON f.person_id = p2.id
            {folder_clause}
            GROUP BY p.id, p.path, p.thumb_path, p.width, p.height, p.created_at
            ORDER BY p.created_at DESC
            LIMIT :limit OFFSET :offset
        """), params).fetchall()

        photos = [{
            "photo_id": r[0],
            "path": host_path(r[1]),
            "thumb_path": r[2],
            "width": r[3],
            "height": r[4],
            "created_at": r[5].isoformat() if r[5] else None,
            "face_count": r[6],
            "person_name": r[7]
        } for r in rows]
    return {"photos": photos, "limit": limit, "offset": offset}


@router.get("/similar/{photo_id}", dependencies=auth)
async def get_similar_photos(photo_id: str, max_distance_m: int = 100, time_window_seconds: int = 3600):
    """Find similar photos by metadata (GPS + datetime + camera) and shared faces."""
    with db_connect() as conn:
        row = conn.execute(text("""
            SELECT p.id, p.path, p.thumb_path, p.metadata, p.created_at
            FROM photos p WHERE p.id = :id
        """), {"id": photo_id}).fetchone()
        if not row:
            raise HTTPException(404, "Photo not found")

        src_id, src_path, src_thumb, src_meta, src_created = row
        if not src_meta:
            return {"photo_id": photo_id, "similar": [], "reason": "no metadata"}

        src_meta = dict(src_meta) if isinstance(src_meta, dict) else {}
        similar = []

        # Metadata-based similarity
        candidates = conn.execute(text("""
            SELECT p.id, p.path, p.thumb_path, p.metadata, p.created_at
            FROM photos p
            WHERE p.id != :id AND p.metadata IS NOT NULL
        """), {"id": photo_id}).fetchall()

        seen = set()
        for cid, cpath, cthumb, cmeta, ccreated in candidates:
            cmeta = dict(cmeta) if isinstance(cmeta, dict) else {}
            score = 0.0
            reasons = []

            # Time proximity
            src_dt = src_meta.get("datetime")
            c_dt = cmeta.get("datetime")
            if src_dt and c_dt:
                try:
                    t1 = datetime.strptime(src_dt, "%Y:%m:%d %H:%M:%S")
                    t2 = datetime.strptime(c_dt, "%Y:%m:%d %H:%M:%S")
                    diff = abs((t1 - t2).total_seconds())
                    if diff <= time_window_seconds:
                        score += 0.4
                        reasons.append("time")
                except Exception:
                    pass

            # GPS proximity
            src_gps = src_meta.get("gps")
            c_gps = cmeta.get("gps")
            if src_gps and c_gps:
                try:
                    lat1, lon1 = radians(src_gps["lat"]), radians(src_gps["lon"])
                    lat2, lon2 = radians(c_gps["lat"]), radians(c_gps["lon"])
                    dlat = lat1 - lat2
                    dlon = lon1 - lon2
                    a = cos(lat1) * cos(lat2) * sin(dlon/2)**2 + sin(dlat/2)**2
                    d = 6371000 * 2 * atan2(sqrt(a), sqrt(1-a))
                    if d <= max_distance_m:
                        score += 0.4
                        reasons.append("location")
                except Exception:
                    pass

            # Camera model
            if src_meta.get("model") and cmeta.get("model"):
                if src_meta["model"] == cmeta["model"]:
                    score += 0.2
                    reasons.append("camera")

            if score > 0:
                similar.append({
                    "photo_id": cid,
                    "path": host_path(cpath),
                    "thumb_path": cthumb,
                    "score": round(score, 3),
                    "reasons": reasons
                })
                seen.add(cid)

        similar.sort(key=lambda x: x["score"], reverse=True)
        similar = similar[:20]

        # Face-based similarity: other photos sharing same persons
        face_rows = conn.execute(text("""
            SELECT f2.photo_id, p2.path, p2.thumb_path, COUNT(*) as shared_faces
            FROM faces f1
            JOIN faces f2 ON f1.person_id = f2.person_id AND f1.photo_id != f2.photo_id
            JOIN photos p2 ON p2.id = f2.photo_id
            WHERE f1.photo_id = :src_id
            GROUP BY f2.photo_id, p2.path, p2.thumb_path
            ORDER BY shared_faces DESC
            LIMIT 20
        """), {"src_id": photo_id}).fetchall()

        face_similar = []
        for pid, path, thumb, count in face_rows:
            if pid not in seen:
                face_similar.append({
                    "photo_id": pid,
                    "path": host_path(path),
                    "thumb_path": thumb,
                    "score": 0.5 + (count * 0.1),
                    "reasons": [f"faces({count})"]
                })
                seen.add(pid)

        face_similar.sort(key=lambda x: x["score"], reverse=True)

        return {
            "photo_id": photo_id,
            "similar": {
                "by_metadata": similar,
                "by_faces": face_similar[:10]
            }
        }


@router.get("/thumb/{photo_id}", dependencies=auth)
async def get_thumbnail(photo_id: str):
    """Serve cached thumbnail."""
    with db_connect() as conn:
        row = conn.execute(text("SELECT thumb_path FROM photos WHERE id = :id"), {"id": photo_id}).fetchone()
        if not row or not row[0]:
            raise HTTPException(404, "Thumbnail not found")
        thumb_path = row[0]

    if not Path(thumb_path).exists():
        raise HTTPException(404, "Thumbnail file missing")

    return FileResponse(thumb_path, media_type="image/jpeg")


@router.get("/face/{face_id}", dependencies=auth)
async def get_face_crop(face_id: str):
    """Serve a cropped face thumbnail for the given face (Google-Photos-style)."""
    with db_connect() as conn:
        row = conn.execute(text("""
            SELECT f.bbox, p.thumb_path, p.path, p.width, p.height
            FROM faces f JOIN photos p ON f.photo_id = p.id
            WHERE f.id = :id
        """), {"id": face_id}).fetchone()
        if not row:
            raise HTTPException(404, "Face not found")
        bbox, thumb_path, photo_path, orig_w, orig_h = row

    if bbox is None or len(bbox) < 4:
        raise HTTPException(404, "Face has no bounding box")

    # Use the thumbnail as source when available (smaller/faster); else the full image.
    src = thumb_path if thumb_path and Path(thumb_path).exists() else photo_path
    if not src or not Path(src).exists():
        raise HTTPException(404, "Source image missing")

    img = cv2.imread(src)
    if img is None:
        raise HTTPException(404, "Could not decode source image")
    h, w = img.shape[:2]
    x1, y1, x2, y2 = [int(v) for v in bbox]

    # If using the thumbnail, scale bbox from original image coords to thumbnail coords.
    if src == thumb_path and orig_w and orig_h:
        side = min(orig_w, orig_h)
        off_x = (orig_w - side) // 2
        off_y = (orig_h - side) // 2
        scale = w / side  # thumbnail is square: THUMB_SIZE x THUMB_SIZE
        x1 = int((x1 - off_x) * scale)
        y1 = int((y1 - off_y) * scale)
        x2 = int((x2 - off_x) * scale)
        y2 = int((y2 - off_y) * scale)

    # Clamp to image bounds, add slight padding, square-crop around the face.
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(w, x2), min(h, y2)
    pad = int((y2 - y1) * 0.2)
    x1, y1 = max(0, x1 - pad), max(0, y1 - pad)
    x2, y2 = min(w, x2 + pad), min(h, y2 + pad)
    side = max(x2 - x1, y2 - y1)
    cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
    half = side // 2
    sx1, sy1 = max(0, cx - half), max(0, cy - half)
    sx2, sy2 = min(w, cx + half), min(h, cy + half)
    crop = img[sy1:sy2, sx1:sx2]

    ok, buf = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 88])
    if not ok:
        raise HTTPException(500, "Face crop encoding failed")
    return Response(content=buf.tobytes(), media_type="image/jpeg")


@router.delete("/photo/{photo_id}", dependencies=auth)
async def delete_photo(photo_id: str):
    """Delete a photo and its face data."""
    with db_connect() as conn:
        row = conn.execute(text("SELECT path, thumb_path FROM photos WHERE id = :id"), {"id": photo_id}).fetchone()
        conn.execute(text("DELETE FROM faces WHERE photo_id = :id"), {"id": photo_id})
        result = conn.execute(text("DELETE FROM photos WHERE id = :id"), {"id": photo_id})
        # Drop persons that no longer have any faces anywhere (this was their last photo)
        conn.execute(text("""
            DELETE FROM persons
            WHERE id NOT IN (SELECT DISTINCT person_id FROM faces WHERE person_id IS NOT NULL)
        """))
        conn.commit()
        if result.rowcount == 0:
            raise HTTPException(404, "Photo not found")
        # Remove thumbnail file
        if row and row[1] and Path(row[1]).exists():
            Path(row[1]).unlink()
    return {"status": "ok"}
