#!/usr/bin/env python3
"""
Root shim for backend.rd0110_blockmesh_backend.
Allows running:
    uvicorn rd0110_blockmesh_backend:app --reload --port 8000
directly from the workspace root.
"""
from backend.rd0110_blockmesh_backend import *  # noqa: F401, F403
from backend.rd0110_blockmesh_backend import app, main

if __name__ == "__main__":
    main()
