"""Person endpoints: list, photos, rename, delete, previews."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from app.auth import verify_api_key
from app.db import db_connect
from app.schemas import PersonRename
from app.utils import host_path

router = APIRouter()
auth = [Depends(verify_api_key)]


@router.get("/person", dependencies=auth)
async def list_persons():
    """List all known persons with photo counts."""
    with db_connect() as conn:
        rows = conn.execute(text("""
            SELECT p.id, p.name, COUNT(f.id) as photo_count
            FROM persons p LEFT JOIN faces f ON p.id = f.person_id
            GROUP BY p.id, p.name
            HAVING COUNT(f.id) > 0
            ORDER BY photo_count DESC
        """)).fetchall()
        persons = [{"person_id": r[0], "name": r[1], "photo_count": r[2]} for r in rows]
    return {"persons": persons}


@router.get("/person/previews", dependencies=auth)
async def list_person_previews(limit: int = 12):
    """Return persons with one face crop URL each for the rounded-face bar."""
    with db_connect() as conn:
        rows = conn.execute(text("""
            SELECT p.id, p.name, COUNT(f.id) as photo_count,
                   MIN(f.id) as face_id
            FROM persons p
            LEFT JOIN faces f ON f.person_id = p.id
            GROUP BY p.id, p.name
            HAVING COUNT(f.id) > 0
            ORDER BY photo_count DESC
            LIMIT :limit
        """), {"limit": limit}).fetchall()
        result = []
        for r in rows:
            pid, name, count, face_id = r
            result.append({
                "person_id": pid,
                "name": name,
                "photo_count": count or 0,
                "face_id": face_id,
            })
    return {"persons": result}


@router.get("/person/{person_id}/photos", dependencies=auth)
async def get_person_photos(person_id: str):
    """Get all photos for a person."""
    with db_connect() as conn:
        row = conn.execute(text("SELECT name FROM persons WHERE id = :id"), {"id": person_id}).fetchone()
        if not row:
            raise HTTPException(404, "Person not found")

        photos = conn.execute(text("""
            SELECT DISTINCT p.id, p.path, p.thumb_path, p.width, p.height, p.created_at
            FROM photos p
            JOIN faces f ON p.id = f.photo_id
            WHERE f.person_id = :id
            ORDER BY p.created_at DESC
        """), {"id": person_id}).fetchall()

        photo_list = [{"photo_id": r[0], "path": host_path(r[1]), "thumb_path": r[2], "width": r[3], "height": r[4], "created_at": r[5].isoformat() if r[5] else None} for r in photos]
    return {"person_id": person_id, "name": row[0], "photos": photo_list}


@router.patch("/person/{person_id}/rename", dependencies=auth)
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


@router.delete("/person/{person_id}", dependencies=auth)
async def delete_person(person_id: str):
    """Delete a person and their face data."""
    with db_connect() as conn:
        conn.execute(text("DELETE FROM faces WHERE person_id = :id"), {"id": person_id})
        result = conn.execute(text("DELETE FROM persons WHERE id = :id"), {"id": person_id})
        conn.commit()
        if result.rowcount == 0:
            raise HTTPException(404, "Person not found")
    return {"status": "ok"}
