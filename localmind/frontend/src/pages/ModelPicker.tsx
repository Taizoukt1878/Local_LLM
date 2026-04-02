/**
 * Standalone model picker — reachable from the chat settings panel.
 * Shows the full catalog and lets the user download additional models.
 */
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import { getCatalog, streamModelPull, getInstalledModels } from "../api";
import ModelCard from "../components/ModelCard";

interface InstalledModel {
  id: string;
  backend: string;
  size_gb: number;
}

interface Model {
  id: string;
  label: string;
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

export default function ModelPicker() {
  const navigate = useNavigate();
  const [catalog, setCatalog] = useState<Record<string, TierData>>({});
  const [installed, setInstalled] = useState<InstalledModel[]>([]);
  const [selectedTier, setSelectedTier] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [pulling, setPulling] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getCatalog(), getInstalledModels()])
      .then(([cat, inst]) => {
        setCatalog(cat);
        setInstalled(inst);
      })
      .catch(() => setError("Couldn't load the model catalog. Please try again."))
      .finally(() => setLoading(false));
  }, []);

  const handleDownload = () => {
    if (!selectedModel || !selectedTier) return;
    const models = catalog[selectedTier]?.models ?? [];
    const model = models.find((m) => m.id === selectedModel);
    if (!model) return;

    setPulling((p) => ({ ...p, [model.id]: 0 }));
    const cleanup = streamModelPull(
      model.id,
      model.backend,
      model.download_url,
      (event) => {
        if (event.percent !== undefined) {
          setPulling((p) => ({ ...p, [model.id]: event.percent as number }));
        }
        if (event.done) {
          cleanup();
          setPulling((p) => {
            const next = { ...p };
            delete next[model.id];
            return next;
          });
          // Refresh installed list
          getInstalledModels().then(setInstalled).catch(() => {});
        }
      }
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 size={32} className="text-accent animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col px-8 py-8 max-w-2xl mx-auto w-full">
      <button
        onClick={() => navigate("/chat")}
        className="flex items-center gap-2 text-zinc-400 hover:text-zinc-200 text-sm mb-6 transition-colors"
      >
        <ArrowLeft size={16} /> Back to chat
      </button>

      <h1 className="text-2xl font-bold text-zinc-100 mb-1">Add a Model</h1>
      <p className="text-zinc-400 text-sm mb-6">
        Pick any model from the catalog below. Models run 100% on your device.
      </p>

      {error && (
        <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 rounded-xl px-4 py-3 mb-4">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-4 flex-1">
        {Object.entries(catalog).map(([tierId, tier]) => {
          const isDownloading = tier.models.some((m) => pulling[m.id] !== undefined);
          return (
            <div key={tierId}>
              <ModelCard
                tierId={tierId}
                tier={tier}
                recommended={false}
                selected={selectedTier === tierId}
                selectedModel={selectedTier === tierId ? selectedModel : null}
                onSelect={(t, m) => {
                  setSelectedTier(t);
                  setSelectedModel(m);
                }}
              />
              {isDownloading &&
                tier.models
                  .filter((m) => pulling[m.id] !== undefined)
                  .map((m) => (
                    <div key={m.id} className="mt-2 px-2">
                      <div className="flex justify-between text-xs text-zinc-400 mb-1">
                        <span>Downloading {m.label}...</span>
                        <span>{pulling[m.id]}%</span>
                      </div>
                      <div className="w-full bg-surface-2 rounded-full h-1.5">
                        <div
                          className="h-full bg-accent rounded-full transition-all"
                          style={{ width: `${pulling[m.id]}%` }}
                        />
                      </div>
                    </div>
                  ))}
            </div>
          );
        })}
      </div>

      <div className="sticky bottom-0 pt-4 pb-2 bg-surface">
        <button
          disabled={
            !selectedModel ||
            installed.some((m) => m.id === selectedModel) ||
            pulling[selectedModel ?? ""] !== undefined
          }
          onClick={handleDownload}
          className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium px-8 py-3 rounded-xl transition-colors"
        >
          {selectedModel && installed.some((m) => m.id === selectedModel)
            ? "Already installed"
            : "Download Selected Model"}
        </button>
      </div>
    </div>
  );
}
