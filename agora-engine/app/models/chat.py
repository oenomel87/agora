from typing import Literal

from pydantic import BaseModel, Field

# Type Aliases
ModelType = Literal["anthropic", "gpt", "gemini"]
RoleType = Literal["user", "assistant"]


class Message(BaseModel):
    """LLM 대화의 개별 메시지"""

    role: RoleType = Field(description="메시지 역할 (user, assistant)")
    content: str = Field(description="메시지 내용")
    model: ModelType | None = Field(
        description="현재 메시지를 작성한 모델 이름 (user인 경우 None)", default=None
    )

class ChatRequest(BaseModel):
    """LLM 대화 요청 모델"""
    messages: list[Message] = Field(description="대화 메시지 목록", min_length=1)
    model: ModelType = Field(description="현재 메시지를 작성한 모델 이름 (anthropic, gpt, gemini)", default="gemini")

class ChatResponse(BaseModel):
    """LLM 대화 응답 모델"""

    message: Message = Field(description="응답 메시지")
    model: ModelType | None = Field(default=None, description="사용된 모델 이름")
    next_model: ModelType | None = Field(default=None, description="다음에 응답할 모델 (멘션된 경우)")
    usage: dict | None = Field(default=None, description="토큰 사용량 정보")

