import os

from . import backend as backend

if os.environ.get("COMFYTV_TESTING") == "1":
    PHOTOSHOP_NODES = []
else:
    from .nodes import PHOTOSHOP_NODES

__all__ = ["PHOTOSHOP_NODES", "backend"]
