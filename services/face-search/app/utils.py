"""Path mapping and host mount enumeration."""
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.config import HOST_MOUNTS, THUMB_DIR, UPLOAD_DIR
from app.log import log


def host_path(container_path: Optional[str]) -> Optional[str]:
    """Map a path under any host mount back to the real host path for display."""
    if not container_path:
        return container_path
    # Longest target prefix wins (e.g. /host/Volumes/X vs /host/Users/me)
    best = None
    for source, target in HOST_MOUNTS:
        prefix = target.rstrip("/") + "/"
        if container_path.startswith(prefix):
            if best is None or len(target) > len(best[1]):
                best = (source, target)
    if best:
        source, target = best
        return source.rstrip("/") + "/" + container_path[len(target.rstrip("/")) + 1:]
    return container_path


def enumerate_mounts() -> List[Dict[str, Any]]:
    """Enumerate real mounted filesystems with free space. No hardcoded host paths."""
    # Collect (device, mountpoint) pairs — Linux via /proc/mounts, macOS/other via df
    mounts: List[tuple[str, str]] = []
    try:
        if os.path.exists("/proc/mounts"):
            with open("/proc/mounts", "r", encoding="utf-8") as f:
                for line in f:
                    parts = line.split()
                    if len(parts) >= 2:
                        # /proc/mounts escapes spaces as \\040
                        device = parts[0].replace("\\\\040", " ")
                        mount = parts[1].replace("\\\\040", " ")
                        mounts.append((device, mount))
        else:
            out = subprocess.run(["df", "-kP"], capture_output=True, text=True, timeout=5).stdout
            for line in out.splitlines()[1:]:
                parts = line.split()
                if len(parts) >= 6:
                    # Mount points may contain spaces — take everything after the 5th field
                    mounts.append((parts[0], " ".join(parts[5:])))
    except Exception as e:
        log.error(f"Failed to enumerate mounts: {e}")

    # Skip synthetic/pseudo filesystems that are not real user disks
    skip_devices = {"none", "overlay", "tmpfs", "devtmpfs", "proc", "sysfs",
                    "cgroup", "cgroup2", "devpts", "shm", "mqueue", "hugetlbfs",
                    "nsfs", "rpc_pipefs"}
    # /System/Volumes/* are synthetic macOS containers; /etc/* are Docker's file mounts;
    # /Library/Developer/* are simulator/iOS disk images on dev machines; /private/var is
    # the APFS data volume on macOS (matches the desktop app's df filter). The app's own
    # storage dirs and the host mount are internal, not user drives.
    skip_prefixes = ("/proc", "/sys", "/dev", "/run", "/var/run", "/boot", "/etc",
                     "/System/Volumes", "/Library/Developer", "/private/var",
                     str(UPLOAD_DIR), str(THUMB_DIR), "/root/.insightface")
    # Skip every host-mount target so the API doesn't list its own /host views
    skip_prefixes += tuple(t.rstrip("/") + "/" for _, t in HOST_MOUNTS) + tuple(t for _, t in HOST_MOUNTS)

    roots: List[Dict[str, Any]] = []
    seen: set = set()
    for device, mount in mounts:
        if not mount.startswith("/"):
            continue
        if mount.startswith(skip_prefixes):
            continue
        key = mount.rstrip("/") or "/"
        if key in seen:
            continue
        # Always keep the root; skip pseudo-devices for everything else (the
        # container root sits on "overlay", which is a real backing disk here)
        if key != "/" and device in skip_devices:
            continue
        seen.add(key)
        name = "Root" if key == "/" else Path(key).name or key
        try:
            usage = shutil.disk_usage(key)
            roots.append({"name": name, "path": key,
                          "free_gb": round(usage.free / 1024 / 1024 / 1024, 1),
                          "total_gb": round(usage.total / 1024 / 1024 / 1024, 1)})
        except Exception:
            roots.append({"name": name, "path": key, "free_gb": None, "total_gb": None})
    return roots
