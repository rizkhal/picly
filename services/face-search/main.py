#!/usr/bin/env python3
"""Picly — production-grade face search API with thumbnail cache.

Entry point: runs startup migrations, loads the face model, assembles the
FastAPI app, and registers the routers (split across app/ modules).
"""
from datetime import datetime

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from app import db, ml
from app.log import log
from app.routers import folders, persons, photos, scan, search, system

# --- Startup: schema migrations, thumbnail cleanup, face model ---
db.ensure_schemas()
db.cleanup_zero_byte_thumbs()
ml.load_model()

app = FastAPI(
    title="Picly",
    version="1.0.0",
    description="Production-grade face search API",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


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


# --- Routers ---
app.include_router(scan.router)
app.include_router(search.router)
app.include_router(persons.router)
app.include_router(photos.router)
app.include_router(folders.router)
app.include_router(system.router)

if __name__ == "__main__":
    import uvicorn
    log.info("Starting Picly API server")
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info",
        access_log=True,
    )
