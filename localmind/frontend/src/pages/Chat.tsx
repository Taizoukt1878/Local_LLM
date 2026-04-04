import { useState, useEffect, useRef, useCallback } from "react";
import {
  Send,
  Plus,
  Settings,
  Sun,
  Moon,
  Loader2,
  X,
  Trash2,
  AlertCircle,
  Bot,
} from "lucide-react";
import { streamChat, getInstalledModels, deleteModel, getCatalog, streamModelPull } from "../api";
import ChatMessage from "../components/ChatMessage";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface InstalledModel {
  id: string;
  backend: string;
  size_gb: number;
}

interface Props {
  darkMode: boolean;
  onToggleDark: () => void;
}

const SYSTEM_PROMPT = `You are a concise, accurate AI assistant running locally on the user's device.
  ## Core Rules
    - Answer only what is asked. Do not expand scope unless asked.
    - Never add meta-commentary, parenthetical notes, or explanations of your own reasoning.
    - Never explain why you gave a response or what you chose not to include.
    - Do not preface answers with affirmations like "Great question!", "Sure!", or "Of course!".
    - Do not end responses with offers like "Let me know if you need anything else!"

    ## Honesty
    - If you don't know something, say "I don't know" directly.
    - Never invent facts, URLs, file paths, code that you haven't verified, or capabilities you are unsure about.
    - Distinguish clearly between what you know and what you're guessing.

    ## Format
    - Match response length to the complexity of the request. Short questions get short answers.
    - Use plain prose by default. Use lists or code blocks only when they genuinely aid clarity.
    - No unnecessary padding, preamble, or summaries at the end.`;

const MAX_ASSISTANT_CHARS = 800;

function prepareHistory(
  messages: Message[],
  newUserMsg: Message
): { role: string; content: string }[] {
  const history = [...messages, newUserMsg];
  const truncated = history.map((msg) =>
    msg.role === "assistant" && msg.content.length > MAX_ASSISTANT_CHARS
      ? { ...msg, content: msg.content.slice(0, MAX_ASSISTANT_CHARS) + " […]" }
      : msg
  );
  return [{ role: "system", content: SYSTEM_PROMPT }, ...truncated];
}

