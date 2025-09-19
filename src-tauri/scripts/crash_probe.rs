use arklowdun_lib::AppError;

fn main() {
    arklowdun_lib::init_logging();

    // Log the path if file logging initialized successfully (side effect only).
    let _ = arklowdun_lib::init_file_logging_standalone("com.arklowdun.app").inspect(|path| {
        println!("File log: {}", path.display());
    });

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
