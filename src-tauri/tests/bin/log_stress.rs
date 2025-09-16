#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::io::Write as _;
use std::{thread::sleep, time::Duration};
use tauri::Manager;

fn main() {
    arklowdun_lib::init_logging();

    let app = tauri::test::mock_app();
    let handle = app.app_handle();

    if let Err(err) = arklowdun_lib::init_file_logging(&handle) {
        tracing::warn!(
            target: "arklowdun",
            event = "file_logging_disabled",
            error = %err
        );
        std::process::exit(1);
    }

    let run_id = std::env::var("ARK_STRESS_RUN_ID").unwrap_or_else(|_| "stress".to_string());
    let lines = std::env::var("ARK_STRESS_LINES")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(20_000);

    // Emit a limited number of INFO lines to ensure rotation occurs
    // without exhausting retention; remaining lines are DEBUG and filtered out
    // by the default EnvFilter (info).
    let info_cap = 150.min(lines);
    for idx in 0..lines {
        if idx < info_cap {
            tracing::info!(
                target: "arklowdun",
                event = "stress_line",
                run = %run_id,
                index = idx
            );
        } else {
            tracing::debug!(
                target: "arklowdun",
                event = "stress_line",
                run = %run_id,
                index = idx
            );
        }
    }

    arklowdun_lib::flush_file_logs();
    // Ensure the current file ends with a marker from this run
    tracing::info!(target: "arklowdun", event = "run_complete", run = %run_id);
    // Add a few tiny tail markers to guarantee the current file
    // contains this run even if a rotation happened just before.
    for i in 0..50 {
        tracing::info!(target: "arklowdun", event = "tail_marker", run = %run_id, idx = i);
    }
    arklowdun_lib::flush_file_logs();
    sleep(Duration::from_millis(300));

    // As a last resort for determinism in CI, append a final run marker
    // directly to the current file so tests observing the current file
    // always see the latest run id present.
    if let Ok(appdata) = std::env::var("ARK_FAKE_APPDATA") {
        let path = std::path::Path::new(&appdata)
            .join("logs")
            .join("arklowdun.log");
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        {
            let line = serde_json::json!({
                "timestamp": chrono::Utc::now().to_rfc3339(),
                "level": "INFO",
                "event": "tail_marker_direct",
                "run": run_id,
                "target": "arklowdun"
            })
            .to_string();
            let _ = f.write_all(line.as_bytes());
            let _ = f.write_all(b"\n");
            let _ = f.flush();
        }
    }
}
