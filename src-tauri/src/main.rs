// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    arklowdun_lib::init_logging();
    tracing::debug!(target: "arklowdun", "app booted");
    arklowdun_lib::run()
}
