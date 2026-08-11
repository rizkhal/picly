"""Background scan execution + in-memory live progress registry.

The desktop app polls GET /scan/status/{id} while a scan runs; finished entries
are kept briefly so the UI can show a final summary. Safe for the single-worker
uvicorn process this API runs as.
"""
import json
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

import cv2
import numpy as np
from pgvector.sqlalchemy import Vector
from sqlalchemy import bindparam, text

from app import ml
from app.config import CLUSTER_MATCH_THRESHOLD, THUMB_DIR
from app.db import db_connect
from app.log import log
from app.schemas import ScanStatus

scan_progress: Dict[str, Dict[str, Any]] = {}
scan_progress_lock = threading.Lock()
MAX_SCAN_ENTRIES = 25


def new_scan_entry(folder: str, total: int) -> str:
    """Create a progress entry for a scan and return its scan id."""
    scan_id = str(uuid.uuid4())
    with scan_progress_lock:
        # Keep the registry bounded: drop the oldest finished entries if needed
        if len(scan_progress) >= MAX_SCAN_ENTRIES:
            finished = [k for k, e in scan_progress.items() if e.get("status") in ("done", "error", "cancelled")]
            finished.sort(key=lambda k: scan_progress[k].get("finished_at") or 0)
            for k in finished[: max(0, len(scan_progress) - MAX_SCAN_ENTRIES + 1)]:
                del scan_progress[k]
        scan_progress[scan_id] = {
            "scan_id": scan_id,
            "folder": folder,
            "total": total,
            "processed": 0,
            "scanned": 0,
            "total_faces": 0,
            "persons": 0,
            "thumbs_generated": 0,
            "errors": 0,
            "status": "queued",  # queued -> running -> done | error | cancelled
            "cancel_requested": False,
            "current_file": None,
            "started_at": time.time(),
            "finished_at": None,
        }
    return scan_id


def update_scan(scan_id: str, **fields: Any) -> None:
    """Atomically update a scan progress entry."""
    with scan_progress_lock:
        entry = scan_progress.get(scan_id)
        if entry:
            entry.update(fields)


def scan_snapshot(scan_id: str) -> Optional[Dict[str, Any]]:
    """Return a copy of a scan progress entry (safe to hand to the client)."""
    with scan_progress_lock:
        entry = scan_progress.get(scan_id)
        return dict(entry) if entry else None


def scan_cancel_requested(scan_id: str) -> bool:
    """Whether a cancel has been requested for this scan (checked between photos)."""
    with scan_progress_lock:
        entry = scan_progress.get(scan_id)
        return bool(entry and entry.get("cancel_requested"))


