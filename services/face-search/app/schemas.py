"""Pydantic request/response models."""
from typing import List, Optional

from pydantic import BaseModel, Field, validator


class PhotoInfo(BaseModel):
    photo_id: str
    path: str
    width: Optional[int] = None
    height: Optional[int] = None
    thumb_path: Optional[str] = None
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
    thumb_path: Optional[str] = None
    similarity: float = Field(..., ge=0.0, le=1.0)
    person_id: Optional[str] = None


class ScanStatus(BaseModel):
    scanned: int
    total_faces: int
    persons: int
    thumbs_generated: int
