#!/usr/bin/env python3
"""Picly — production-grade face search API."""
import os, shutil, uuid, math, logging, time, hashlib
from pathlib import Path
from datetime import datetime
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, validator
import numpy as np
from insightface.app import FaceAnalysis
import cv2
from sqlalchemy import create_engine, text, event
from sqlalchemy.pool import QueuePool
from sqlalchemy.exc import SQLAlchemyError

# Config
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "/tmp/picly_uploads"))
DB_URL = os.getenv("DATABASE_URL", "postgresql://postgres@localhost/picly")
API_KEY = os.getenv("PICLY_API_KEY")  # Optional auth
SCAN_THRESHOLD = int(os.getenv("SCAN_THRESHOLD", "1000"))  # Background if > N files
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    handlers=[logging.StreamHandler()]
)
log = logging.getLogger("picly")

# Database engine with production settings
engine = create_engine(
    DB_URL,
    poolclass=QueuePool,
    pool_size=5,
    max_overflow=10,
    pool_pre_ping=True,  # Verify connections before use
    pool_recycle=3600,   # Recycle connections after 1h
    echo=False,
    future=True
)

@event.listens_for(engine, "connect")
def set_postgres_timezone(conn, record):
    conn.execute(text("SET timezone = 'UTC'"))

# Face model
log.info("Loading face analysis model...")
try:
    face_app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
    face_app.prepare(ctx_id=0, det_size=(640, 640))
    log.info("Model loaded successfully")
except Exception as e:
    log.error(f"Failed to load face model: {e}")
    raise

app = FastAPI(
    title="Picly",
    version="1.0.0",
    description="Production-grade face search API",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Middleware
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Auth ---
async def verify_api_key(request: Request):
    if not API_KEY:
        return
    key = request.headers.get("X-API-Key")
    if key != API_KEY:
        raise HTTPException(status_code=403, detail="Invalid API key")

# --- Models ---
class PhotoInfo(BaseModel):
    photo_id: str
    path: str
    width: Optional[int] = None
    height: Optional[int] = None
    faces_detected: int
    persons: List[str]

class PersonInfo(BaseModel):
    person_id: str
    name: str
    photo_count: int

class PersonRename(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)

    @validator("name")
    def name_must_not_be_empty(cls, v):
        if not v.strip():
            raise ValueError("Name cannot be empty")
        return v.strip()

class SearchResult(BaseModel):
    photo_id: str
    path: str
    similarity: float = Field(..., ge=0.0, le=1.0)
    person_id: Optional[str] = None

class ScanStatus(BaseModel):
    scanned: int
    total_faces: int
    persons: int

class SearchRequest(BaseModel):
    threshold: float = Field(0.5, ge=0.0, le=1.0)
    limit: int = Field(50, ge=1, le=200)

class ErrorResponse(BaseModel):
    detail: str
    timestamp: str
    path: str

# --- Helpers ---
def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))

def get_embedding(image_path: str) -> List[Dict[str, Any]]:
    """Detect faces and return embeddings."""
    try:
        img = cv2.imread(str(image_path))
        if img is None:
            return []
        faces = face_app.get(img)
        results = []
        for face in faces:
            bbox = face.bbox.astype(int).tolist()
            embedding = face.normed_embedding
            results.append({"bbox": bbox, "embedding": embedding})
        return results
    except Exception as e:
        log.error(f"Error processing {image_path}: {e}")
        return []

def db_connect():
    return engine.connect()

# --- Error handlers ---
@app.exception_handler(SQLAlchemyError)
async def db_exception_handler(request: Request, exc: SQLAlchemyError):
    log.error(f"Database error: {exc}")
    return JSONResponse(
        status_code=500,
        content={"detail": "Database error", "timestamp": datetime.utcnow().isoformat(), "path": str(request.url)}
    )

@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    log.error(f"Unhandled error: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "timestamp": datetime.utcnow().isoformat(), "path": str(request.url)}
    )

# --- Endpoints ---
@app.get("/health", dependencies=[Depends(verify_api_key)])
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

@app.post("/scan", response_model=ScanStatus, dependencies=[Depends(verify_api_key)])
async def scan_folder(
    background_tasks: BackgroundTasks,
    folder: str = Form(...)
):
    """Scan folder for images, detect faces, auto-cluster by person."""
    folder_path = Path(folder)
    if not folder_path.exists():
        raise HTTPException(400, f"Folder not found: {folder}")
    
    if not folder_path.is_dir():
        raise HTTPException(400, f"Path is not a directory: {folder}")
    
    image_exts = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
    files = [f for f in folder_path.rglob("*") if f.suffix.lower() in image_exts]
    
    if len(files) > SCAN_THRESHOLD:
        log.info(f"Large scan ({len(files)} files), backgrounding")
        background_tasks.add_task(scan_folder_task, str(folder_path), files)
        return ScanStatus(scanned=0, total_faces=0, persons=0)
    
    return scan_folder_task(str(folder_path), files)

