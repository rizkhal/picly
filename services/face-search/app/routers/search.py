"""Face search endpoint."""
import shutil
import uuid

import numpy as np
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pgvector.sqlalchemy import Vector
from sqlalchemy import bindparam, text

from app import ml
from app.auth import verify_api_key
from app.config import UPLOAD_DIR
from app.db import db_connect
from app.log import log
from app.utils import host_path

router = APIRouter()
auth = [Depends(verify_api_key)]


@router.post("/search", dependencies=auth)
async def search_face(
    file: UploadFile = File(...),
    threshold: float = 0.5,
    limit: int = 50
):
    """Search photos by uploaded face image via pgvector (HNSW) cosine search."""
    if not file.content_type or "image" not in file.content_type:
        raise HTTPException(400, "File must be an image")

    temp_path = UPLOAD_DIR / f"query_{uuid.uuid4()}.jpg"
    try:
        with open(temp_path, "wb") as f:
            shutil.copyfileobj(file.file, f)

        query_faces = ml.get_embedding(str(temp_path))
        if not query_faces:
            raise HTTPException(400, "No face detected in query image")

        query_emb = query_faces[0]["embedding"].astype(np.float64).tolist()
        # Cosine distance = 1 - cosine similarity; clamp threshold into [0, 1]
        max_dist = 1.0 - max(0.0, min(threshold, 1.0))
        limit = max(1, min(limit, 200))

        stmt = text("""
            SELECT f.id, f.photo_id, p.path, p.thumb_path, f.bbox, f.person_id,
                   ROUND((1 - (f.embedding_vector <=> :q))::numeric, 4)::float8 AS similarity
            FROM faces f
            JOIN photos p ON f.photo_id = p.id
            WHERE f.embedding_vector <=> :q <= :dist
            ORDER BY f.embedding_vector <=> :q
            LIMIT :limit
        """).bindparams(
            bindparam("q", type_=Vector(512)),
            bindparam("dist"),
            bindparam("limit"),
        )

        with db_connect() as conn:
            # Raise HNSW recall for near-exact results on local libraries
            conn.execute(text("SET LOCAL hnsw.ef_search = 100"))
            rows = conn.execute(stmt, {"q": query_emb, "dist": max_dist, "limit": limit}).fetchall()

        results = [
            {
                "face_id": face_id,
                "photo_id": photo_id,
                "path": host_path(path),
                "thumb_path": thumb_path,
                "bbox": [int(v) for v in bbox_arr] if bbox_arr else None,
                "similarity": similarity,
                "person_id": person_id,
            }
            for face_id, photo_id, path, thumb_path, bbox_arr, person_id, similarity in rows
        ]

        log.info(f"Search completed: {len(results)} matches")
        return {"results": results, "total_matches": len(results)}

    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Search error: {e}")
        raise HTTPException(500, "Search failed")
    finally:
        if temp_path.exists():
            temp_path.unlink()