export default function Chat({ darkMode, onToggleDark }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [currentModel, setCurrentModel] = useState<InstalledModel | null>(null);
  const [installedModels, setInstalledModels] = useState<InstalledModel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [loadingModels, setLoadingModels] = useState(true);
  const [catalog, setCatalog] = useState<Record<string, { models: { id: string; label: string; tagline: string; backend: string; size_gb: number; description: string; download_url?: string }[] }>>({});
  const [pulling, setPulling] = useState<Record<string, number>>({});

  const bottomRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadModels = useCallback(async () => {
    setLoadingModels(true);
    try {
      const [models, cat] = await Promise.all([getInstalledModels(), getCatalog()]);
      setInstalledModels(models);
      setCatalog(cat);
      if (models.length > 0 && !currentModel) {
        setCurrentModel(models[0]);
      }
    } catch {
      setError("Couldn't load your models. Is the backend running?");
    } finally {
      setLoadingModels(false);
    }
  }, [currentModel]);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [input]);

  const sendMessage = useCallback(() => {
    if (!input.trim() || streaming || !currentModel) return;

    const userMsg: Message = { role: "user", content: input.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setError(null);
    setStreaming(true);

    const payload = prepareHistory(messages, userMsg);
    let assistantContent = "";

    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    cleanupRef.current = streamChat(
      currentModel.id,
      currentModel.backend,
      payload,
      (token) => {
        assistantContent += token;
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", content: assistantContent };
          return next;
        });
      },
      () => {
        setStreaming(false);
        cleanupRef.current = null;
      },
      (msg) => {
        setError(msg);
        setStreaming(false);
        // Remove empty assistant bubble
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          return last?.content === "" ? prev.slice(0, -1) : prev;
        });
      }
    );
  }, [input, streaming, currentModel, messages]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handlePullModel = (id: string, backend: string, downloadUrl?: string) => {
    setPulling((p) => ({ ...p, [id]: 0 }));
    const cleanup = streamModelPull(id, backend, downloadUrl, (event) => {
      if (event.percent !== undefined) {
        setPulling((p) => ({ ...p, [id]: event.percent as number }));
      }
      if (event.done) {
        cleanup();
        setPulling((p) => {
          const next = { ...p };
          delete next[id];
          return next;
        });
        loadModels();
      }
    });
  };

  const handleDeleteModel = async (id: string, backend: string) => {
    if (!confirm(`Remove "${id}"? This will delete the model from your computer.`)) return;
    try {
      await deleteModel(id, backend);
      await loadModels();
      if (currentModel?.id === id) setCurrentModel(null);
    } catch {
      setError("Couldn't delete the model. Please try again.");
    }
  };

  const getModelTagline = (id: string) => {
    for (const tier of Object.values(catalog)) {
      const match = tier.models.find((m) => m.id === id);
      if (match) return match.tagline;
    }
    return null;
  };

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen bg-surface text-fg-base">
      {/* Main chat area */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between px-5 py-3 border-b border-stroke bg-surface-1">
          <div className="flex items-center gap-2">
            <Bot size={18} className="text-accent" />
            {currentModel ? (
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium text-fg-base">
                  {getModelTagline(currentModel.id) ?? currentModel.id}
                </span>
                {getModelTagline(currentModel.id) && (
                  <span className="text-xs text-fg-muted">{currentModel.id}</span>
                )}
              </div>
            ) : (
              <span className="text-sm text-fg-muted">No model selected</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setMessages([]);
                setError(null);
              }}
              className="flex items-center gap-1.5 text-xs text-fg-soft hover:text-fg-base px-3 py-1.5 rounded-lg hover:bg-surface-2 transition-colors"
            >
              <Plus size={14} /> New chat
            </button>
            <button
              onClick={onToggleDark}
              className="p-2 rounded-lg hover:bg-surface-2 text-fg-soft hover:text-fg-base transition-colors"
            >
              {darkMode ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 rounded-lg hover:bg-surface-2 text-fg-soft hover:text-fg-base transition-colors"
            >
              <Settings size={16} />
            </button>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
              <div className="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
                <Bot size={24} className="text-accent" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-fg-base">
                  {currentModel ? "Start a conversation" : "No model selected"}
                </h2>
                <p className="text-sm text-fg-muted mt-1">
                  {currentModel
                    ? "Ask anything — everything runs privately on your computer."
                    : "Open settings to choose or download a model."}
                </p>
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <ChatMessage
              key={i}
              role={msg.role}
              content={msg.content}
              streaming={streaming && i === messages.length - 1 && msg.role === "assistant"}
            />
          ))}

          {error && (
            <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 rounded-xl px-4 py-3">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="px-5 pb-5 pt-3 border-t border-stroke">
          <div className="flex items-end gap-3 bg-surface-1 border border-stroke rounded-2xl px-4 py-3 focus-within:border-accent/50 transition-colors">
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                currentModel
                  ? "Message LocalMind... (Enter to send, Shift+Enter for new line)"
                  : "Choose a model in settings to start chatting"
              }
              disabled={!currentModel || streaming}
              className="flex-1 bg-transparent resize-none outline-none text-sm text-fg-base placeholder:text-fg-muted disabled:cursor-not-allowed"
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || streaming || !currentModel}
              className="flex-shrink-0 p-2 rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
            >
              {streaming ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Send size={16} />
              )}
            </button>
          </div>
          <p className="text-[11px] text-fg-muted text-center mt-2">
            Everything runs locally on your device. No data leaves your computer.
          </p>
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowSettings(false)}
          />
          <div className="relative w-96 bg-surface-1 border-l border-stroke h-full overflow-y-auto flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-stroke">
              <h2 className="font-semibold text-fg-base">Settings</h2>
              <button
                onClick={() => setShowSettings(false)}
                className="p-1.5 rounded-lg hover:bg-surface-2 text-fg-soft"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 px-5 py-5 space-y-6">
              {/* Installed models */}
              <section>
                <h3 className="text-xs font-semibold text-fg-muted uppercase tracking-wider mb-3">
                  Your Models
                </h3>
                {loadingModels ? (
                  <Loader2 size={18} className="text-accent animate-spin" />
                ) : installedModels.length === 0 ? (
                  <p className="text-sm text-fg-muted">No models installed yet.</p>
                ) : (
                  <div className="space-y-2">
                    {installedModels.map((m) => (
                      <div
                        key={m.id}
                        onClick={() => {
                          setCurrentModel(m);
                          setShowSettings(false);
                        }}
                        className={`
                          flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all
                          ${currentModel?.id === m.id
                            ? "border-accent bg-accent/10"
                            : "border-stroke hover:border-fg-muted bg-surface-2"
                          }
                        `}
                      >
                        <div>
                          <div className="text-sm font-medium text-fg-base">
                            {getModelTagline(m.id) ?? m.id}
                          </div>
                          <div className="text-xs text-fg-muted">
                            {getModelTagline(m.id) && <span>{m.id} · </span>}
                            {m.size_gb} GB · {m.backend}
                          </div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteModel(m.id, m.backend);
                          }}
                          className="p-1.5 rounded-lg hover:bg-red-500/20 text-fg-muted hover:text-red-400 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Download more */}
              <section>
                <h3 className="text-xs font-semibold text-fg-muted uppercase tracking-wider mb-3">
                  Download More Models
                </h3>
                <div className="space-y-4">
                  {Object.entries(catalog).map(([tierId, tier]) => (
                    <div key={tierId}>
                      <div className="text-xs text-fg-soft font-medium mb-2">{tier.models[0]?.label?.split(" ")[0] ?? tierId}</div>
                      <div className="space-y-1.5">
                        {tier.models.map((model) => {
                          const isInstalled = installedModels.some((m) => m.id === model.id);
                          const pullPct = pulling[model.id];
                          const inProgress = pullPct !== undefined;

                          return (
                            <div
                              key={model.id}
                              className="flex items-center justify-between bg-surface-2 rounded-xl px-3 py-2.5 border border-stroke"
                            >
                              <div className="flex-1 min-w-0">
                                <div className="text-sm text-fg-base truncate">{model.tagline}</div>
                                <div className="text-xs text-fg-muted">{model.label} · {model.size_gb} GB</div>
                              </div>
                              {isInstalled ? (
                                <span className="text-xs text-green-400 ml-2">Installed</span>
                              ) : inProgress ? (
                                <div className="flex items-center gap-2 ml-2">
                                  <div className="w-16 bg-surface-3 rounded-full h-1.5">
                                    <div
                                      className="h-full bg-accent rounded-full transition-all"
                                      style={{ width: `${pullPct}%` }}
                                    />
                                  </div>
                                  <span className="text-xs text-fg-soft">{pullPct}%</span>
                                </div>
                              ) : (
                                <button
                                  onClick={() =>
                                    handlePullModel(model.id, model.backend, model.download_url)
                                  }
                                  className="ml-2 text-xs text-accent hover:text-accent-hover font-medium whitespace-nowrap"
                                >
                                  Download
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
