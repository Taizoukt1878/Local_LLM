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
  } catch {
    return window.fetch(url, init);
  }
}

/** Poll the backend port every 500ms for up to 60 seconds (120 attempts).
 *  Uses a Rust TCP command so WebView2's loopback network-isolation on
 *  Windows cannot interfere with the startup probe.
 *  Calls onSlow after 15 seconds (attempt 30) if still not ready.
 *  Throws after all retries are exhausted. */
export async function waitForBackend(onSlow?: () => void): Promise<void> {
  const maxAttempts = 120;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    console.log('[health] attempt', attempt);
    if (attempt === 30 && onSlow) onSlow();
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

export async function getSystemInfo() {
  let res: Response;
  try {
    res = await apiFetch(`${BASE}/system/info`);
  } catch {
    throw new Error("BACKEND_OFFLINE");
  }
  if (!res.ok) throw new Error("Failed to read system info");
  return res.json();
}

export async function getInstallStatus() {
  const res = await apiFetch(`${BASE}/install/status`);
  if (!res.ok) throw new Error("Failed to check install status");
  return res.json() as Promise<{ installed: boolean; running: boolean }>;
}

export async function getCatalog() {
  const res = await apiFetch(`${BASE}/catalog`);
  if (!res.ok) throw new Error("Failed to load model catalog");
  return res.json();
}

export async function getInstalledModels() {
  const res = await apiFetch(`${BASE}/models/installed`);
  if (!res.ok) throw new Error("Failed to list installed models");
  return res.json();
}

export async function deleteModel(name: string, backend: string) {
  const res = await apiFetch(
    `${BASE}/models/${encodeURIComponent(name)}?backend=${backend}`,
    { method: "DELETE" }
  );
  if (!res.ok) throw new Error("Failed to delete model");
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
