"""Database engine, connection helper, and idempotent schema migrations."""
from pathlib import Path

from sqlalchemy import create_engine, event, text
from sqlalchemy.pool import QueuePool

from app.config import DB_URL, THUMB_DIR
from app.log import log

engine = create_engine(
    DB_URL,
    poolclass=QueuePool,
    pool_size=5,
    max_overflow=10,
    pool_pre_ping=True,
    pool_recycle=3600,
    echo=False,
)


@event.listens_for(engine, "connect")
def set_postgres_timezone(dbapi_conn, connection_record):
    with dbapi_conn.cursor() as cur:
        cur.execute("SET timezone = 'UTC'")


def db_connect():
    return engine.connect()


def ensure_pgvector_schema() -> None:
    """Ensure the vector extension, embedding_vector columns, and HNSW indexes exist."""
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        # faces: searchable per-face embeddings
        conn.execute(text("ALTER TABLE faces ADD COLUMN IF NOT EXISTS embedding_vector VECTOR(512)"))
        conn.execute(text(
            "UPDATE faces SET embedding_vector = embedding::vector "
            "WHERE embedding_vector IS NULL AND array_length(embedding, 1) = 512"
        ))
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_faces_embedding_vector "
            "ON faces USING hnsw (embedding_vector vector_cosine_ops)"
        ))
        # persons: cluster centroids matched at scan time
        conn.execute(text("ALTER TABLE persons ADD COLUMN IF NOT EXISTS embedding_centroid_vector VECTOR(512)"))
        conn.execute(text(
            "UPDATE persons SET embedding_centroid_vector = embedding_centroid::vector "
            "WHERE embedding_centroid_vector IS NULL AND array_length(embedding_centroid, 1) = 512"
        ))
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_persons_embedding_centroid_vector "
            "ON persons USING hnsw (embedding_centroid_vector vector_cosine_ops)"
        ))
    log.info("pgvector schema ready (vector extension + HNSW indexes on faces.embedding_vector / persons.embedding_centroid_vector)")


def ensure_folders_schema() -> None:
    """Ensure the folders table exists (folders added via the desktop app)."""
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS folders (
                id TEXT PRIMARY KEY,
                host_path TEXT NOT NULL,
                container_path TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                last_scanned_at TIMESTAMPTZ
            )
        """))
    log.info("folders schema ready")


def ensure_schemas() -> None:
    """Run all idempotent schema migrations; raise on failure (fatal at startup)."""
    try:
        ensure_pgvector_schema()
    except Exception as e:
        log.error(
            "pgvector migration failed — is the Postgres image pgvector-enabled? "
            f"(use pgvector/pgvector:pg16 instead of postgres:16-alpine): {e}"
        )
        raise
    try:
        ensure_folders_schema()
    except Exception as e:
        log.error(f"folders schema migration failed: {e}")
        raise


def cleanup_zero_byte_thumbs() -> int:
    """Delete empty thumbnail files from the thumbs volume; returns count removed.

    Also reconciles the DB: any photo whose thumb file is missing or empty gets
    its thumb_path NULLed, so /stats and the photo grid stay consistent no matter
    which boot deleted the file. (/face/{id} falls back to the original photo
    when the thumb file is absent, so this heals broken avatars.)
    """
    removed = 0
    for p in THUMB_DIR.glob("*.jpg"):
        try:
            if p.stat().st_size == 0:
                p.unlink()
                removed += 1
        except OSError as e:
            log.warning(f"Cleanup: could not inspect/remove {p}: {e}")
    # Reconcile DB rows against the filesystem (covers files deleted on earlier boots).
    nulled = 0
    with engine.begin() as conn:
        rows = conn.execute(
            text("SELECT id, thumb_path FROM photos WHERE thumb_path IS NOT NULL")
        ).fetchall()
        for pid, tp in rows:
            try:
                missing = not Path(tp).exists() or Path(tp).stat().st_size == 0
            except OSError:
                missing = True
            if missing:
                conn.execute(text("UPDATE photos SET thumb_path = NULL WHERE id = :id"), {"id": pid})
                nulled += 1
    if removed or nulled:
        log.info(f"Cleanup: removed {removed} zero-byte thumbs, nulled {nulled} stale thumb_path rows")
    return removed
