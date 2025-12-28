from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field

# Type Aliases
ModelType = Literal["anthropic", "gpt", "gemini"]
RoleType = Literal["user", "assistant"]


class DiscussionPhase(str, Enum):
    """토론 단계"""
    OPINION = "opinion"      # Phase 1: 의견 수집
    FREE_TALK = "free_talk"  # Phase 2: 자유 토론


class Message(BaseModel):
    """LLM 대화의 개별 메시지"""

    role: RoleType = Field(description="메시지 역할 (user, assistant)")
    content: str = Field(description="메시지 내용")
    model: ModelType | None = Field(
        description="현재 메시지를 작성한 모델 이름 (user인 경우 None)", default=None
    )


class DiscussionState(BaseModel):
    """토론 상태"""
    phase: DiscussionPhase = Field(default=DiscussionPhase.OPINION, description="현재 토론 단계")
    turn_count: dict[str, int] = Field(
        default_factory=lambda: {"anthropic": 0, "gpt": 0, "gemini": 0},
        description="각 AI의 발언 횟수"
    )
    spoken_in_phase1: list[str] = Field(
        default_factory=list,
        description="Phase 1에서 발언한 AI 목록"
    )


class ChatRequest(BaseModel):
    """LLM 대화 요청 모델"""
    messages: list[Message] = Field(description="대화 메시지 목록", min_length=1)
    model: ModelType = Field(description="현재 메시지를 작성한 모델 이름 (anthropic, gpt, gemini)", default="gemini")
    phase: DiscussionPhase = Field(default=DiscussionPhase.OPINION, description="현재 토론 단계")

class ChatResponse(BaseModel):
    """LLM 대화 응답 모델"""

    message: Message = Field(description="응답 메시지")
    model: ModelType | None = Field(default=None, description="사용된 모델 이름")
    next_model: ModelType | None = Field(default=None, description="다음에 응답할 모델 (멘션된 경우)")
    usage: dict | None = Field(default=None, description="토큰 사용량 정보")