def scan_folder_task(folder_path: str, files: List[Path]) -> ScanStatus:
    """Background task for scanning folders."""
    scanned = 0
    total_faces = 0
    errors = 0
    
    log.info(f"Starting scan of {len(files)} files in {folder_path}")
    
    with db_connect() as conn:
        for img_path in files:
            try:
                photo_id = str(uuid.uuid4())
                faces_data = get_embedding(str(img_path))
                if not faces_data:
                    continue
                
                # Insert photo
                img = cv2.imread(str(img_path))
                height, width = img.shape[:2] if img is not None else (None, None)
                conn.execute(text("""
                    INSERT INTO photos (id, path, width, height) VALUES (:id, :path, :w, :h)
                """), {"id": photo_id, "path": str(img_path), "w": width, "h": height})
                
                for face in faces_data:
                    face_id = str(uuid.uuid4())
                    bbox = face["bbox"]
                    embedding = face["embedding"]
                    
                    # Find best matching person
                    best_match = None
                    best_sim = 0.0
                    persons = conn.execute(text("SELECT id, embedding_centroid FROM persons")).fetchall()
                    for pid, centroid_json in persons:
                        if centroid_json is None:
                            continue
                        centroid = np.array(centroid_json, dtype=np.float32)
                        sim = cosine_similarity(embedding, centroid)
                        if sim > best_sim and sim > 0.6:
                            best_sim = sim
                            best_match = pid
                    
                    person_id = best_match
                    if not person_id:
                        person_id = str(uuid.uuid4())
                        conn.execute(text("""
                            INSERT INTO persons (id, name, embedding_centroid) VALUES (:id, :name, :centroid)
                        """), {"id": person_id, "name": f"Person {scanned + 1}", "centroid": embedding.tolist()})
                    else:
                        # Update centroid with running average
                        row = conn.execute(text("SELECT embedding_centroid FROM persons WHERE id = :id"), {"id": person_id}).fetchone()
                        old_centroid = np.array(row.embedding_centroid if row and row.embedding_centroid is not None else embedding, dtype=np.float32)
                        new_centroid = (old_centroid + embedding) / 2
                        conn.execute(text("""
                            UPDATE persons SET embedding_centroid = :centroid, updated_at = now() WHERE id = :id
                        """), {"centroid": new_centroid.tolist(), "id": person_id})
                    
                    conn.execute(text("""
                        INSERT INTO faces (id, photo_id, person_id, bbox, embedding)
                        VALUES (:id, :pid, :person_id, :bbox, :embedding)
                    """), {
                        "id": face_id,
                        "pid": photo_id,
                        "person_id": person_id,
                        "bbox": bbox,
                        "embedding": embedding.tolist()
                    })
                
                conn.commit()
                scanned += 1
                total_faces += len(faces_data)
                
            except Exception as e:
                errors += 1
                log.error(f"Error processing {img_path}: {e}")
                continue
    
    # Count persons
    with db_connect() as conn:
        person_count = conn.execute(text("SELECT COUNT(*) FROM persons")).scalar()
    
    log.info(f"Scan complete: {scanned} photos, {total_faces} faces, {person_count} persons, {errors} errors")
    return ScanStatus(scanned=scanned, total_faces=total_faces, persons=person_count)

