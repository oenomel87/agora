"""
MySQL 비동기 데이터베이스 연결 관리
"""
import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import aiomysql
from dotenv import load_dotenv

load_dotenv()

# 전역 연결 풀
_pool: aiomysql.Pool | None = None


async def create_pool() -> aiomysql.Pool:
    """MySQL 연결 풀 생성"""
    global _pool
    if _pool is None:
        _pool = await aiomysql.create_pool(
            host=os.getenv("MYSQL_HOST", "localhost"),
            user=os.getenv("MYSQL_USER", "root"),
            password=os.getenv("MYSQL_PASSWORD", ""),
            db=os.getenv("MYSQL_DATABASE", "agora"),
            charset="utf8mb4",
            autocommit=True,
            minsize=1,
            maxsize=10,
        )
    return _pool


async def close_pool() -> None:
    """연결 풀 종료"""
    global _pool
    if _pool is not None:
        _pool.close()
        await _pool.wait_closed()
        _pool = None


async def get_pool() -> aiomysql.Pool:
    """현재 연결 풀 반환 (없으면 생성)"""
    global _pool
    if _pool is None:
        await create_pool()
    return _pool


@asynccontextmanager
async def get_connection() -> AsyncGenerator[aiomysql.Connection, None]:
    """연결 컨텍스트 매니저"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        yield conn


@asynccontextmanager
async def get_cursor() -> AsyncGenerator[aiomysql.DictCursor, None]:
    """커서 컨텍스트 매니저 (DictCursor 사용)"""
    async with get_connection() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cursor:
            yield cursor
