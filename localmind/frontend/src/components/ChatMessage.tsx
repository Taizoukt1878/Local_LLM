import { Bot, User } from "lucide-react";

interface Props {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

export default function ChatMessage({ role, content, streaming }: Props) {
  const isUser = role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      {/* Avatar */}
      <div
        className={`
          flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center
          ${isUser ? "bg-accent" : "bg-surface-2 border border-stroke"}
        `}
      >
        {isUser ? (
          <User size={14} className="text-white" />
        ) : (
          <Bot size={14} className="text-fg-soft" />
        )}
      </div>

      {/* Bubble */}
      <div
        className={`
          max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed
          ${isUser
            ? "bg-accent text-white rounded-tr-sm"
            : "bg-surface-1 border border-zinc-800 text-fg-base rounded-tl-sm"
          }
        `}
      >
        <span style={{ whiteSpace: "pre-wrap" }}>{content}</span>
        {streaming && (
          <span className="inline-block w-2 h-4 ml-0.5 bg-current opacity-70 animate-pulse rounded-sm" />
        )}
      </div>
    </div>
  );
}
