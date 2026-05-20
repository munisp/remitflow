
"""
Gamification and rewards service
"""

from fastapi import FastAPI, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime
import asyncpg
import uvicorn
import os

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://remittance:remittance@localhost:5432/remittance")

app = FastAPI(title="Gamification Service", version="1.0.0")

# Database connection
async def get_db_pool():
    pool = await asyncpg.create_pool(dsn=DATABASE_URL)
    try:
        yield pool
    finally:
        await pool.close()

# Pydantic models
class Achievement(BaseModel):
    id: int
    name: str
    description: str
    points: int

class UserAchievement(BaseModel):
    id: int
    user_id: str
    achievement_id: int
    unlocked_at: datetime

# API endpoints
@app.post("/users/{user_id}/achievements/{achievement_id}", response_model=UserAchievement)
async def unlock_achievement(user_id: str, achievement_id: int, pool: asyncpg.Pool = Depends(get_db_pool)):
    async with pool.acquire() as connection:
        # Check if achievement exists
        achievement = await connection.fetchrow("SELECT * FROM achievements WHERE id = $1", achievement_id)
        if not achievement:
            raise HTTPException(status_code=404, detail="Achievement not found")
        
        # Unlock achievement for user
        unlocked_at = datetime.utcnow()
        user_achievement = await connection.fetchrow(
            "INSERT INTO user_achievements (user_id, achievement_id, unlocked_at) VALUES ($1, $2, $3) RETURNING *",
            user_id, achievement_id, unlocked_at
        )
        return user_achievement

@app.get("/users/{user_id}/achievements", response_model=List[Achievement])
async def get_user_achievements(user_id: str, pool: asyncpg.Pool = Depends(get_db_pool)):
    async with pool.acquire() as connection:
        achievements = await connection.fetch(
            """
            SELECT a.* FROM achievements a
            JOIN user_achievements ua ON a.id = ua.achievement_id
            WHERE ua.user_id = $1
            """,
            user_id
        )
        return achievements

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8083)
