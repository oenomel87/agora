import { useState, useRef, useEffect, type FormEvent, type KeyboardEvent } from "react";
import type { Message, ModelType, Thread, DiscussionPhase } from "./types";
import { sendChatMessage, MODELS, createThread, getThreads, getThread, deleteThread, generateThreadTitle } from "./api";
import "./Chat.css";

// 채팅 메시지 타입
interface ChatMessage {
    id: string;
    type: "user" | "ai";
    content: string;
    model?: ModelType;
    isLoading?: boolean;
    error?: string;
}

// 모델 아이콘 텍스트
const MODEL_ICONS: Record<ModelType, string> = {
    anthropic: "A",
    gpt: "G",
    gemini: "✦",
};

// 모델 표시 이름
const MODEL_NAMES: Record<ModelType, string> = {
    anthropic: "Anthropic",
    gpt: "GPT",
    gemini: "Gemini",
};

export default function Chat() {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [threads, setThreads] = useState<Thread[]>([]);
    const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
    const [currentThreadTitle, setCurrentThreadTitle] = useState<string>("새 토론");
    const [isFirstTurn, setIsFirstTurn] = useState(true);
    const [phase, setPhase] = useState<DiscussionPhase>("opinion");
    const [waitingForAction, setWaitingForAction] = useState(false);
    const [turnCount, setTurnCount] = useState<Record<ModelType, number>>({ anthropic: 0, gpt: 0, gemini: 0 });
    const [spokenInPhase1, setSpokenInPhase1] = useState<ModelType[]>([]);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // 초기 쓰레드 목록 로드
    useEffect(() => {
        loadThreads();
    }, []);

    // 자동 스크롤
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // textarea 높이 자동 조절
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
            textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
        }
    }, [input]);

    // 쓰레드 목록 로드
    const loadThreads = async () => {
        try {
            const result = await getThreads();
            setThreads(result.threads);
        } catch (error) {
            console.error("Failed to load threads:", error);
        }
    };

    // 새 쓰레드 시작
    const handleNewThread = async () => {
        setMessages([]);
        setCurrentThreadId(null);
        setCurrentThreadTitle("새 토론");
        setIsFirstTurn(true);
        setPhase("opinion");
        setWaitingForAction(false);
        setTurnCount({ anthropic: 0, gpt: 0, gemini: 0 });
        setSpokenInPhase1([]);
    };

    // 쓰레드 선택
    const handleSelectThread = async (threadId: string) => {
        try {
            const threadDetail = await getThread(threadId);
            setCurrentThreadId(threadId);
            setCurrentThreadTitle(threadDetail.title);
            setIsFirstTurn(false);

            // 메시지 변환
            const chatMessages: ChatMessage[] = threadDetail.messages.map((msg, index) => ({
                id: `${msg.role}-${index}-${Date.now()}`,
                type: msg.role === "user" ? "user" : "ai",
                content: msg.content,
                model: msg.model,
            }));
            setMessages(chatMessages);
        } catch (error) {
            console.error("Failed to load thread:", error);
        }
    };

    // 쓰레드 삭제
    const handleDeleteThread = async (threadId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await deleteThread(threadId);
            setThreads(threads.filter(t => t.id !== threadId));
            if (currentThreadId === threadId) {
                handleNewThread();
            }
        } catch (error) {
            console.error("Failed to delete thread:", error);
        }
    };

    // 다음 발언자 결정 (멘션 우선 → 발언 횟수 최소 → 랜덤)
    const decideNextSpeaker = (
        lastResponse: string | null,
        currentTurnCount: Record<ModelType, number>,
        currentPhase: DiscussionPhase,
        spoken: ModelType[]
    ): ModelType => {
        // Phase 1: 아직 발언하지 않은 AI 중 랜덤 선택
        if (currentPhase === "opinion") {
            const notSpoken = MODELS.filter(m => !spoken.includes(m));
            if (notSpoken.length > 0) {
                return notSpoken[Math.floor(Math.random() * notSpoken.length)];
            }
        }

        // Phase 2: 마지막 멘션 파싱 (질문은 보통 응답 끝에 위치)
        if (lastResponse) {
            const mentions = lastResponse.match(/@(anthropic|gpt|gemini)/gi);
            if (mentions && mentions.length > 0) {
                // 마지막 멘션만 사용
                const lastMention = mentions[mentions.length - 1];
                return lastMention.substring(1).toLowerCase() as ModelType;
            }
        }

        // 발언 횟수가 가장 적은 AI 선택
        const minCount = Math.min(...Object.values(currentTurnCount));
        const candidates = MODELS.filter(m => currentTurnCount[m] === minCount);
        return candidates[Math.floor(Math.random() * candidates.length)];
    };

    // 단일 AI 호출
    const callAI = async (
        model: ModelType,
        apiMessages: Message[],
        threadId: string,
        currentPhase: DiscussionPhase
    ) => {
        // 로딩 메시지 추가
        setMessages(prev => [...prev, {
            id: `loading-${model}`,
            type: "ai",
            content: "",
            model,
            isLoading: true,
        }]);

        try {
            const response = await sendChatMessage(apiMessages, model, currentPhase, threadId);
            const content = response.message.content;

            // 로딩 메시지를 실제 응답으로 교체
            setMessages(prev => {
                const withoutLoading = prev.filter(m => m.id !== `loading-${model}`);
                return [...withoutLoading, {
                    id: `ai-${model}-${Date.now()}`,
                    type: "ai" as const,
                    content,
                    model,
                }];
            });

            // 발언 횟수 업데이트
            setTurnCount(prev => ({ ...prev, [model]: prev[model] + 1 }));

            // Phase 1이면 발언한 AI 목록에 추가
            if (currentPhase === "opinion") {
                setSpokenInPhase1(prev => [...prev, model]);
            }

            return content;
        } catch (error) {
            setMessages(prev => {
                const withoutLoading = prev.filter(m => m.id !== `loading-${model}`);
                return [...withoutLoading, {
                    id: `ai-${model}-${Date.now()}`,
                    type: "ai" as const,
                    content: "",
                    model,
                    error: (error as Error).message,
                }];
            });
            return null;
        }
    };

    // 메시지 전송 (사용자 입력 처리)
    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isLoading) return;

        const userMessage = input.trim();
        setInput("");
        setIsLoading(true);

        // 첫 메시지면 쓰레드 생성
        let threadId = currentThreadId;
        if (!threadId) {
            try {
                const newThread = await createThread();
                threadId = newThread.id;
                setCurrentThreadId(threadId);
                setThreads(prev => [newThread, ...prev]);
            } catch (error) {
                console.error("Failed to create thread:", error);
                setIsLoading(false);
                return;
            }
        }

        // 사용자 메시지 추가
        const userChatMessage: ChatMessage = {
            id: `user-${Date.now()}`,
            type: "user",
            content: userMessage,
        };
        setMessages(prev => [...prev, userChatMessage]);

        // 대화 히스토리 구성 (API용)
        const apiMessages: Message[] = [];
        messages.forEach((msg) => {
            if (msg.type === "user") {
                apiMessages.push({ role: "user", content: msg.content });
            } else if (msg.type === "ai" && msg.content && !msg.error) {
                apiMessages.push({ role: "assistant", content: msg.content, model: msg.model });
            }
        });
        apiMessages.push({ role: "user", content: userMessage });

        // 첫 발언자 결정 및 호출
        const firstSpeaker = decideNextSpeaker(null, turnCount, phase, spokenInPhase1);
        const response = await callAI(firstSpeaker, apiMessages, threadId, phase);

        // 첫 턴이면 제목 생성
        if (isFirstTurn && threadId) {
            try {
                const updatedThread = await generateThreadTitle(threadId, [
                    ...apiMessages,
                    { role: "assistant", content: response || "", model: firstSpeaker }
                ]);
                setCurrentThreadTitle(updatedThread.title);
                setThreads(prev => prev.map(t =>
                    t.id === threadId ? { ...t, title: updatedThread.title } : t
                ));
            } catch (error) {
                console.error("Failed to generate title:", error);
            }
            setIsFirstTurn(false);
        }

        setIsLoading(false);
        setWaitingForAction(true); // 사용자 액션 대기 상태로 전환
        loadThreads();
    };

    // 사용자 액션 처리 (계속/개입/종료)
    const handleAction = async (action: "continue" | "intervene" | "exit") => {
        if (action === "exit") {
            // 토론 종료
            setWaitingForAction(false);
            return;
        }

        if (action === "intervene") {
            // 사용자 개입 - 입력창 활성화하고 대기
            setWaitingForAction(false);
            textareaRef.current?.focus();
            return;
        }

        // action === "continue"
        setWaitingForAction(false);
        setIsLoading(true);

        // 현재 대화 히스토리 구성
        const apiMessages: Message[] = [];
        messages.forEach((msg) => {
            if (msg.type === "user") {
                apiMessages.push({ role: "user", content: msg.content });
            } else if (msg.type === "ai" && msg.content && !msg.error) {
                apiMessages.push({ role: "assistant", content: msg.content, model: msg.model });
            }
        });

        // 마지막 AI 응답에서 다음 발언자 결정
        const lastAiMessage = [...messages].reverse().find(m => m.type === "ai" && m.content);
        const lastResponse = lastAiMessage?.content || null;

        // Phase 1에서 3명 모두 발언했으면 Phase 2로 전환
        let currentPhase = phase;
        if (phase === "opinion" && spokenInPhase1.length >= 3) {
            currentPhase = "free_talk";
            setPhase("free_talk");
        }

        const nextSpeaker = decideNextSpeaker(lastResponse, turnCount, currentPhase, spokenInPhase1);
        await callAI(nextSpeaker, apiMessages, currentThreadId!, currentPhase);

        setIsLoading(false);
        setWaitingForAction(true);
    };

    // Enter로 전송 (Shift+Enter는 줄바꿈)
    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
        }
    };

    return (
        <div className="app-layout">
            {/* Sidebar */}
            <aside className={`sidebar ${sidebarOpen ? "open" : "closed"}`}>
                <div className="sidebar-header">
                    <h1 className="sidebar-title">Agora</h1>
                    <button className="new-chat-button" onClick={handleNewThread}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 5v14M5 12h14" />
                        </svg>
                        새 토론
                    </button>
                </div>

                <div className="sidebar-content">
                    <div className="chat-history">
                        <div className="history-section-title">최근 토론</div>
                        {threads.length === 0 ? (
                            <div className="history-empty">
                                아직 토론 기록이 없습니다
                            </div>
                        ) : (
                            <div className="thread-list">
                                {threads.map((thread) => (
                                    <div
                                        key={thread.id}
                                        className={`thread-item ${currentThreadId === thread.id ? "active" : ""}`}
                                        onClick={() => handleSelectThread(thread.id)}
                                    >
                                        <span className="thread-title">{thread.title}</span>
                                        <button
                                            className="thread-delete"
                                            onClick={(e) => handleDeleteThread(thread.id, e)}
                                            aria-label="삭제"
                                        >
                                            ×
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div className="sidebar-footer">
                    <div className="sidebar-footer-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="3" />
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                        </svg>
                        설정
                    </div>
                </div>
            </aside>

            {/* Toggle Button */}
            <button
                className="sidebar-toggle"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                aria-label={sidebarOpen ? "사이드바 닫기" : "사이드바 열기"}
            >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    {sidebarOpen ? (
                        <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />
                    ) : (
                        <path d="M13 17l5-5-5-5M6 17l5-5-5-5" />
                    )}
                </svg>
            </button>

            {/* Main Content */}
            <main className="main-content">
                <div className="chat-container">
                    {/* Chat Header */}
                    <header className="chat-header">
                        <h2>{currentThreadTitle}</h2>
                    </header>

                    {/* Messages */}
                    <div className="messages-area">
                        {messages.length === 0 ? (
                            <div className="empty-state">
                                <div className="empty-state-icon">💬</div>
                                <h2>대화를 시작하세요</h2>
                                <p>메시지를 입력하면 세 AI가 순서대로 응답합니다</p>
                            </div>
                        ) : (
                            messages.map((msg) => (
                                <div
                                    key={msg.id}
                                    className={`message ${msg.type === "user" ? "user-message" : `ai-message ${msg.model}`}`}
                                >
                                    {/* Avatar */}
                                    <div className={`avatar ${msg.type === "user" ? "user" : msg.model}`}>
                                        {msg.type === "user" ? "나" : MODEL_ICONS[msg.model!]}
                                    </div>

                                    {/* Message Bubble */}
                                    <div className="message-bubble">
                                        {msg.type === "ai" && (
                                            <div className="sender-name">{MODEL_NAMES[msg.model!]}</div>
                                        )}
                                        <div className="content">
                                            {msg.isLoading ? (
                                                <div className="loading-dots">
                                                    <span></span>
                                                    <span></span>
                                                    <span></span>
                                                </div>
                                            ) : msg.error ? (
                                                <div className="error-message">오류: {msg.error}</div>
                                            ) : (
                                                msg.content
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}

                        {/* 액션 버튼 */}
                        {waitingForAction && (
                            <div className="action-buttons">
                                <button
                                    className="action-button continue"
                                    onClick={() => handleAction("continue")}
                                    disabled={isLoading}
                                >
                                    ▶ 계속
                                </button>
                                <button
                                    className="action-button intervene"
                                    onClick={() => handleAction("intervene")}
                                    disabled={isLoading}
                                >
                                    ✋ 개입
                                </button>
                                <button
                                    className="action-button exit"
                                    onClick={() => handleAction("exit")}
                                    disabled={isLoading}
                                >
                                    ⏹ 종료
                                </button>
                            </div>
                        )}

                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input */}
                    <div className="input-area">
                        <form className="input-form" onSubmit={handleSubmit}>
                            <div className="input-wrapper">
                                <textarea
                                    ref={textareaRef}
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder="메시지를 입력하세요..."
                                    rows={1}
                                    disabled={isLoading}
                                />
                            </div>
                            <button type="submit" className="send-button" disabled={!input.trim() || isLoading}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                                </svg>
                            </button>
                        </form>
                    </div>
                </div>
            </main>
        </div>
    );
}
