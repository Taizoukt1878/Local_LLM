import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  FileText,
  Upload,
  Trash2,
  Send,
  Loader2,
  AlertCircle,
  MessageSquare,
} from "lucide-react";
import {
  getDocsCompatibility,
  listDocuments,
  uploadDocument,
  deleteDocument,
  chatWithDocument,
  getInstalledModels,
  DocInfo,
  DocCompatibility,
} from "../api";
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

export default function DocsChat() {
  const navigate = useNavigate();
  const [docs, setDocs] = useState<DocInfo[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<DocInfo | null>(null);
  const [compatibility, setCompatibility] = useState<DocCompatibility | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [searching, setSearching] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [currentModel, setCurrentModel] = useState<InstalledModel | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    listDocuments().then(setDocs).catch(() => {});
    getDocsCompatibility().then(setCompatibility).catch(() => {});
    getInstalledModels()
      .then((models: InstalledModel[]) => {
        if (models.length > 0) setCurrentModel(models[0]);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [input]);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = "";
      setUploading(true);
      setUploadError(null);
      try {
        const doc = await uploadDocument(file);
        setDocs((prev) => [...prev, doc]);
        setSelectedDoc(doc);
        setMessages([]);
      } catch (err: unknown) {
        setUploadError(
          err instanceof Error ? err.message : "Upload failed. Please try again."
        );
      } finally {
        setUploading(false);
      }
    },
    []
  );

  const handleDelete = useCallback(
    async (doc: DocInfo) => {
      if (!confirm(`Remove "${doc.name}"? The index will be deleted.`)) return;
      try {
        await deleteDocument(doc.id);
        setDocs((prev) => prev.filter((d) => d.id !== doc.id));
        if (selectedDoc?.id === doc.id) {
          setSelectedDoc(null);
          setMessages([]);
        }
      } catch {
        setError("Could not delete the document. Please try again.");
      }
    },
    [selectedDoc]
  );

  const sendMessage = useCallback(() => {
    if (!input.trim() || streaming || !selectedDoc || !currentModel) return;

    const question = input.trim();
    setInput("");
    setError(null);
    setSearching(true);
    setStreaming(true);

    const userMsg: Message = { role: "user", content: question };
    setMessages((prev) => [...prev, userMsg, { role: "assistant", content: "" }]);

    let assistantContent = "";

    chatWithDocument(
      selectedDoc.id,
      question,
      currentModel.id,
      currentModel.backend,
      "general",
      (token) => {
        setSearching(false);
        assistantContent += token;
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", content: assistantContent };
          return next;
        });
      }
    )
      .then(() => {
        setSearching(false);
        setStreaming(false);
      })
      .catch((err: unknown) => {
        setSearching(false);
        setStreaming(false);
        const msg =
          err instanceof Error ? err.message : "Could not connect to the AI backend.";
        setError(msg);
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          return last?.content === "" ? prev.slice(0, -1) : prev;
        });
      });
  }, [input, streaming, selectedDoc, currentModel]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex h-screen bg-surface text-fg-base">
      {/* ── Left panel ─────────────────────────────────────────────── */}
      <div className="w-[280px] flex-shrink-0 border-r border-stroke bg-surface-1 flex flex-col">
        {/* Nav tabs */}
        <div className="flex items-center border-b border-stroke px-4">
          <button
            onClick={() => navigate("/chat")}
            className="py-3 px-1 mr-4 text-sm border-b-2 border-transparent text-fg-muted hover:text-fg-base transition-colors"
          >
            💬 Chat
          </button>
          <button className="py-3 px-1 text-sm border-b-2 border-accent text-fg-base font-medium transition-colors">
            📄 Docs
          </button>
        </div>

        {/* Compatibility banner */}
        {compatibility && compatibility.level !== "full" && (
          <div
            className={`mx-3 mt-3 rounded-xl px-3 py-2 text-xs ${
              compatibility.level === "unsupported"
                ? "bg-red-500/10 text-red-400 border border-red-500/20"
                : "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20"
            }`}
          >
            {compatibility.message}
          </div>
        )}

        {/* Upload button */}
        <div className="px-3 pt-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt"
            className="hidden"
            onChange={handleFileSelect}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || compatibility?.level === "unsupported"}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
          >
            {uploading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Upload size={14} />
            )}
            {uploading ? "Indexing…" : "Upload Document"}
          </button>
          {uploadError && (
            <p className="mt-2 text-xs text-red-400">{uploadError}</p>
          )}
        </div>

        {/* Document list */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5">
          {docs.length === 0 && !uploading && (
            <p className="text-xs text-fg-muted text-center mt-6">
              No documents yet. Upload a PDF, DOCX, or TXT file.
            </p>
          )}
          {docs.map((doc) => (
            <div
              key={doc.id}
              onClick={() => {
                setSelectedDoc(doc);
                setMessages([]);
                setError(null);
              }}
              className={`flex items-start justify-between gap-2 p-2.5 rounded-xl border cursor-pointer transition-all ${
                selectedDoc?.id === doc.id
                  ? "border-accent bg-accent/10"
                  : "border-stroke hover:border-fg-muted bg-surface-2"
              }`}
            >
              <div className="flex items-start gap-2 min-w-0">
                <FileText size={14} className="mt-0.5 flex-shrink-0 text-fg-soft" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-fg-base truncate">{doc.name}</p>
                  <p className="text-[11px] text-fg-muted">
                    {doc.pages}p · {doc.size_kb} KB
                  </p>
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(doc);
                }}
                className="p-1 rounded-lg hover:bg-red-500/20 text-fg-muted hover:text-red-400 transition-colors flex-shrink-0"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Right panel ────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between px-5 py-3 border-b border-stroke bg-surface-1">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-accent" />
            <span className="text-sm font-medium text-fg-base">
              {selectedDoc ? selectedDoc.name : "Talk to your Docs"}
            </span>
          </div>
          {currentModel && (
            <span className="text-xs text-fg-muted">{currentModel.id}</span>
          )}
        </header>

        {/* Messages / empty state */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          {!selectedDoc ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <div className="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
                <MessageSquare size={24} className="text-accent" />
              </div>
              <p className="text-sm text-fg-muted">
                Select a document from the left to start chatting
              </p>
            </div>
          ) : (
            <>
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
                    <FileText size={20} className="text-accent" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-fg-base">{selectedDoc.name}</p>
                    <p className="text-xs text-fg-muted mt-1">
                      Ask anything about this document
                    </p>
                  </div>
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i}>
                  <ChatMessage
                    role={msg.role}
                    content={msg.content}
                    streaming={
                      streaming &&
                      i === messages.length - 1 &&
                      msg.role === "assistant"
                    }
                  />
                  {msg.role === "assistant" && msg.content && !searching && (
                    <p className="text-[11px] text-fg-muted mt-1 ml-11">
                      📄 From your document
                    </p>
                  )}
                </div>
              ))}

              {searching && (
                <div className="flex items-center gap-2 text-fg-muted text-xs ml-11">
                  <Loader2 size={12} className="animate-spin" />
                  Searching your document…
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 rounded-xl px-4 py-3">
                  <AlertCircle size={16} />
                  <span>{error}</span>
                </div>
              )}
            </>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        {selectedDoc && (
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
                    ? "Ask a question about your document…"
                    : "No model installed — go to Chat to set up a model"
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
          </div>
        )}
      </div>
    </div>
  );
}
