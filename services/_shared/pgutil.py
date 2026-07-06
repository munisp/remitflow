"""
Shared PostgreSQL utility for all Python micro-services.

Usage:
    from _shared.pgutil import PgStore
    store = PgStore("my_service")
    store.ensure_table("my_data", {"id": "TEXT PRIMARY KEY", "payload": "JSONB"})
    store.upsert("my_data", {"id": "abc", "payload": '{"x": 1}'})
    row = store.get("my_data", "id", "abc")
    rows = store.query("my_data", where="id = %s", params=("abc",))
"""

import json
import os
from typing import Any

import psycopg2
import psycopg2.pool
import psycopg2.extras

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://localhost:5432/remitflow")

_pool: psycopg2.pool.ThreadedConnectionPool | None = None


def get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    global _pool
    if _pool is None or _pool.closed:
        _pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=2, maxconn=10, dsn=DATABASE_URL,
        )
    return _pool


def execute(query: str, params: tuple = ()) -> list[dict]:
    pool = get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(query, params)
            rows = [dict(r) for r in cur.fetchall()] if cur.description else []
            conn.commit()
            return rows
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)


def execute_one(query: str, params: tuple = ()) -> dict | None:
    rows = execute(query, params)
    return rows[0] if rows else None


def ensure_table(ddl: str) -> None:
    pool = get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(ddl)
            conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"[pgutil] DDL error: {e}")
    finally:
        pool.putconn(conn)


class PgStore:
    """Convenience wrapper: table-per-store with JSONB payload column."""

    def __init__(self, table: str, key_col: str = "id", key_type: str = "TEXT"):
        self.table = table
        self.key_col = key_col
        ensure_table(
            f"""CREATE TABLE IF NOT EXISTS {table} (
                {key_col} {key_type} PRIMARY KEY,
                data JSONB NOT NULL DEFAULT '{{}}'::jsonb,
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )"""
        )

    def get(self, key: str) -> dict | None:
        row = execute_one(
            f"SELECT data FROM {self.table} WHERE {self.key_col} = %s", (key,)
        )
        return dict(row["data"]) if row else None

    def put(self, key: str, data: dict) -> None:
        execute(
            f"""INSERT INTO {self.table} ({self.key_col}, data, updated_at)
                VALUES (%s, %s, NOW())
                ON CONFLICT ({self.key_col}) DO UPDATE
                SET data = EXCLUDED.data, updated_at = NOW()""",
            (key, json.dumps(data, default=str)),
        )

    def delete(self, key: str) -> None:
        execute(f"DELETE FROM {self.table} WHERE {self.key_col} = %s", (key,))

    def list_all(self, limit: int = 1000) -> list[dict]:
        rows = execute(
            f"SELECT {self.key_col}, data FROM {self.table} ORDER BY updated_at DESC LIMIT %s",
            (limit,),
        )
        return [{"key": r[self.key_col], **dict(r["data"])} for r in rows]

    def count(self) -> int:
        row = execute_one(f"SELECT COUNT(*) AS cnt FROM {self.table}")
        return row["cnt"] if row else 0

    def append(self, key: str, data: dict) -> None:
        """Append to a JSONB array stored under the key."""
        execute(
            f"""INSERT INTO {self.table} ({self.key_col}, data, updated_at)
                VALUES (%s, %s, NOW())
                ON CONFLICT ({self.key_col}) DO UPDATE
                SET data = {self.table}.data || %s::jsonb, updated_at = NOW()""",
            (key, json.dumps([data], default=str), json.dumps([data], default=str)),
        )

    def get_list(self, key: str) -> list[dict]:
        row = execute_one(
            f"SELECT data FROM {self.table} WHERE {self.key_col} = %s", (key,)
        )
        if not row:
            return []
        val = row["data"]
        return val if isinstance(val, list) else [val]