@app.post("/search", dependencies=[Depends(verify_api_key)])
async def search_face(
    file: UploadFile = File(...),
    threshold: float = 0.5,
    limit: int = 50
):
    """Search photos by uploaded face image."""
    # Validate file type
    if not file.content_type or "image" not in file.content_type:
        raise HTTPException(400, "File must be an image")
    
    temp_path = UPLOAD_DIR / f"query_{uuid.uuid4()}.jpg"
    try:
        # Save uploaded file
        with open(temp_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
        
        # Get query embedding
        query_faces = get_embedding(str(temp_path))
        if not query_faces:
            raise HTTPException(400, "No face detected in query image")
        
        query_emb = query_faces[0]["embedding"]
        results = []
        
        # Search database
        with db_connect() as conn:
            rows = conn.execute(text("""
                SELECT f.id, f.photo_id, p.path, f.embedding, f.person_id
                FROM faces f JOIN photos p ON f.photo_id = p.id
            """)).fetchall()
            
            for row in rows:
                face_id, photo_id, path, embedding_json, person_id = row
                embedding = np.array(embedding_json, dtype=np.float32)
                sim = cosine_similarity(query_emb, embedding)
                if sim >= threshold:
                    results.append({
                        "photo_id": photo_id,
                        "path": path,
                        "similarity": round(sim, 4),
                        "person_id": person_id
                    })
        
        # Sort and limit
        results.sort(key=lambda x: x["similarity"], reverse=True)
        results = results[:limit]
        
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

@app.get("/person", dependencies=[Depends(verify_api_key)])
async def list_persons():
    """List all known persons with photo counts."""
    with db_connect() as conn:
        rows = conn.execute(text("""
            SELECT p.id, p.name, COUNT(f.id) as photo_count
            FROM persons p LEFT JOIN faces f ON p.id = f.person_id
            GROUP BY p.id, p.name
            ORDER BY photo_count DESC
        """)).fetchall()
        persons = [{"person_id": r[0], "name": r[1], "photo_count": r[2]} for r in rows]
    return {"persons": persons}

@app.get("/person/{person_id}/photos", dependencies=[Depends(verify_api_key)])
async def get_person_photos(person_id: str):
    """Get all photos for a person."""
    with db_connect() as conn:
        row = conn.execute(text("SELECT name FROM persons WHERE id = :id"), {"id": person_id}).fetchone()
        if not row:
            raise HTTPException(404, "Person not found")
        
        photos = conn.execute(text("""
            SELECT DISTINCT p.id, p.path, p.width, p.height
            FROM photos p
            JOIN faces f ON p.id = f.photo_id
            WHERE f.person_id = :id
            ORDER BY p.created_at DESC
        """), {"id": person_id}).fetchall()
        
        photo_list = [{"photo_id": r[0], "path": r[1], "width": r[2], "height": r[3]} for r in photos]
    return {"person_id": person_id, "name": row[0], "photos": photo_list}

@app.patch("/person/{person_id}/rename", dependencies=[Depends(verify_api_key)])
async def rename_person(person_id: str, payload: PersonRename):
    """Rename a person."""
    with db_connect() as conn:
        result = conn.execute(text("""
            UPDATE persons SET name = :name WHERE id = :id
        """), {"name": payload.name, "id": person_id})
        conn.commit()
        if result.rowcount == 0:
            raise HTTPException(404, "Person not found")
    return {"status": "ok", "person_id": person_id, "name": payload.name}

@app.delete("/person/{person_id}", dependencies=[Depends(verify_api_key)])
async def delete_person(person_id: str):
    """Delete a person and their face data."""
    with db_connect() as conn:
        conn.execute(text("DELETE FROM faces WHERE person_id = :id"), {"id": person_id})
        result = conn.execute(text("DELETE FROM persons WHERE id = :id"), {"id": person_id})
        conn.commit()
        if result.rowcount == 0:
            raise HTTPException(404, "Person not found")
    return {"status": "ok"}

@app.delete("/photo/{photo_id}", dependencies=[Depends(verify_api_key)])
async def delete_photo(photo_id: str):
    """Delete a photo and its face data."""
    with db_connect() as conn:
        conn.execute(text("DELETE FROM faces WHERE photo_id = :id"), {"id": photo_id})
        result = conn.execute(text("DELETE FROM photos WHERE id = :id"), {"id": photo_id})
        conn.commit()
        if result.rowcount == 0:
            raise HTTPException(404, "Photo not found")
    return {"status": "ok"}

@app.get("/stats", dependencies=[Depends(verify_api_key)])
async def get_stats():
    """Get database statistics."""
    with db_connect() as conn:
        stats = conn.execute(text("""
            SELECT 
                (SELECT COUNT(*) FROM photos) as total_photos,
                (SELECT COUNT(*) FROM persons) as total_persons,
                (SELECT COUNT(*) FROM faces) as total_faces,
                (SELECT COUNT(DISTINCT person_id) FROM faces) as persons_with_faces,
                (SELECT AVG(EXTRACT(EPOCH FROM (now() - created_at))) FROM photos) as avg_age_seconds
        """)).fetchone()
    return {
        "total_photos": stats[0],
        "total_persons": stats[1],
        "total_faces": stats[2],
        "persons_with_faces": stats[3],
        "avg_photo_age_seconds": round(stats[4], 2) if stats[4] else None
    }

@app.get("/ready")
async def ready():
    """Kubernetes-style readiness probe."""
    try:
        with db_connect() as conn:
            conn.execute(text("SELECT 1")).scalar()
        return {"status": "ready"}
    except Exception:
        return JSONResponse(status_code=503, content={"status": "not ready"})

if __name__ == "__main__":
    import uvicorn
    log.info("Starting Picly API server")
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info",
        access_log=True
    )
