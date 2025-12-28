"""
채팅 쓰레드 관련 Pydantic 모델
"""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.models.chat import Message, ModelType


class Thread(BaseModel):
    """쓰레드 기본 정보"""
    id: str = Field(description="쓰레드 UUID")
    title: str = Field(description="쓰레드 제목")
    created_at: datetime = Field(description="생성 시간")
    updated_at: datetime = Field(description="마지막 업데이트 시간")


class ThreadCreate(BaseModel):
    """쓰레드 생성 요청 (빈 요청)"""
    pass


class ThreadDetail(Thread):
    """쓰레드 상세 (메시지 포함)"""
    messages: list[Message] = Field(default_factory=list, description="메시지 목록")


class ThreadList(BaseModel):
    """쓰레드 목록 응답"""
    threads: list[Thread] = Field(default_factory=list, description="쓰레드 목록")


class GenerateTitleRequest(BaseModel):
    """제목 생성 요청"""
    thread_id: str = Field(description="쓰레드 ID")
    messages: list[Message] = Field(description="대화 메시지 목록")