def scan_folder_task(folder_path: str, files: List[Path], scan_id: str) -> ScanStatus:
    """Background task for scanning folders; publishes live progress to the registry."""
    scanned = 0
    total_faces = 0
    thumbs_generated = 0
    errors = 0
    processed = 0
    total = len(files)

    update_scan(scan_id, status="running", total=total)
    log.info(f"Starting scan of {total} files in {folder_path}")

    # Cancelled while still queued (task had not started yet)?
    if scan_cancel_requested(scan_id):
        update_scan(scan_id, status="cancelled", processed=0, finished_at=time.time())
        log.info(f"Scan {scan_id[:8]} cancelled before start")
        return ScanStatus(scanned=0, total_faces=0, persons=0, thumbs_generated=0)

    try:
        with db_connect() as conn:
            # Raise HNSW recall for centroid matching (session-level: survives per-photo commits)
            conn.execute(text("SET hnsw.ef_search = 100"))
            for img_path in files:
                if scan_cancel_requested(scan_id):
                    break
                processed += 1
                update_scan(scan_id, processed=processed, current_file=str(img_path))
                try:
                    photo_path = str(img_path)

                    # Content hash dedup: skip exact duplicates regardless of path
                    try:
                        file_hash = ml.compute_file_hash(photo_path)
                    except Exception as e:
                        log.error(f"Hash error for {photo_path}: {e}")
                        errors += 1
                        update_scan(scan_id, errors=errors)
                        continue

                    existing = conn.execute(
                        text("SELECT 1 FROM photos WHERE content_hash = :h LIMIT 1"), {"h": file_hash}
                    ).fetchone()
                    if existing:
                        log.debug(f"Skip duplicate (hash match): {photo_path}")
                        continue

                    # Fallback: also skip same path if hash column is empty (legacy rows)
                    existing_path = conn.execute(
                        text("SELECT 1 FROM photos WHERE path = :p LIMIT 1"), {"p": photo_path}
                    ).fetchone()
                    if existing_path:
                        continue

                    photo_id = str(uuid.uuid4())
                    faces_data = ml.get_embedding(photo_path)
                    if not faces_data:
                        continue

                    # Generate thumbnail
                    thumb_name = f"{photo_id}.jpg"
                    thumb_path = THUMB_DIR / thumb_name
                    thumb_ok = ml.make_thumbnail(str(img_path), str(thumb_path))
                    if thumb_ok:
                        thumbs_generated += 1

                    # Insert photo with content hash + metadata
                    img = cv2.imread(str(img_path))
                    height, width = img.shape[:2] if img is not None else (None, None)
                    metadata = ml.extract_exif(photo_path)
                    conn.execute(text("""
                        INSERT INTO photos (id, path, width, height, thumb_path, content_hash, metadata)
                        VALUES (:id, :path, :w, :h, :thumb, :hash, :meta)
                    """), {
                        "id": photo_id,
                        "path": str(img_path),
                        "w": width,
                        "h": height,
                        "thumb": str(thumb_path) if thumb_ok else None,
                        "hash": file_hash,
                        "meta": json.dumps(metadata) if metadata else None
                    })

                    for face in faces_data:
                        face_id = str(uuid.uuid4())
                        bbox = face["bbox"]
                        embedding = face["embedding"]
                        emb_list = embedding.tolist()

                        # Find best matching person via pgvector (indexed top-1 centroid match)
                        match = conn.execute(
                            text("""
                                SELECT id, 1 - (embedding_centroid_vector <=> :q) AS sim
                                FROM persons
                                WHERE embedding_centroid_vector IS NOT NULL
                                ORDER BY embedding_centroid_vector <=> :q
                                LIMIT 1
                            """).bindparams(bindparam("q", type_=Vector(512))),
                            {"q": emb_list}
                        ).fetchone()

                        # Assign to the best person only if similarity clears the cluster threshold
                        person_id = match[0] if match and match[1] > CLUSTER_MATCH_THRESHOLD else None
                        if not person_id:
                            person_id = str(uuid.uuid4())
                            conn.execute(text("""
                                INSERT INTO persons (id, name, embedding_centroid, embedding_centroid_vector)
                                VALUES (:id, :name, :centroid, :centroid_vec)
                            """).bindparams(bindparam("centroid_vec", type_=Vector(512))), {
                                "id": person_id,
                                "name": f"Person {scanned + 1}",
                                "centroid": emb_list,
                                "centroid_vec": emb_list,
                            })
                        else:
                            row = conn.execute(text("SELECT embedding_centroid FROM persons WHERE id = :id"), {"id": person_id}).fetchone()
                            old_centroid = np.array(row.embedding_centroid if row and row.embedding_centroid is not None else emb_list, dtype=np.float32)
                            new_centroid = (old_centroid + np.array(emb_list, dtype=np.float32)) / 2
                            conn.execute(text("""
                                UPDATE persons SET embedding_centroid = :centroid,
                                                   embedding_centroid_vector = :centroid_vec,
                                                   updated_at = now()
                                WHERE id = :id
                            """).bindparams(bindparam("centroid_vec", type_=Vector(512))), {
                                "centroid": new_centroid.tolist(),
                                "centroid_vec": new_centroid.tolist(),
                                "id": person_id,
                            })

                        conn.execute(text("""
                            INSERT INTO faces (id, photo_id, person_id, bbox, embedding, embedding_vector)
                            VALUES (:id, :pid, :person_id, :bbox, :embedding, :emb_vec)
                        """).bindparams(bindparam("emb_vec", type_=Vector(512))), {
                            "id": face_id,
                            "pid": photo_id,
                            "person_id": person_id,
                            "bbox": bbox,
                            "embedding": emb_list,
                            "emb_vec": emb_list
                        })

                    conn.commit()
                    scanned += 1
                    total_faces += len(faces_data)
                    update_scan(scan_id, scanned=scanned, total_faces=total_faces,
                                thumbs_generated=thumbs_generated)

                except Exception as e:
                    errors += 1
                    log.error(f"Error processing {img_path}: {e}")
                    update_scan(scan_id, errors=errors)
                    continue
    except Exception as e:
        log.error(f"Scan {scan_id[:8]} failed: {e}", exc_info=True)
        update_scan(scan_id, status="error", errors=errors, processed=processed,
                    current_file=None, finished_at=time.time())
        return ScanStatus(scanned=scanned, total_faces=total_faces, persons=0,
                          thumbs_generated=thumbs_generated)

    if scan_cancel_requested(scan_id):
        update_scan(scan_id, status="cancelled", processed=processed, scanned=scanned,
                    total_faces=total_faces, thumbs_generated=thumbs_generated, errors=errors,
                    current_file=None, finished_at=time.time())
        log.info(f"Scan {scan_id[:8]} cancelled after {processed}/{total} files")
        return ScanStatus(scanned=scanned, total_faces=total_faces, persons=0,
                          thumbs_generated=thumbs_generated)

    try:
        with db_connect() as conn:
            person_count = conn.execute(text("SELECT COUNT(*) FROM persons")).scalar()
    except Exception as e:
        log.error(f"Scan {scan_id[:8]} could not count persons: {e}")
        person_count = 0

    update_scan(
        scan_id,
        status="done",
        processed=processed,
        scanned=scanned,
        total_faces=total_faces,
        persons=person_count,
        thumbs_generated=thumbs_generated,
        errors=errors,
        current_file=None,
        finished_at=time.time(),
    )
    log.info(f"Scan complete: {scanned} photos, {total_faces} faces, {person_count} persons, {thumbs_generated} thumbs, {errors} errors")
    return ScanStatus(scanned=scanned, total_faces=total_faces, persons=person_count, thumbs_generated=thumbs_generated)
