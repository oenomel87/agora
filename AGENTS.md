# AGENTS.md

이 문서는 AI 도구가 프로젝트를 빠르게 이해할 수 있도록 작성되었습니다.

## 📋 프로젝트 개요

**Agora**는 여러 AI 모델(Anthropic Claude, OpenAI GPT, Google Gemini)이 함께 토론하는 멀티-AI 대화 시스템입니다. 사용자가 질문을 입력하면 세 AI가 순차적으로 응답하며, 각 AI는 이전 AI들의 대화 맥락을 참조하여 응답합니다. 대화는 MySQL DB에 저장되며, 첫 대화 턴 후 gemini가 자동으로 쓰레드 제목을 생성합니다.

## 🏗️ 프로젝트 구조

```
agora/
├── agora-engine/          # Python 백엔드 (FastAPI)
│   ├── app/
│   │   ├── main.py        # FastAPI 앱 및 엔드포인트
│   │   ├── database.py    # MySQL 비동기 연결 관리
│   │   ├── agents/        # AI 에이전트 정의 (미사용)
│   │   ├── models/        # Pydantic 데이터 모델
│   │   │   ├── chat.py    # 채팅 관련 모델
│   │   │   └── thread.py  # 쓰레드 관련 모델
│   │   └── repositories/
│   │       └── thread_repository.py  # DB CRUD 작업
│   ├── schema.sql         # DB 스키마 (수동 실행)
│   ├── pyproject.toml     # Python 의존성 (uv 사용)
│   └── .env               # API 키 및 DB 설정
│
├── agora-client/          # React 프론트엔드 (Vite + TypeScript)
│   ├── src/
│   │   ├── App.tsx        # 앱 루트 컴포넌트
│   │   ├── Chat.tsx       # 메인 채팅 UI (쓰레드 관리 포함)
│   │   ├── api.ts         # 백엔드 API 통신 로직
│   │   ├── types.ts       # TypeScript 타입 정의
│   │   ├── Chat.css       # 채팅 UI 스타일
│   │   └── index.css      # 글로벌 스타일
│   ├── package.json       # Node.js 의존성
│   └── vite.config.ts     # Vite 설정
│
└── AGENTS.md              # 이 파일
```

## 🔧 기술 스택

### Backend (`agora-engine`)
- **Python 3.13+**
- **FastAPI** - REST API 프레임워크
- **pydantic-ai** - AI 모델 통합 라이브러리
- **aiomysql** - MySQL 비동기 드라이버
- **python-dotenv** - 환경 변수 관리
- **uv** - Python 패키지 관리자

### Frontend (`agora-client`)
- **React 19** + **TypeScript**
- **Vite 7** - 빌드 도구
- **Vanilla CSS** - 스타일링

### Database
- **MySQL** - 쓰레드 및 메시지 저장

## 📡 API 엔드포인트

### Chat API

#### `POST /chat`
AI에게 메시지를 보내고 응답을 받습니다. `thread_id`가 있으면 DB에 저장.

**Request Body:**
```json
{
  "messages": [...],
  "model": "anthropic" | "gpt" | "gemini",
  "thread_id": "uuid (optional)"
}
```

### Thread API

| Method | Endpoint | 설명 |
|--------|----------|------|
| `POST` | `/threads` | 새 쓰레드 생성 |
| `GET` | `/threads` | 쓰레드 목록 조회 |
| `GET` | `/threads/{id}` | 쓰레드 상세 (메시지 포함) |
| `DELETE` | `/threads/{id}` | 쓰레드 삭제 |
| `POST` | `/threads/{id}/generate-title` | gemini로 제목 생성 |

### `GET /`
헬스체크 엔드포인트. `{"ping": "pong"}` 반환.

## 🤖 AI 모델 설정

`main.py`에서 세 AI 에이전트가 정의되어 있습니다:

