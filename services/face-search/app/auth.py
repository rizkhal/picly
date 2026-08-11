"""API key authentication dependency."""
from fastapi import HTTPException, Request

from app.config import API_KEY


async def verify_api_key(request: Request):
    if not API_KEY:
        return
    # Allow requests from localhost / private networks for desktop app / local dev
    client_host = request.client.host if request.client else ""
    if client_host in ("127.0.0.1", "localhost", "::1"):
        return
    if client_host.startswith("172.") or client_host.startswith("192.168.") or client_host.startswith("10."):
        return
    key = request.headers.get("X-API-Key")
    if key != API_KEY:
        raise HTTPException(status_code=403, detail="Invalid API key")
