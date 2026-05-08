import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { Mind } from "../api";

interface Props {
  minds: Mind[];
  selectedMindId: string;
  onSelect: (mindId: string) => void;
}

export default function MindPicker({ minds, selectedMindId, onSelect }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [tooltip, setTooltip] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = minds.find((m) => m.id === selectedMindId) ?? minds[0];

  useEffect(() => {
    if (!expanded) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [expanded]);

  if (minds.length === 0) return null;

  return (
    <div ref={containerRef} className="relative">
      {/* Collapsed pill */}
      {!expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-surface-2 border border-stroke hover:border-accent/50 transition-colors text-sm"
        >
          <span className="text-base leading-none">{selected?.emoji}</span>
          <span className="text-fg-soft font-medium">{selected?.name}</span>
          <ChevronDown size={13} className="text-fg-muted" />
        </button>
      )}

      {/* Expanded card row */}
      {expanded && (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {minds.map((mind) => {
            const isSelected = mind.id === selectedMindId;
            return (
              <div
                key={mind.id}
                className="relative"
                onMouseEnter={() => setTooltip(mind.id)}
                onMouseLeave={() => setTooltip(null)}
              >
                <button
                  onClick={() => {
                    onSelect(mind.id);
                    setExpanded(false);
                  }}
                  className={`
                    flex flex-col items-center gap-1.5 px-4 py-3 rounded-2xl border
                    min-w-[90px] transition-all cursor-pointer
                    ${isSelected
                      ? "border-accent bg-accent/10 shadow-[0_0_0_1px] shadow-accent/30"
                      : "border-stroke bg-surface-2 hover:border-fg-muted"
                    }
                  `}
                >
                  <span className="text-2xl leading-none">{mind.emoji}</span>
                  <span className={`text-xs font-medium ${isSelected ? "text-accent" : "text-fg-base"}`}>
                    {mind.name}
                  </span>
                  <span className="text-[10px] text-fg-muted text-center leading-tight line-clamp-2 max-w-[80px]">
                    {mind.description}
                  </span>
                </button>

                {/* Suggested prompts tooltip */}
                {tooltip === mind.id && mind.suggested_prompts.length > 0 && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-10 w-52 bg-surface-1 border border-stroke rounded-xl shadow-lg p-2 pointer-events-none">
                    <p className="text-[10px] text-fg-muted uppercase tracking-wider mb-1.5 px-1">
                      Suggested
                    </p>
                    {mind.suggested_prompts.slice(0, 3).map((p, i) => (
                      <div
                        key={i}
                        className="text-xs text-fg-soft px-2 py-1 rounded-lg"
                      >
                        "{p}"
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
