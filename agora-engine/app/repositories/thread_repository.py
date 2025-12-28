"""
쓰레드 Repository - DB CRUD 작업
"""
import uuid
from datetime import datetime

from app.database import get_cursor
from app.models.chat import Message
from app.models.thread import Thread, ThreadDetail


async def create_thread(title: str = "새 토론") -> Thread:
    """새 쓰레드 생성"""
    thread_id = str(uuid.uuid4())
    now = datetime.now()
    
    async with get_cursor() as cursor:
        await cursor.execute(
            "INSERT INTO threads (id, title, created_at, updated_at) VALUES (%s, %s, %s, %s)",
            (thread_id, title, now, now)
        )
    
    return Thread(id=thread_id, title=title, created_at=now, updated_at=now)


async def get_threads() -> list[Thread]:
    """전체 쓰레드 목록 조회 (최신순)"""
    async with get_cursor() as cursor:
        await cursor.execute(
            "SELECT id, title, created_at, updated_at FROM threads ORDER BY updated_at DESC"
        )
        rows = await cursor.fetchall()
    
    return [Thread(**row) for row in rows]


async def get_thread_by_id(thread_id: str) -> ThreadDetail | None:
    """쓰레드 상세 조회 (메시지 포함)"""
    async with get_cursor() as cursor:
        # 쓰레드 정보
        await cursor.execute(
            "SELECT id, title, created_at, updated_at FROM threads WHERE id = %s",
            (thread_id,)
        )
        thread_row = await cursor.fetchone()
        
        if not thread_row:
            return None
        
        # 메시지 목록
        await cursor.execute(
            "SELECT role, content, model FROM messages WHERE thread_id = %s ORDER BY created_at ASC",
            (thread_id,)
        )
        message_rows = await cursor.fetchall()
    
    messages = [Message(**row) for row in message_rows]
    return ThreadDetail(**thread_row, messages=messages)


async def delete_thread(thread_id: str) -> bool:
    """쓰레드 삭제"""
    async with get_cursor() as cursor:
        await cursor.execute("DELETE FROM threads WHERE id = %s", (thread_id,))
        return cursor.rowcount > 0


async def add_message(
    thread_id: str,
    role: str,
    content: str,
    model: str | None = None
) -> str:
    """메시지 추가"""
    message_id = str(uuid.uuid4())
    
    async with get_cursor() as cursor:
        await cursor.execute(
            "INSERT INTO messages (id, thread_id, role, content, model) VALUES (%s, %s, %s, %s, %s)",
            (message_id, thread_id, role, content, model)
        )
        # 쓰레드 updated_at 갱신
        await cursor.execute(
            "UPDATE threads SET updated_at = NOW() WHERE id = %s",
            (thread_id,)
        )
    
    return message_id


async def update_thread_title(thread_id: str, title: str) -> bool:
    """쓰레드 제목 업데이트"""
    async with get_cursor() as cursor:
        await cursor.execute(
            "UPDATE threads SET title = %s, updated_at = NOW() WHERE id = %s",
            (title, thread_id)
        )
        return cursor.rowcount > 0
