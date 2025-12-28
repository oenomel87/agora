import re
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIResponsesModelSettings
from pydantic_ai.models.anthropic import AnthropicModelSettings
from pydantic_ai.models.google import GoogleModelSettings

from dotenv import load_dotenv

from app.models.chat import ChatRequest, ChatResponse, Message, ModelType, DiscussionPhase
from app.models.thread import Thread, ThreadDetail, ThreadList, GenerateTitleRequest
from app.database import create_pool, close_pool
from app.repositories import thread_repository

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """애플리케이션 라이프사이클 관리"""
    # 시작 시 DB 연결 풀 생성
    await create_pool()
    yield
    # 종료 시 연결 풀 닫기
    await close_pool()


app = FastAPI(lifespan=lifespan)

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

anthropic_agent = Agent(
    model='anthropic:claude-haiku-4-5-20251001',
    model_settings=AnthropicModelSettings(
        anthropic_thinking={'type': 'enabled', 'budget_tokens': 1024}
    )
)
gpt_agent = Agent(
    model='openai:gpt-5-mini',
    model_settings=OpenAIResponsesModelSettings(
        openai_reasoning_effort='medium'
    )
)
gemini_agent = Agent(
    model='google-gla:gemini-3-flash-preview',
    model_settings=GoogleModelSettings(
        google_thinking_config={ 'thinking_level': 'MEDIUM' }
    )
)

# 멘션 패턴 (대소문자 무시)
MENTION_PATTERN = re.compile(r'@(anthropic|gpt|gemini)', re.IGNORECASE)


def parse_mention(text: str, current_model: ModelType) -> ModelType | None:
    """응답에서 멘션된 모델을 추출합니다. 자기 자신 멘션은 무시합니다."""
    matches = MENTION_PATTERN.findall(text)
    for match in matches:
        mentioned = match.lower()
        if mentioned != current_model:
            return mentioned
    return None


def combine_messages(request: ChatRequest) -> str:
    """Phase에 따라 다른 시스템 프롬프트를 생성합니다."""
    model_name = request.model
    all_models = ["anthropic", "gpt", "gemini"]
    other_models = ", ".join([m for m in all_models if m != model_name])

    messages = ""
    for message in request.messages:
        if message.role == "user":
            messages += f"User: {message.content}\n"
        elif message.role == "assistant":
            messages += f"{message.model}: {message.content}\n"

    if request.phase == DiscussionPhase.OPINION:
        # Phase 1: 의견 수집 - 다른 AI 언급 금지
        instructions = f"""당신은 {model_name}입니다.
지금 {other_models}와 함께 토론에 참여하고 있습니다.

다음을 기억하세요:
- 솔직하게 자신의 의견만 제시하세요
- 다른 AI를 언급하거나 질문하지 마세요
- 3-4문단 이내로 작성하세요"""
    else:
        # Phase 2: 자유 토론 - 멘션으로 지목 가능
        instructions = f"""당신은 {model_name}입니다.
지금 {other_models}와 함께 토론하고 있습니다.

다음을 기억하세요:
- 이전 발언에 대해 반응하세요 (동의, 반박, 보충)
- 다른 AI를 참조할 때는 이름만 사용하세요 (예: "Anthropic이 말했듯이", "GPT의 의견처럼")
- 질문할 때만 응답 끝에 @를 사용하세요 (예: "@gpt, 이에 대해 어떻게 생각하나요?")
- 여러 AI를 동시에 지목하지 마세요
- 3-4문단 이내로 작성하세요"""

    return f"""{instructions}

<지금까지의 대화>
{messages}
"""


# ============ Health Check ============

@app.get("/")
def ping():
    return {"ping": "pong"}


# ============ Thread Endpoints ============

@app.post("/threads", response_model=Thread)
async def create_thread():
    """새 쓰레드 생성"""
    return await thread_repository.create_thread()


@app.get("/threads", response_model=ThreadList)
async def get_threads():
    """쓰레드 목록 조회"""
    threads = await thread_repository.get_threads()
    return ThreadList(threads=threads)


@app.get("/threads/{thread_id}", response_model=ThreadDetail)
async def get_thread(thread_id: str):
    """쓰레드 상세 조회"""
    thread = await thread_repository.get_thread_by_id(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    return thread


@app.delete("/threads/{thread_id}")
async def delete_thread(thread_id: str):
    """쓰레드 삭제"""
    deleted = await thread_repository.delete_thread(thread_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Thread not found")
    return {"deleted": True}


# ============ Title Generation ============

@app.post("/threads/{thread_id}/generate-title", response_model=Thread)
async def generate_title(thread_id: str, request: GenerateTitleRequest):
    """gemini_agent를 사용해 쓰레드 제목 생성"""
    # 대화 내용으로 프롬프트 구성
    conversation = ""
    for msg in request.messages:
        if msg.role == "user":
            conversation += f"User: {msg.content}\n"
        else:
            conversation += f"{msg.model}: {msg.content}\n"
    
    prompt = f"""다음 대화의 제목을 한국어로 짧게 만들어주세요 (10자 이내).
제목만 출력하고 다른 설명은 하지 마세요.

<대화>
{conversation}
"""
    
    response = await gemini_agent.run(prompt)
    title = response.output.strip().strip('"\'')[:50]  # 최대 50자
    
    # 제목 업데이트
    await thread_repository.update_thread_title(thread_id, title)
    
    # 업데이트된 쓰레드 반환
    thread = await thread_repository.get_thread_by_id(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    
    return Thread(
        id=thread.id,
        title=thread.title,
        created_at=thread.created_at,
        updated_at=thread.updated_at
    )


# ============ Chat Endpoint ============

class ChatRequestWithThread(ChatRequest):
    """쓰레드 ID를 포함한 채팅 요청"""
    thread_id: str | None = Field(default=None, description="쓰레드 ID (지정 시 메시지 저장)")


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequestWithThread):
    """LLM 대화 엔드포인트

    Args:
        request: 대화 요청 (messages, model, thread_id)

    Returns:
        ChatResponse: LLM 응답 메시지
    """
    # thread_id가 있으면 사용자 메시지 저장 (마지막 메시지만)
    if request.thread_id and request.messages:
        last_msg = request.messages[-1]
        if last_msg.role == "user":
            await thread_repository.add_message(
                thread_id=request.thread_id,
                role="user",
                content=last_msg.content,
                model=None
            )

    instruction = combine_messages(request)

    if request.model == "anthropic":
        response = await anthropic_agent.run(instruction)
    elif request.model == "gpt":
        response = await gpt_agent.run(instruction)
    elif request.model == "gemini":
        response = await gemini_agent.run(instruction)

    # 응답에서 멘션된 다음 모델 파싱
    response_text = response.output
    next_model = parse_mention(response_text, request.model)

    # thread_id가 있으면 AI 응답 저장
    if request.thread_id:
        await thread_repository.add_message(
            thread_id=request.thread_id,
            role="assistant",
            content=response_text,
            model=request.model
        )

    return ChatResponse(
        message=Message(role="assistant", content=response_text),
        model=request.model,
        next_model=next_model
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
