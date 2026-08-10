#!/usr/bin/env python3
"""Face search API — standalone ML + backend.
Endpoints:
  POST /scan   -> scan folder, detect faces, store embeddings
  POST /search -> search face by uploaded image
  GET  /person -> list known persons
  GET  /person/:id/photos -> photos for person
"""
import os, shutil, uuid, math
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import numpy as np
from insightface.app import FaceAnalysis
from insightface.data import get_image as ins_get_image
import cv2

# Config
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "/tmp/face_search_uploads"))
DB_DIR = Path(os.getenv("DB_DIR", "/tmp/face_search_db"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
DB_DIR.mkdir(parents=True, exist_ok=True)

# In-memory storage (replace with PostgreSQL + pgvector later)
# Format: {photo_id: {"path": str, "faces": [{"bbox": [...], "embedding": np.ndarray, "person_id": str}]}}
photo_db: dict = {}
person_db: dict = {}  # person_id -> {"name": str, "embedding": np.ndarray (centroid)}

# Load face model
print("Loading face analysis model...")
face_app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
face_app.prepare(ctx_id=0, det_size=(640, 640))
print("Model loaded")

app = FastAPI(title="Face Search API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class PhotoInfo(BaseModel):
    photo_id: str
    path: str
    faces_detected: int
    persons: List[str]

class PersonInfo(BaseModel):
    person_id: str
    name: str
    photo_count: int

class SearchResult(BaseModel):
    photo_id: str
    path: str
    similarity: float
    person_id: Optional[str] = None

def get_embedding(image_path: str):
    """Detect faces + return embeddings."""
    img = cv2.imread(str(image_path))
    if img is None:
        return []
    faces = face_app.get(img)
    results = []
    for face in faces:
        bbox = face.bbox.astype(int).tolist()
        embedding = face.normed_embedding  # 512-d
        results.append({"bbox": bbox, "embedding": embedding})
    return results

def cosine_similarity(a, b):
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

@app.post("/scan")
async def scan_folder(folder: str = Form(...)):
    """Scan folder for images, detect faces, store embeddings."""
    folder_path = Path(folder)
    if not folder_path.exists():
        raise HTTPException(400, "Folder not found")
    
    image_exts = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
    files = [f for f in folder_path.rglob("*") if f.suffix.lower() in image_exts]
    
    scanned = 0
    total_faces = 0
    for img_path in files:
        photo_id = str(uuid.uuid4())
        faces = get_embedding(str(img_path))
        if not faces:
            continue
        
        photo_db[photo_id] = {
            "path": str(img_path),
            "faces": [{"bbox": f["bbox"], "embedding": f["embedding"], "person_id": None} for f in faces]
        }
        
        # Auto-assign to existing person or create new
        for face in photo_db[photo_id]["faces"]:
            best_match = None
            best_sim = 0.0
            for pid, pdata in person_db.items():
                sim = cosine_similarity(face["embedding"], pdata["embedding"])
                if sim > best_sim and sim > 0.6:  # threshold
                    best_sim = sim
                    best_match = pid
            
            if best_match:
                face["person_id"] = best_match
                person_db[best_match]["photo_count"] += 1
            else:
                new_pid = str(uuid.uuid4())
                face["person_id"] = new_pid
                person_db[new_pid] = {
                    "name": f"Person {len(person_db)+1}",
                    "embedding": face["embedding"],
                    "photo_count": 1
                }
        
        scanned += 1
        total_faces += len(faces)
    
    return {"scanned": scanned, "total_faces": total_faces, "persons": len(person_db)}

@app.post("/search")
async def search_face(file: UploadFile = File(...), threshold: float = 0.5):
    """Search photos by uploaded face image."""
    # Save uploaded file
    temp_path = UPLOAD_DIR / f"query_{uuid.uuid4()}.jpg"
    with open(temp_path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    
    # Get query embedding
    query_faces = get_embedding(str(temp_path))
    if not query_faces:
        temp_path.unlink()
        raise HTTPException(400, "No face detected in query image")
    
    query_emb = query_faces[0]["embedding"]
    results = []
    
    for photo_id, pdata in photo_db.items():
        for face in pdata["faces"]:
            sim = cosine_similarity(query_emb, face["embedding"])
            if sim >= threshold:
                results.append({
                    "photo_id": photo_id,
                    "path": pdata["path"],
                    "similarity": float(sim),
                    "person_id": face.get("person_id")
                })
    
    # Sort by similarity desc
    results.sort(key=lambda x: x["similarity"], reverse=True)
    temp_path.unlink()
    
    return {"results": results[:50], "total_matches": len(results)}

@app.get("/person")
async def list_persons():
    """List all known persons."""
    return {"persons": [
        {"person_id": pid, "name": pdata["name"], "photo_count": pdata["photo_count"]}
        for pid, pdata in person_db.items()
    ]}

@app.get("/person/{person_id}/photos")
async def get_person_photos(person_id: str):
    """Get all photos for a person."""
    if person_id not in person_db:
        raise HTTPException(404, "Person not found")
    
    photos = []
    for photo_id, pdata in photo_db.items():
        for face in pdata["faces"]:
            if face.get("person_id") == person_id:
                photos.append({"photo_id": photo_id, "path": pdata["path"]})
                break
    
    return {"person_id": person_id, "name": person_db[person_id]["name"], "photos": photos}

@app.get("/health")
async def health():
    return {"status": "ok", "photos": len(photo_db), "persons": len(person_db)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
