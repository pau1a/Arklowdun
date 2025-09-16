use arklowdun_lib::AppError;
use std::path::PathBuf;

fn main() {
    arklowdun_lib::init_logging();

    // Mirror the main app's rotating log location so probes populate the same files.
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    let logs_dir = base.join("com.arklowdun.app").join("logs");
    let log_path = logs_dir.join("arklowdun.log");
    let max_bytes = std::env::var("TAURI_ARKLOWDUN_LOG_MAX_SIZE_BYTES")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(5_000_000);
    let max_files = std::env::var("TAURI_ARKLOWDUN_LOG_MAX_FILES")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(5);
    let _ = arklowdun_lib::init_file_logging_at_path(log_path, max_bytes, max_files);

    let error = AppError::critical("SUPPORT/PROBE", "crash probe triggered");
    if let Some(crash_id) = error.crash_id().cloned() {
        tracing::error!(
            target = "arklowdun",
            event = "crash_probe_triggered",
            crash_id = %crash_id,
            code = %error.code(),
            message = %error.message()
        );
        let _ = serde_json::to_string(&error);
        arklowdun_lib::flush_file_logs();
        println!("Crash probe executed. Crash ID: {crash_id}");
    } else {
        println!("Crash probe executed without crash id (unexpected)");
    }
}
