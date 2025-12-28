import type { ChatResponse, DiscussionPhase, Message, ModelType, Thread, ThreadDetail, ThreadList } from "./types";

const API_BASE_URL = "http://localhost:8000";

// 모델 목록
export const MODELS: ModelType[] = ["anthropic", "gpt", "gemini"];

// ============ Thread API ============

// 새 쓰레드 생성
export async function createThread(): Promise<Thread> {
    const response = await fetch(`${API_BASE_URL}/threads`, {
        method: "POST",
    });

    if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
}

// 쓰레드 목록 조회
export async function getThreads(): Promise<ThreadList> {
    const response = await fetch(`${API_BASE_URL}/threads`);

    if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
}

// 쓰레드 상세 조회
export async function getThread(threadId: string): Promise<ThreadDetail> {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}`);

    if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
}

// 쓰레드 삭제
export async function deleteThread(threadId: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}`, {
        method: "DELETE",
    });

    if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
    }
}

// 쓰레드 제목 생성
export async function generateThreadTitle(threadId: string, messages: Message[]): Promise<Thread> {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/generate-title`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ thread_id: threadId, messages }),
    });

    if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
}

// ============ Chat API ============

// 특정 모델에 채팅 요청 (단일 턴)
export async function sendChatMessage(
    messages: Message[],
    model: ModelType,
    phase: DiscussionPhase = "opinion",
    threadId?: string
): Promise<ChatResponse> {
    const request = { messages, model, phase, thread_id: threadId };

    const response = await fetch(`${API_BASE_URL}/chat`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
    });

    if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
}

// 결과 타입
export interface ModelResult {
    content: string;
    error?: string;
    nextModel?: ModelType | null;
}

// 배열 셔플 (Fisher-Yates)
function shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// 순차적으로 모델 호출 (멘션된 모델이 다음에 응답, 없으면 랜덤 순서)
export async function sendToModelsSequentially(
    initialMessages: Message[],
    onModelResponse: (model: ModelType, result: ModelResult, remainingModels: ModelType[]) => void,
    onStart?: (firstModel: ModelType) => void,
    threadId?: string
): Promise<Message[]> {
    const messages = [...initialMessages];
    let remainingModels = shuffleArray(MODELS);

    // 첫 번째 모델 결정
    let currentModel = remainingModels[0];
    remainingModels = remainingModels.filter(m => m !== currentModel);

    // 첫 모델 로딩 표시
    onStart?.(currentModel);

    while (currentModel) {
        try {
            const response = await sendChatMessage(messages, currentModel, "opinion", threadId);
            const content = response.message.content;
            const nextModel = response.next_model;

            // 다음 모델 결정
            let nextModelToUse: ModelType | undefined;

            if (nextModel && remainingModels.includes(nextModel)) {
                // 멘션된 모델이 아직 응답 안 했으면 그 모델 선택
                nextModelToUse = nextModel;
                remainingModels = remainingModels.filter(m => m !== nextModel);
            } else if (remainingModels.length > 0) {
                // 멘션이 없거나 멘션된 모델이 이미 응답했으면 랜덤 선택
                nextModelToUse = remainingModels[0];
                remainingModels = remainingModels.slice(1);
            }

            // 콜백으로 결과 전달 (다음 모델 정보 포함)
            onModelResponse(currentModel, { content, nextModel: nextModelToUse }, remainingModels);

            // 다음 모델을 위해 이 응답을 맥락에 추가
            messages.push({
                role: "assistant",
                content,
                model: currentModel,
            });

            // 다음 모델로 이동
            currentModel = nextModelToUse as ModelType;
        } catch (error) {
            // 에러 발생 시 다음 모델로
            const nextModelToUse = remainingModels.length > 0 ? remainingModels[0] : undefined;
            if (nextModelToUse) {
                remainingModels = remainingModels.slice(1);
            }

            onModelResponse(currentModel, {
                content: "",
                error: (error as Error).message,
                nextModel: nextModelToUse
            }, remainingModels);

            currentModel = nextModelToUse as ModelType;
        }
    }

    // 전체 대화 내역 반환 (제목 생성용)
    return messages;
}
