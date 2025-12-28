// AI 모델 타입
export type ModelType = "anthropic" | "gpt" | "gemini";

// 메시지 역할 타입
export type RoleType = "user" | "assistant";

// 토론 단계
export type DiscussionPhase = "opinion" | "free_talk";

// 사용자 액션
export type UserAction = "continue" | "intervene" | "exit";

// 개별 메시지
export interface Message {
    role: RoleType;
    content: string;
    model?: ModelType;
}

// 채팅 요청
export interface ChatRequest {
    messages: Message[];
    model: ModelType;
    thread_id?: string;
}

// 채팅 응답
export interface ChatResponse {
    message: Message;
    model: ModelType | null;
    next_model?: ModelType | null;
    usage?: Record<string, unknown>;
}

// UI에서 사용하는 확장된 메시지 타입
export interface ChatMessage extends Message {
    id: string;
    timestamp: Date;
    isLoading?: boolean;
}

// 쓰레드
export interface Thread {
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
}

// 쓰레드 상세 (메시지 포함)
export interface ThreadDetail extends Thread {
    messages: Message[];
}

// 쓰레드 목록 응답
export interface ThreadList {
    threads: Thread[];
}
