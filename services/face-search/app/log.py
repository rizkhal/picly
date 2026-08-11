"""Shared logging configuration for the Picly API."""
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    handlers=[logging.StreamHandler()],
)

log = logging.getLogger("picly")
