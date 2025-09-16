#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::{thread::sleep, time::Duration};
use tauri::Manager;

fn main() {
    arklowdun_lib::init_logging();

    let app = tauri::test::mock_app();
    let handle = app.app_handle();

    if let Err(err) = arklowdun_lib::init_file_logging(&handle) {
        tracing::warn!(
            target = "arklowdun",
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

    for idx in 0..lines {
        tracing::info!(
            target = "arklowdun",
            event = "stress_line",
            run = %run_id,
            index = idx
        );
    }

    arklowdun_lib::flush_file_logs();
    sleep(Duration::from_millis(200));
}
