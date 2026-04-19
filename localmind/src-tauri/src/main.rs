// Prevents additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpStream;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{async_runtime, Manager};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

struct SidecarChild(Mutex<Option<CommandChild>>);

/// Called from the frontend health-poll loop.
/// Doing the TCP check from Rust bypasses the WebView2 loopback
/// network-isolation restriction that silently blocks fetch() on Windows.
#[tauri::command]
fn check_backend_health() -> bool {
    TcpStream::connect_timeout(
        &"127.0.0.1:8765".parse().unwrap(),
        Duration::from_millis(400),
    )
    .is_ok()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![check_backend_health])
        .setup(|app| {
            // macOS: remove the quarantine extended attribute from the sidecar binary
            // before spawning it. Downloaded apps can have this attribute set which
            // causes Gatekeeper to block spawned helper executables.
            #[cfg(target_os = "macos")]
            if let Ok(exe) = std::env::current_exe() {
                if let Some(dir) = exe.parent() {
                    if let Ok(entries) = std::fs::read_dir(dir) {
                        for entry in entries.flatten() {
                            let name = entry.file_name();
                            let n = name.to_string_lossy();
                            if n.starts_with("localmind-backend") {
                                let p = entry.path();
                                let ps = p.to_string_lossy().to_string();
                                // Remove quarantine attribute (no-op if absent)
                                let _ = std::process::Command::new("xattr")
                                    .args(["-d", "com.apple.quarantine", &ps])
                                    .output();
                                // Ensure execute permission
                                let _ = std::process::Command::new("chmod")
                                    .args(["+x", &ps])
                                    .output();
                            }
                        }
                    }
                }
            }

            let sidecar_command = app
                .shell()
                .sidecar("localmind-backend")
                .expect("localmind-backend sidecar not found");

            let (mut rx, child) = match sidecar_command.spawn() {
                Ok(result) => result,
                Err(e) => {
                    eprintln!("[sidecar] Failed to spawn backend: {e}");
                    // Return Ok so the window still opens and the frontend can show
                    // the "backend offline" error with instructions for the user.
                    app.manage(SidecarChild(Mutex::new(None)));
                    return Ok(());
                }
            };

            // Forward sidecar stdout/stderr to the host console so crashes
            // are visible, and keep the pipe drained so uvicorn never blocks.
            async_runtime::spawn(async move {
                use tauri_plugin_shell::process::CommandEvent;
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            eprintln!("[sidecar] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Stderr(line) => {
                            eprintln!("[sidecar err] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Error(e) => {
                            eprintln!("[sidecar error] {e}");
                        }
                        CommandEvent::Terminated(status) => {
                            eprintln!("[sidecar] process exited: {status:?}");
                        }
                        _ => {}
                    }
                }
            });

            app.manage(SidecarChild(Mutex::new(Some(child))));

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let app = window.app_handle();
                if app.webview_windows().is_empty() {
                    if let Some(state) = app.try_state::<SidecarChild>() {
                        if let Ok(mut guard) = state.0.lock() {
                            if let Some(child) = guard.take() {
                                let _ = child.kill();
                            }
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
