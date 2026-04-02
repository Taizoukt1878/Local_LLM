// Prevents additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Command;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Spawn the Python backend sidecar on startup.
            let sidecar_command = app
                .shell()
                .sidecar("localmind-backend")
                .expect("localmind-backend sidecar not found");

            let (_rx, _child) = sidecar_command
                .spawn()
                .expect("Failed to spawn localmind-backend sidecar");

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
