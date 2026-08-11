CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS persons (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'Person',
    embedding_centroid DOUBLE PRECISION[],
    embedding_centroid_vector VECTOR(512),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    thumb_path TEXT,
    content_hash TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS faces (
    id TEXT PRIMARY KEY,
    photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    person_id TEXT REFERENCES persons(id) ON DELETE SET NULL,
    bbox INTEGER[] NOT NULL,
    embedding DOUBLE PRECISION[] NOT NULL,
    embedding_vector VECTOR(512),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_faces_photo_id ON faces(photo_id);
CREATE INDEX IF NOT EXISTS idx_faces_person_id ON faces(person_id);
CREATE INDEX IF NOT EXISTS idx_photos_created_at ON photos(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_photos_path ON photos(path);
CREATE UNIQUE INDEX IF NOT EXISTS uq_photos_content_hash ON photos(content_hash);
CREATE INDEX IF NOT EXISTS idx_photos_metadata ON photos USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_faces_embedding_vector ON faces USING hnsw (embedding_vector vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_persons_embedding_centroid_vector ON persons USING hnsw (embedding_centroid_vector vector_cosine_ops);

-- Folders added from the desktop app (shown in the sidebar, scoped photo views)
CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    host_path TEXT NOT NULL,
    container_path TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_scanned_at TIMESTAMPTZ
);
