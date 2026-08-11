"""Face detection model and image helpers (embeddings, thumbnails, hashing, EXIF)."""
from typing import Any, Dict, List, Optional

import cv2
import numpy as np
from insightface.app import FaceAnalysis

from app.config import THUMB_SIZE
from app.log import log

face_app = None  # set by load_model() at startup


def load_model() -> None:
    """Load the InsightFace model (CPU). Called once at startup before serving."""
    global face_app
    log.info("Loading face analysis model...")
    try:
        face_app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
        face_app.prepare(ctx_id=0, det_size=(640, 640))
        log.info("Model loaded successfully")
    except Exception as e:
        log.error(f"Failed to load face model: {e}")
        raise


def get_embedding(image_path: str) -> List[Dict[str, Any]]:
    """Detect faces and return embeddings."""
    if face_app is None:
        raise RuntimeError("Face model not loaded — call ml.load_model() at startup")
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


def make_thumbnail(src_path: str, dest_path: str, size: int = THUMB_SIZE) -> bool:
    """Generate square thumbnail preserving aspect ratio."""
    try:
        img = cv2.imread(str(src_path))
        if img is None:
            return False
        h, w = img.shape[:2]
        side = min(h, w)
        x = (w - side) // 2
        y = (h - side) // 2
        crop = img[y:y+side, x:x+side]
        thumb = cv2.resize(crop, (size, size), interpolation=cv2.INTER_AREA)
        cv2.imwrite(str(dest_path), thumb, [cv2.IMWRITE_JPEG_QUALITY, 85])
        return True
    except Exception as e:
        log.error(f"Thumbnail error for {src_path}: {e}")
        return False


def compute_file_hash(path: str, chunk_size: int = 65536) -> str:
    """Compute xxHash of file contents for deduplication."""
    import xxhash
    h = xxhash.xxh64()
    with open(path, "rb") as f:
        while chunk := f.read(chunk_size):
            h.update(chunk)
    return h.hexdigest()


def extract_exif(path: str) -> Optional[Dict[str, Any]]:
    """Extract relevant EXIF metadata for similar-photos detection."""
    try:
        from PIL import Image, ExifTags
        img = Image.open(path)
        exif = img._getexif() or {}
        if not exif:
            return None
        tags = {ExifTags.TAGS.get(k, k): v for k, v in exif.items()}
        meta: Dict[str, Any] = {}
        dt = tags.get("DateTimeOriginal") or tags.get("DateTime") or tags.get("DateTimeDigitized")
        if dt:
            meta["datetime"] = str(dt)
        gps = tags.get("GPSInfo")
        if gps:
            def _deg(v): return float(v[0]) / float(v[1])
            try:
                lat = _deg(gps[2]) * (1 if gps[1] == b"N" else -1)
                lon = _deg(gps[4]) * (1 if gps[3] == b"E" else -1)
                meta["gps"] = {"lat": lat, "lon": lon}
            except Exception:
                pass
        make = tags.get("Make")
        model = tags.get("Model")
        if make:
            meta["make"] = str(make).strip()
        if model:
            meta["model"] = str(model).strip()
        return meta or None
    except Exception:
        return None