| 모델 | 식별자 | 모델명 | 설정 |
|------|--------|--------|------|
| Anthropic | `anthropic` | `claude-haiku-4-5-20251001` | thinking 활성화 (1024 토큰) |
| OpenAI | `gpt` | `gpt-5-mini` | reasoning effort: medium |
| Google | `gemini` | `gemini-3-flash-preview` | thinking level: MEDIUM |

## 💬 대화 흐름

1. 사용자가 메시지를 입력
2. 쓰레드가 없으면 새로 생성
3. 프론트엔드가 세 AI 중 랜덤하게 첫 번째 AI 선택
4. 선택된 AI가 응답 (이전 대화 맥락 포함), DB에 저장
5. AI 응답에 `@모델명` 멘션이 있으면 해당 모델이 다음에 응답
6. 멘션이 없으면 남은 모델 중 랜덤 선택
7. 모든 AI가 응답할 때까지 반복
8. **첫 턴 완료 후**: gemini_agent가 대화 기반 제목 자동 생성

## 🗃️ 데이터베이스 스키마

### `threads` 테이블
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | VARCHAR(36) | UUID 기본키 |
| title | VARCHAR(255) | 쓰레드 제목 |
| created_at | DATETIME | 생성 시간 |
| updated_at | DATETIME | 마지막 업데이트 |

### `messages` 테이블
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | VARCHAR(36) | UUID 기본키 |
| thread_id | VARCHAR(36) | 쓰레드 FK |
| role | ENUM('user','assistant') | 역할 |
| model | ENUM('anthropic','gpt','gemini') | AI 모델 (user는 NULL) |
| content | TEXT | 메시지 내용 |
| created_at | DATETIME | 생성 시간 |

## 📝 주요 데이터 타입

### Python (`app/models/chat.py`)
```python
ModelType = Literal["anthropic", "gpt", "gemini"]
RoleType = Literal["user", "assistant"]  # system 제외

class Message(BaseModel):
    role: RoleType
    content: str
    model: ModelType

class ChatRequest(BaseModel):
    messages: list[Message]
    model: ModelType
    thread_id: str | None = None  # DB 저장용
```

### TypeScript (`src/types.ts`)
```typescript
type ModelType = "anthropic" | "gpt" | "gemini";
type RoleType = "user" | "assistant";

interface Thread {
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
}

interface ThreadDetail extends Thread {
    messages: Message[];
}
```

## 🚀 실행 방법

### 1. DB 스키마 생성
```bash
mysql -u username -p agora < agora-engine/schema.sql
```

### 2. Backend
```bash
cd agora-engine
uv sync                    # 의존성 설치
uv run python -m app.main  # 서버 실행 (포트 8000)
```

### 3. Frontend
```bash
cd agora-client
npm install                # 의존성 설치
npm run dev                # 개발 서버 실행 (포트 5173)
```

## ⚙️ 환경 변수

`agora-engine/.env` 파일에 다음 설정이 필요합니다:
```
GOOGLE_API_KEY=your_key
ANTHROPIC_API_KEY=your_key
OPENAI_API_KEY=your_key

MYSQL_HOST=hostname
MYSQL_USER=username
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=agora
```

## 🔗 CORS 설정

백엔드는 다음 origin에서 오는 요청을 허용합니다:
- `http://localhost:5173`
- `http://127.0.0.1:5173`

## 📌 주의사항

- `agora-engine/app/agents/` 디렉토리의 개별 에이전트 파일들은 현재 사용되지 않습니다. 모든 에이전트는 `main.py`에서 직접 정의됩니다.
- AI 응답에서 `@anthropic`, `@gpt`, `@gemini` 멘션을 파싱하여 다음 응답 순서를 결정하지만, 현재 시스템 프롬프트에서는 AI에게 멘션하지 말라고 지시하고 있습니다.
- DB 마이그레이션 도구(Alembic 등)는 사용하지 않습니다. 스키마 변경 시 `schema.sql`을 수동 실행하세요.
