#!/bin/bash
# Local dev only — Docker uses entrypoint.sh instead.
alembic upgrade head
uvicorn main:app --reload --host 0.0.0.0 --port 8141
