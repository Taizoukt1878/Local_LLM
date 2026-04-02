import { HardDrive, Cpu } from "lucide-react";

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

interface Props {
  tierId: string;
  tier: TierData;
  recommended: boolean;
  selected: boolean;
  selectedModel: string | null;
  onSelect: (tierId: string, modelId: string) => void;
}

export default function ModelCard({
  tierId,
  tier,
  recommended,
  selected,
  selectedModel,
  onSelect,
}: Props) {
  return (
    <div
      className={`
        rounded-xl border p-5 cursor-pointer transition-all duration-200
        ${selected
          ? "border-accent bg-accent/10"
          : "border-zinc-700 bg-surface-1 hover:border-zinc-500"
        }
      `}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-zinc-100">{tier.label}</h3>
            {recommended && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-accent/20 text-accent font-medium">
                Recommended
              </span>
            )}
          </div>
          <p className="text-sm text-zinc-400 mt-1">{tier.description}</p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-4">
        <HardDrive size={12} />
        <span>{tier.requirements}</span>
      </div>

      <div className="space-y-2">
        {tier.models.map((model) => (
          <button
            key={model.id}
            onClick={() => onSelect(tierId, model.id)}
            className={`
              w-full text-left rounded-lg border p-3 transition-all duration-150
              ${selectedModel === model.id
                ? "border-accent bg-accent/10"
                : "border-zinc-700 hover:border-zinc-500 bg-surface-2"
              }
            `}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-zinc-200">
                {model.label}
              </span>
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                {model.backend === "llamacpp" && (
                  <span className="flex items-center gap-1 text-amber-400">
                    <Cpu size={10} /> CPU
                  </span>
                )}
                <span>{model.size_gb} GB</span>
              </div>
            </div>
            <p className="text-xs text-zinc-500 mt-1">{model.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
