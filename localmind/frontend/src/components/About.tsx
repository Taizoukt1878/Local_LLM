import { X } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";

interface Props {
  onClose: () => void;
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function TwitterIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export default function About({ onClose }: Props) {
  function openLink(url: string) {
    open(url).catch(() => {});
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-[420px] max-h-[90vh] overflow-y-auto bg-surface-1 border border-stroke rounded-2xl shadow-2xl p-6 flex flex-col gap-6">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-surface-2 text-fg-muted"
        >
          <X size={16} />
        </button>

        {/* App identity */}
        <div className="flex flex-col items-center text-center gap-2 pt-2">
          <div className="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center text-2xl">
            🧠
          </div>
          <h1 className="text-xl font-bold text-fg-base">LocalMind</h1>
          <p className="text-sm text-fg-muted italic">Your private AI, running entirely on your computer</p>
          <span className="text-xs text-fg-soft bg-surface-2 border border-stroke rounded-full px-3 py-0.5">
            v1.0.0
          </span>
        </div>

        {/* Description */}
        <p className="text-sm text-fg-soft text-center leading-relaxed">
          LocalMind is a free, open-source desktop app for running local LLMs.
          No cloud, no subscriptions, no data leaving your machine.
        </p>

        {/* Developer card */}
        <div className="bg-surface-2 border border-stroke rounded-2xl p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center flex-shrink-0">
            <span className="text-sm font-bold text-accent">AT</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-fg-base">Anouar Taizoukt</div>
            <div className="text-xs text-fg-muted">Creator of LocalMind</div>
          </div>
        </div>

        {/* Social links */}
        <div className="flex flex-col gap-2">
          <button
            onClick={() => openLink("https://github.com/Taizoukt1878")}
            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-2 border border-stroke hover:border-fg-muted transition-colors text-sm text-fg-base"
          >
            <span className="text-fg-muted"><GitHubIcon /></span>
            <span>GitHub</span>
            <span className="ml-auto text-xs text-fg-muted">github.com/Taizoukt1878</span>
          </button>
          <button
            onClick={() => openLink("https://linkedin.com")}
            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-2 border border-stroke hover:border-fg-muted transition-colors text-sm text-fg-base"
          >
            <span className="text-fg-muted"><LinkedInIcon /></span>
            <span>LinkedIn</span>
            <span className="ml-auto text-xs text-fg-muted">Add your URL</span>
          </button>
          <button
            onClick={() => openLink("https://x.com")}
            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-2 border border-stroke hover:border-fg-muted transition-colors text-sm text-fg-base"
          >
            <span className="text-fg-muted"><TwitterIcon /></span>
            <span>Twitter / X</span>
            <span className="ml-auto text-xs text-fg-muted">Add your URL</span>
          </button>
        </div>

        {/* Tech credits */}
        <div className="text-center">
          <p className="text-xs text-fg-muted">Powered by Ollama and Llama.cpp</p>
          <p className="text-xs text-fg-muted mt-0.5">Built with Tauri, React, and Python</p>
        </div>
      </div>
    </div>
  );
}
