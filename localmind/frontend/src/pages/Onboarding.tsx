import { useState, useEffect, useCallback } from "react";
import {
  Shield,
  Wifi,
  Lock,
  ChevronRight,
  Cpu,
  HardDrive,
  MemoryStick,
  CheckCircle2,
  Loader2,
  AlertCircle,
} from "lucide-react";
import {
  getSystemInfo,
  getInstallStatus,
  streamOllamaInstall,
  streamModelPull,
  getCatalog,
} from "../api";
import ModelCard from "../components/ModelCard";

// ── Types ──────────────────────────────────────────────────────────────────

interface HardwareProfile {
  ram_gb: number;
  gpu: { present: boolean; name: string | null; vram_gb: number };
  disk_free_gb: number;
  recommended_tier: "small" | "medium" | "large";
}

interface Model {
  id: string;
  label: string;
  tagline: string;
  backend: string;
  size_gb: number;
  description: string;
  download_url?: string;
}

interface TierData {
  label: string;
  description: string;
  requirements: string;
  models: Model[];
}

// ── Subcomponents ──────────────────────────────────────────────────────────

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="w-full bg-surface-2 rounded-full h-2 overflow-hidden">
      <div
        className="h-full bg-accent rounded-full transition-all duration-300"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function Pill({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 bg-surface-2 rounded-xl px-4 py-3 border border-zinc-800">
      <div className="text-accent">{icon}</div>
      <div>
        <div className="text-xs text-zinc-500">{label}</div>
        <div className="text-sm font-medium text-zinc-200">{value}</div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

type Step = "welcome" | "scanning" | "hardware" | "install" | "pick" | "pulling" | "ready";

export default function Onboarding({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<Step>("welcome");
  const [hardware, setHardware] = useState<HardwareProfile | null>(null);
  const [installProgress, setInstallProgress] = useState(0);
  const [installMessage, setInstallMessage] = useState("");
  const [installFailed, setInstallFailed] = useState(false);
  const [installRetryable, setInstallRetryable] = useState(false);
  const [permissionPrompt, setPermissionPrompt] = useState(false);
  const [catalog, setCatalog] = useState<Record<string, TierData>>({});
  const [selectedTier, setSelectedTier] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [pullPercent, setPullPercent] = useState(0);
  const [pullStatus, setPullStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Step: scan hardware
  const runHardwareScan = useCallback(async () => {
    setStep("scanning");
    setError(null);
    try {
      const info = await getSystemInfo();
      setHardware(info);

      const installStatus = await getInstallStatus();
      const cat = await getCatalog();
      setCatalog(cat);
      setSelectedTier(info.recommended_tier);

      if (!installStatus.installed) {
        setStep("install");
      } else {
        setStep("hardware");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setError(
        msg === "BACKEND_OFFLINE"
          ? "The LocalMind backend isn't running. Start it with: cd backend && python main.py"
          : "We couldn't read your computer's specs. Please try again."
      );
      setStep("welcome");
    }
  }, []);

  // Step: install Ollama
  const runOllamaInstall = useCallback(() => {
    setInstallProgress(0);
    setInstallMessage("Starting...");
    setInstallFailed(false);
    setInstallRetryable(false);
    setPermissionPrompt(false);
    setError(null);

    const cleanup = streamOllamaInstall((event) => {
      if (event.stage === "permission_prompt") {
        setPermissionPrompt(true);
        setInstallMessage(event.message as string);
        return;
      }
      if (event.percent !== undefined) setInstallProgress(event.percent as number);
      if (event.message) setInstallMessage(event.message as string);
      if (event.stage === "downloading" || event.stage === "installing") {
        setPermissionPrompt(false);
      }
      if (event.stage === "error") {
        setInstallFailed(true);
        setInstallRetryable((event.retryable as boolean) ?? false);
        setError(event.message as string);
        cleanup();
      }
      if (event.done) {
        cleanup();
        setStep("hardware");
      }
    });
  }, []);

  // Step: pull model
  const startPull = useCallback(() => {
    if (!selectedModel || !selectedTier) return;
    const models = catalog[selectedTier]?.models ?? [];
    const model = models.find((m) => m.id === selectedModel);
    if (!model) return;

    setStep("pulling");
    setPullPercent(0);
    setPullStatus("Starting download...");

    const cleanup = streamModelPull(
      model.id,
      model.backend,
      model.download_url,
      (event) => {
        if (event.percent !== undefined) setPullPercent(event.percent as number);
        if (event.status) setPullStatus(event.status as string);
        if (event.done) {
          cleanup();
          setStep("ready");
        }
      }
    );
  }, [catalog, selectedModel, selectedTier]);

  // Auto-advance from ready
  useEffect(() => {
    if (step === "ready") {
      const timer = setTimeout(() => onComplete(), 2000);
      return () => clearTimeout(timer);
    }
  }, [step, onComplete]);

  // ── Render steps ──────────────────────────────────────────────────────

  if (step === "welcome") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-8 gap-10">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-accent/20 flex items-center justify-center mx-auto mb-6">
            <Lock size={32} className="text-accent" />
          </div>
          <h1 className="text-4xl font-bold text-zinc-100 mb-3">LocalMind</h1>
          <p className="text-lg text-zinc-400 max-w-sm">
            Your private AI, running entirely on your computer.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-4 max-w-xl w-full">
          {[
            { icon: <Wifi size={20} />, label: "No internet", desc: "after setup" },
            { icon: <Shield size={20} />, label: "No subscriptions", desc: "completely free" },
            { icon: <Lock size={20} />, label: "Fully private", desc: "stays on your device" },
          ].map((item) => (
            <div
              key={item.label}
              className="bg-surface-1 rounded-xl p-4 border border-zinc-800 text-center"
            >
              <div className="text-accent flex justify-center mb-2">{item.icon}</div>
              <div className="text-sm font-medium text-zinc-200">{item.label}</div>
              <div className="text-xs text-zinc-500">{item.desc}</div>
            </div>
          ))}
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 rounded-xl px-4 py-3">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <button
          onClick={runHardwareScan}
          className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white font-medium px-8 py-3 rounded-xl transition-colors"
        >
          Get Started <ChevronRight size={18} />
        </button>
      </div>
    );
  }

  if (step === "scanning") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6">
        <Loader2 size={40} className="text-accent animate-spin" />
        <p className="text-zinc-300 text-lg">Checking your computer...</p>
        <p className="text-zinc-500 text-sm">This only takes a second</p>
      </div>
    );
  }

  if (step === "hardware" && hardware) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-8 gap-8 max-w-lg mx-auto w-full">
        <div className="text-center">
          <CheckCircle2 size={36} className="text-green-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-zinc-100">Your computer looks great</h2>
          <p className="text-zinc-400 mt-2">Here's what we found:</p>
        </div>

        <div className="grid grid-cols-1 gap-3 w-full">
          <Pill
            icon={<MemoryStick size={18} />}
            label="Memory (RAM)"
            value={`${hardware.ram_gb} GB`}
          />
          <Pill
            icon={<Cpu size={18} />}
            label="Graphics Card"
            value={
              hardware.gpu.present
                ? `${hardware.gpu.name ?? "GPU"} — ${hardware.gpu.vram_gb} GB VRAM`
                : "No dedicated GPU — CPU mode will be used"
            }
          />
          <Pill
            icon={<HardDrive size={18} />}
            label="Free Disk Space"
            value={`${hardware.disk_free_gb} GB available`}
          />
        </div>

        <div className="bg-accent/10 border border-accent/30 rounded-xl px-5 py-4 w-full text-sm text-zinc-300">
          Based on your specs, we recommend the{" "}
          <span className="text-accent font-semibold capitalize">
            {hardware.recommended_tier}
          </span>{" "}
          tier — you can always change this later.
        </div>

        <button
          onClick={() => setStep("pick")}
          className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white font-medium px-8 py-3 rounded-xl transition-colors w-full justify-center"
        >
          Choose a Model <ChevronRight size={18} />
        </button>
      </div>
    );
  }

  if (step === "install") {
    const idle = installProgress === 0 && !installFailed;

    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-8 gap-8 max-w-lg mx-auto w-full">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-zinc-100">One more thing</h2>
          <p className="text-zinc-400 mt-2">
            We need to install one small component (Ollama) so your computer can run AI models.
            It's free and open source.
          </p>
        </div>

        {/* Permission prompt banner */}
        {permissionPrompt && !installFailed && (
          <div className="flex items-start gap-3 bg-amber-400/10 border border-amber-400/30 rounded-xl px-4 py-3 w-full">
            <AlertCircle size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-amber-200">{installMessage}</p>
          </div>
        )}

        {idle ? (
          <button
            onClick={runOllamaInstall}
            className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white font-medium px-8 py-3 rounded-xl transition-colors"
          >
            Install Now <ChevronRight size={18} />
          </button>
        ) : !installFailed ? (
          <div className="w-full space-y-3">
            <ProgressBar percent={installProgress} />
            <p className="text-sm text-zinc-400 text-center">{installMessage}</p>
          </div>
        ) : null}

        {/* Error + optional retry */}
        {error && installFailed && (
          <div className="w-full space-y-3">
            <div className="flex items-start gap-2 text-red-400 text-sm bg-red-400/10 rounded-xl px-4 py-3">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
            {installRetryable && (
              <button
                onClick={runOllamaInstall}
                className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white font-medium px-8 py-3 rounded-xl transition-colors"
              >
                Try Again <ChevronRight size={18} />
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  if (step === "pick") {
    return (
      <div className="min-h-screen flex flex-col px-8 py-10 gap-6 max-w-2xl mx-auto w-full overflow-y-auto">
        <div>
          <h2 className="text-2xl font-bold text-zinc-100">Pick your AI model</h2>
          <p className="text-zinc-400 mt-1 text-sm">
            Choose the one that best fits your computer. You can add more later.
          </p>
        </div>

        <div className="space-y-4">
          {Object.entries(catalog).map(([tierId, tier]) => (
            <ModelCard
              key={tierId}
              tierId={tierId}
              tier={tier as TierData}
              recommended={hardware?.recommended_tier === tierId}
              selected={selectedTier === tierId}
              selectedModel={selectedTier === tierId ? selectedModel : null}
              onSelect={(t, m) => {
                setSelectedTier(t);
                setSelectedModel(m);
              }}
            />
          ))}
        </div>

        <button
          disabled={!selectedModel}
          onClick={startPull}
          className="flex items-center gap-2 bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium px-8 py-3 rounded-xl transition-colors justify-center mt-2"
        >
          Download &amp; Start <ChevronRight size={18} />
        </button>
      </div>
    );
  }

  if (step === "pulling") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-8 gap-8 max-w-lg mx-auto w-full">
        <div className="text-center">
          <Loader2 size={36} className="text-accent animate-spin mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-zinc-100">Downloading your model</h2>
          <p className="text-zinc-400 mt-2 text-sm">
            This might take a few minutes depending on your connection.
          </p>
        </div>

        <div className="w-full space-y-3">
          <ProgressBar percent={pullPercent} />
          <div className="flex justify-between text-xs text-zinc-500">
            <span>{pullStatus}</span>
            <span>{pullPercent}%</span>
          </div>
        </div>
      </div>
    );
  }

  if (step === "ready") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6">
        <CheckCircle2 size={56} className="text-green-400" />
        <h2 className="text-3xl font-bold text-zinc-100">You're all set!</h2>
        <p className="text-zinc-400">Your AI is ready. Opening the chat...</p>
      </div>
    );
  }

  return null;
}
