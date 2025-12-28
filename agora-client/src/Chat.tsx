import { useState, useRef, useEffect, type FormEvent, type KeyboardEvent } from "react";
import type { Message, ModelType, Thread } from "./types";
import { sendToModelsSequentially, createThread, getThreads, getThread, deleteThread, generateThreadTitle } from "./api";
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

    // 메시지 전송
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
        setMessages((prev) => [...prev, userChatMessage]);

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

        // 순차적으로 모델 호출 (thread_id 전달)
        const allMessages = await sendToModelsSequentially(
            apiMessages,
            (model, result) => {
                const nextModel = result.nextModel;

                // 현재 모델 응답 추가
                const aiMessage: ChatMessage = {
                    id: `ai-${model}-${Date.now()}`,
                    type: "ai",
                    content: result.content,
                    model,
                    error: result.error,
                };

                setMessages((prev) => {
                    // 로딩 메시지 제거하고 실제 응답 추가
                    const withoutLoading = prev.filter((m) => m.id !== `loading-${model}`);
                    const newMessages = [...withoutLoading, aiMessage];

                    // 다음 모델 로딩 메시지 추가
                    if (nextModel) {
                        newMessages.push({
                            id: `loading-${nextModel}`,
                            type: "ai",
                            content: "",
                            model: nextModel,
                            isLoading: true,
                        });
                    }

                    return newMessages;
                });
            },
            // 첫 번째 AI 로딩 표시
            (firstModel) => {
                setMessages((prev) => [
                    ...prev,
                    {
                        id: `loading-${firstModel}`,
                        type: "ai",
                        content: "",
                        model: firstModel,
                        isLoading: true,
                    },
                ]);
            },
            threadId
        );

        // 첫 턴이면 제목 생성
        if (isFirstTurn && threadId) {
            try {
                const updatedThread = await generateThreadTitle(threadId, allMessages);
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
        loadThreads(); // 쓰레드 목록 새로고침
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
