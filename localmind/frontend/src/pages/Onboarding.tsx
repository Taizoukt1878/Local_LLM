import { useState, useEffect, useCallback, useRef } from "react";
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
  gpu_present: boolean;
  gpu_name: string | null;
  vram_gb: number;
  disk_free_gb: number;
  recommended_tier: "small" | "medium" | "large";
  platform: string;
}

const DEFAULT_HARDWARE: HardwareProfile = {
  ram_gb: 8,
  gpu_present: false,
  gpu_name: null,
  vram_gb: 0,
  disk_free_gb: 50,
  recommended_tier: "small",
  platform: "Unknown",
};

// Coerce whatever /system/info returns into the flat shape the UI expects.
// Tolerates missing fields, empty strings, and the legacy nested `gpu` shape
// from older backends so the user never gets stuck on the scan step.
function normalizeHardware(data: unknown): HardwareProfile {
  const d = (data ?? {}) as Record<string, unknown>;
  const legacyGpu = (d.gpu ?? {}) as Record<string, unknown>;

  const gpuPresent =
    typeof d.gpu_present === "boolean"
      ? d.gpu_present
      : typeof legacyGpu.present === "boolean"
        ? legacyGpu.present
        : false;

  const rawName = (d.gpu_name ?? legacyGpu.name) as unknown;
  const gpuName = typeof rawName === "string" && rawName.trim() !== "" ? rawName : null;

  const vramRaw = d.vram_gb ?? legacyGpu.vram_gb;
  const vramGb = typeof vramRaw === "number" ? vramRaw : 0;

  return {
    ram_gb: typeof d.ram_gb === "number" ? d.ram_gb : DEFAULT_HARDWARE.ram_gb,
    gpu_present: gpuPresent,
    gpu_name: gpuName,
    vram_gb: vramGb,
    disk_free_gb:
      typeof d.disk_free_gb === "number" ? d.disk_free_gb : DEFAULT_HARDWARE.disk_free_gb,
    recommended_tier:
      d.recommended_tier === "small" ||
      d.recommended_tier === "medium" ||
      d.recommended_tier === "large"
        ? d.recommended_tier
        : DEFAULT_HARDWARE.recommended_tier,
    platform: typeof d.platform === "string" ? d.platform : DEFAULT_HARDWARE.platform,
  };
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

const isWindows = /win/i.test(navigator.userAgent) && !/android/i.test(navigator.userAgent);
const isLinux = !isWindows && /linux/i.test(navigator.userAgent);

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
  const [sudoPassword, setSudoPassword] = useState("");
  const [needsSudo, setNeedsSudo] = useState(false);

  // Track whether the current scan has already advanced — prevents the
  // hard-timeout fallback from racing the real response and double-advancing.
  const scanAdvancedRef = useRef(false);
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Step: scan hardware. Always advances — either with real data, or with
  // safe defaults after a 5s timeout. Never strands the user on this step.
  const runHardwareScan = useCallback(async () => {
    setStep("scanning");
    setError(null);
    scanAdvancedRef.current = false;
    if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);

    const advance = (info: HardwareProfile, fallbackMessage?: string) => {
      if (scanAdvancedRef.current) return;
      scanAdvancedRef.current = true;
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
        scanTimeoutRef.current = null;
      }
      setHardware(info);
      setSelectedTier(info.recommended_tier);
      if (fallbackMessage) setError(fallbackMessage);
    };

    // Hard fallback: if anything keeps us on the scan step for more than 5s,
    // force-advance with sane defaults and surface a soft notice.
    scanTimeoutRef.current = setTimeout(() => {
      if (scanAdvancedRef.current) return;
      console.warn('[hardware scan] 5s timeout — advancing with defaults');
      advance(
        DEFAULT_HARDWARE,
        "Could not detect your hardware. Using recommended defaults.",
      );
      setStep("install");
    }, 5000);

    let data: unknown;
    try {
      data = await getSystemInfo();
    } catch (err) {
      // getSystemInfo no longer throws, but defend in depth.
      console.error('[hardware scan] unexpected throw:', err);
      data = null;
    }
    console.log('[hardware scan] response:', data);

    const info = normalizeHardware(data);

    let installStatus: { installed: boolean; running: boolean };
    try {
      installStatus = await getInstallStatus();
    } catch {
      installStatus = { installed: false, running: false };
    }

    let cat: Record<string, unknown>;
    try {
      cat = await getCatalog();
    } catch {
      cat = {};
    }

    if (scanAdvancedRef.current) {
      // The 5s timer already fired — still update background state so the
      // install/pick steps have catalog data when the user reaches them.
      setCatalog(cat as Record<string, TierData>);
      return;
    }

    setCatalog(cat as Record<string, TierData>);
    advance(info);
    if (!installStatus.installed) {
      setStep("install");
    } else {
      setStep("hardware");
    }
  }, []);

  // Cleanup the scan timeout on unmount.
  useEffect(() => {
    return () => {
      if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
    };
  }, []);

  // Step: install Ollama
  const runOllamaInstall = useCallback(() => {
    setInstallProgress(0);
    setInstallMessage("Starting...");
    setInstallFailed(false);
    setInstallRetryable(false);
    setPermissionPrompt(false);
    setNeedsSudo(false);
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
        if (event.needs_sudo) setNeedsSudo(true);
        cleanup();
      }
      if (event.done) {
        cleanup();
        // Verify Ollama is actually running before proceeding, with retries.
        // Windows Ollama takes noticeably longer to initialise than macOS,
        // hence the 5s warmup wait and 5×3s retry window.
        (async () => {
          setInstallMessage("Setting up Ollama, please wait...");
          await new Promise((r) => setTimeout(r, 5000));
          for (let attempt = 0; attempt < 5; attempt++) {
            try {
              const status = await getInstallStatus();
              if (status.running) {
                setStep("hardware");
                return;
              }
            } catch {
              // not ready yet
            }
            if (attempt < 4) {
              await new Promise((r) => setTimeout(r, 3000));
            }
          }
          // Proceed anyway — Ollama may still be initialising.
          setStep("hardware");
        })();
      }
    }, sudoPassword || undefined);
  }, [sudoPassword]);

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
              hardware.gpu_present
                ? `${hardware.gpu_name ?? "GPU"} — ${hardware.vram_gb} GB VRAM`
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

        {/* Windows-specific security prompt hint — shown before and during install */}
        {isWindows && !installFailed && (
          <div className="flex items-start gap-3 bg-blue-400/10 border border-blue-400/30 rounded-xl px-4 py-3 w-full">
            <AlertCircle size={16} className="text-blue-400 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-blue-200">
              Windows may show a security prompt — please click{" "}
              <strong>Yes</strong> or <strong>Allow</strong> if asked.
            </p>
          </div>
        )}

        {/* Linux sudo password field */}
        {isLinux && idle && (
          <div className="w-full space-y-2">
            <label className="text-sm text-zinc-400 block">
              Administrator password{" "}
              <span className="text-zinc-600">(required to install Ollama)</span>
            </label>
            <input
              type="password"
              value={sudoPassword}
              onChange={(e) => setSudoPassword(e.target.value)}
              placeholder="Enter your sudo password"
              className="w-full bg-surface-2 border border-zinc-700 rounded-xl px-4 py-2.5 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-accent text-sm"
            />
            <p className="text-xs text-zinc-600">
              Leave blank if your system is configured for passwordless sudo.
            </p>
          </div>
        )}

        {/* Linux sudo prompt after failed attempt without password */}
        {isLinux && needsSudo && installFailed && (
          <div className="w-full space-y-2">
            <label className="text-sm text-zinc-300 block font-medium">
              Administrator password required
            </label>
            <input
              type="password"
              value={sudoPassword}
              onChange={(e) => setSudoPassword(e.target.value)}
              placeholder="Enter your sudo password"
              className="w-full bg-surface-2 border border-accent/50 rounded-xl px-4 py-2.5 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-accent text-sm"
              autoFocus
            />
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
