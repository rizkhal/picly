"""Scan endpoints: start a scan, poll progress, cancel."""
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, Form, HTTPException
from sqlalchemy import text

from app import scan as scan_service
from app.auth import verify_api_key
from app.config import HOST_MOUNTS, IMAGE_EXTS
from app.db import db_connect
from app.log import log
from app.utils import host_path

router = APIRouter()
auth = [Depends(verify_api_key)]


@router.get("/scan/status")
async def list_scan_status():
    """List recent scans (newest first); the desktop app uses this to recover in-flight scans."""
    with scan_service.scan_progress_lock:
        items = [dict(e) for e in scan_service.scan_progress.values()]
    items.sort(key=lambda e: e.get("started_at") or 0, reverse=True)
    return {"scans": items}


@router.get("/scan/status/{scan_id}")
async def get_scan_status(scan_id: str):
    """Live progress for a single scan; polled by the desktop app while scanning."""
    entry = scan_service.scan_snapshot(scan_id)
    if entry is None:
        raise HTTPException(404, "Scan not found")
    return entry


@router.post("/scan/{scan_id}/cancel", dependencies=auth)
async def cancel_scan(scan_id: str):
    """Request cancellation of a queued or running scan (honoured between photos)."""
    entry = scan_service.scan_snapshot(scan_id)
    if entry is None:
        raise HTTPException(404, "Scan not found")
    if entry["status"] in ("done", "error", "cancelled"):
        return entry
    scan_service.update_scan(scan_id, cancel_requested=True)
    log.info(f"Cancel requested for scan {scan_id[:8]}")
    return scan_service.scan_snapshot(scan_id)


@router.post("/scan", dependencies=auth)
async def scan_folder(
    background_tasks: BackgroundTasks,
    folder: str = Form(...)
):
    """Scan folder for images, detect faces, auto-cluster by person.

    Scans always run in the background. The response returns a scan_id that the
    desktop app polls via GET /scan/status/{scan_id} for live progress.
    """
    folder_path = Path(folder)
    if not folder_path.exists():
        raise HTTPException(400, f"Folder not found: {folder}")

    if not folder_path.is_dir():
        raise HTTPException(400, f"Path is not a directory: {folder}")

    # Refuse to scan a host-mount root itself (the entire mounted filesystem)
    resolved = str(folder_path.resolve()).rstrip("/") or "/"
    refused = {t.rstrip("/") or "/" for _, t in HOST_MOUNTS}
    refused.add("/host")  # common parent of all mounts — would rglob everything
    if resolved in refused:
        raise HTTPException(400, "Refusing to scan the entire host mount root")

    # Register the folder in the sidebar (upsert by container path)
    folder_key = str(folder_path)  # Path normalizes trailing slashes
    host = host_path(folder_key)
    with db_connect() as conn:
        conn.execute(text("""
            INSERT INTO folders (id, host_path, container_path, name, last_scanned_at)
            VALUES (:id, :host_path, :container_path, :name, now())
            ON CONFLICT (container_path) DO UPDATE SET
                host_path = EXCLUDED.host_path,
                name = EXCLUDED.name,
                last_scanned_at = now()
        """), {
            "id": str(uuid.uuid4()),
            "host_path": host,
            "container_path": folder_key,
            "name": Path(host).name or host,
        })
        conn.commit()

    files = [f for f in folder_path.rglob("*") if f.suffix.lower() in IMAGE_EXTS]

    scan_id = scan_service.new_scan_entry(folder_key, len(files))
    if not files:
        scan_service.update_scan(scan_id, status="done", processed=0, finished_at=time.time())
    else:
        background_tasks.add_task(scan_service.scan_folder_task, str(folder_path), files, scan_id)
        log.info(f"Scan {scan_id[:8]} queued: {len(files)} files in {folder_path}")

    return scan_service.scan_snapshot(scan_id)
