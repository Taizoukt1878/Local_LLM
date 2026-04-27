import { invoke } from "@tauri-apps/api/core";
// tauri-plugin-http routes requests through Rust, which is required on Windows
// where WebView2 blocks loopback fetch(). On macOS/Linux the native WKWebView/
// WebKit fetch() reaches localhost directly, so we fall back to it when the
// plugin throws (e.g. due to URL-scope issues in the release build).
import { fetch as pluginFetch } from "@tauri-apps/plugin-http";

const BASE = "http://127.0.0.1:8765";

async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await pluginFetch(url, init);
  } catch (pluginErr) {
    console.warn("[apiFetch] plugin-http failed, falling back to window.fetch", url, pluginErr);
    try {
      return await window.fetch(url, init);
    } catch (fetchErr) {
      console.error("[apiFetch] both plugin-http and window.fetch failed", url, fetchErr);
      throw fetchErr;
    }
  }
}

/** Poll the backend port every 500ms for up to 30 seconds (60 attempts).
 *  Uses a Rust TCP command so WebView2's loopback network-isolation on
 *  Windows cannot interfere with the startup probe.
 *  Surfaces progressive "still waiting" messages via onSlow:
 *    - after 10s (attempt 20): "Still starting up, please wait..."
 *    - after 20s (attempt 40): "Taking longer than usual on Windows..."
 *  Throws BACKEND_STARTUP_TIMEOUT only after all retries are exhausted. */
export async function waitForBackend(onSlow?: (message: string) => void): Promise<void> {
  const maxAttempts = 60;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    console.log('[health check] attempt:', attempt);
    if (attempt === 20 && onSlow) onSlow("Still starting up, please wait...");
    if (attempt === 40 && onSlow) onSlow("Taking longer than usual on Windows...");
    try {
      const alive = await invoke<boolean>("check_backend_health");
      if (alive) return;
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("BACKEND_STARTUP_TIMEOUT");
}

// ── Safe defaults for non-health endpoints ────────────────────────────────
//
// Per design: only the health check is allowed to surface a fatal error to
// the user. All other endpoints catch network failures, log via
// console.error('[api] failed:', endpoint, error), and return a usable
// fallback so a single transient network blip can't strand the UI.

const DEFAULT_SYSTEM_INFO = {
  ram_gb: 8,
  gpu_present: false,
  gpu_name: null as string | null,
  vram_gb: 0,
  disk_free_gb: 50,
  recommended_tier: "small" as "small" | "medium" | "large",
  platform: "Unknown",
};

export type SystemInfo = typeof DEFAULT_SYSTEM_INFO;

export async function getSystemInfo(): Promise<SystemInfo> {
  try {
    const res = await apiFetch(`${BASE}/system/info`);
    if (!res.ok) {
      console.error('[api] failed:', '/system/info', `HTTP ${res.status}`);
      return { ...DEFAULT_SYSTEM_INFO };
    }
    return (await res.json()) as SystemInfo;
  } catch (error) {
    console.error('[api] failed:', '/system/info', error);
    return { ...DEFAULT_SYSTEM_INFO };
  }
}

export async function getInstallStatus(): Promise<{ installed: boolean; running: boolean }> {
  try {
    const res = await apiFetch(`${BASE}/install/status`);
    if (!res.ok) {
      console.error('[api] failed:', '/install/status', `HTTP ${res.status}`);
      return { installed: false, running: false };
    }
    return (await res.json()) as { installed: boolean; running: boolean };
  } catch (error) {
    console.error('[api] failed:', '/install/status', error);
    return { installed: false, running: false };
  }
}

// Loose `any` returns mirror res.json() — call sites pin their own concrete
// shape (TierData map, InstalledModel[]) and adding stricter return types
// here would force casts at every consumer.
export async function getCatalog(): Promise<any> {
  try {
    const res = await apiFetch(`${BASE}/catalog`);
    if (!res.ok) {
      console.error('[api] failed:', '/catalog', `HTTP ${res.status}`);
      return {};
    }
    return await res.json();
  } catch (error) {
    console.error('[api] failed:', '/catalog', error);
    return {};
  }
}

export async function getInstalledModels(): Promise<any> {
  try {
    const res = await apiFetch(`${BASE}/models/installed`);
    if (!res.ok) {
      console.error('[api] failed:', '/models/installed', `HTTP ${res.status}`);
      return [];
    }
    return await res.json();
  } catch (error) {
    console.error('[api] failed:', '/models/installed', error);
    return [];
  }
}

// deleteModel is a destructive write — keep it throwing so callers can show a
// targeted "couldn't delete" message, but log the failure for diagnostics.
export async function deleteModel(name: string, backend: string) {
  const endpoint = `/models/${name}?backend=${backend}`;
  try {
    const res = await apiFetch(
      `${BASE}/models/${encodeURIComponent(name)}?backend=${backend}`,
      { method: "DELETE" }
    );
    if (!res.ok) {
      console.error('[api] failed:', endpoint, `HTTP ${res.status}`);
      throw new Error("Failed to delete model");
    }
  } catch (error) {
    console.error('[api] failed:', endpoint, error);
    throw error;
  }
}

/** Stream Ollama install progress. Calls onEvent for each SSE data line.
 *  Uses fetch instead of EventSource so it routes through Rust and is not
 *  blocked by WebView2 loopback isolation on Windows.
 *  sudoPassword is forwarded to the backend for Linux installs that need sudo. */
export function streamOllamaInstall(
  onEvent: (data: Record<string, unknown>) => void,
  sudoPassword?: string,
): () => void {
  let closed = false;

  apiFetch(`${BASE}/install/ollama`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sudo_password: sudoPassword ?? null }),
  }).then(async (res) => {
    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done || closed) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            onEvent(JSON.parse(line.slice(6)));
          } catch (_) {}
        }
      }
    }
  });

  return () => {
    closed = true;
  };
}

/** Stream model pull progress. */
export function streamModelPull(
  name: string,
  backend: string,
  downloadUrl: string | undefined,
  onEvent: (data: Record<string, unknown>) => void
): () => void {
  let closed = false;

  apiFetch(`${BASE}/models/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, backend, download_url: downloadUrl }),
  }).then(async (res) => {
    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done || closed) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            onEvent(JSON.parse(line.slice(6)));
          } catch (_) {}
        }
      }
    }
  });

  return () => {
    closed = true;
  };
}

/** Stream chat response. Returns a cleanup fn. */
export function streamChat(
  model: string,
  backend: string,
  messages: { role: string; content: string }[],
  onToken: (token: string) => void,
  onDone: () => void,
  onError: (msg: string) => void
): () => void {
  let closed = false;

  apiFetch(`${BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, backend, messages }),
  })
    .then(async (res) => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Unknown error" }));
        onError(err.message ?? "Something went wrong");
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done || closed) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.done) {
              onDone();
              return;
            }
            if (event.token) onToken(event.token);
          } catch (_) {}
        }
      }
      onDone();
    })
    .catch(() => onError("Could not connect to the AI backend."));

  return () => {
    closed = true;
  };
}
