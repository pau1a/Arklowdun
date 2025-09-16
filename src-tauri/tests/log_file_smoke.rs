#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::{fs, thread::sleep, time::Duration};
use tauri::Manager;

#[test]
fn file_sink_writes_json_lines() {
    arklowdun_lib::init_logging();

    let tmp = tempfile::tempdir().unwrap();
    std::env::set_var("ARK_FAKE_APPDATA", tmp.path());

    let app = tauri::test::mock_app();
    let handle = app.app_handle();

    arklowdun_lib::init_file_logging(&handle).expect("file logging to initialize");

    // resolve_logs_dir() uses ARK_FAKE_APPDATA in the library, so mirror that here
    let fake = std::env::var("ARK_FAKE_APPDATA").expect("ARK_FAKE_APPDATA set");
    let logs_dir = std::path::PathBuf::from(fake).join("logs");

    assert!(logs_dir.is_dir(), "logs dir missing: {:?}", logs_dir);

    tracing::info!(target = "arklowdun", event = "smoke_test", marker = "first");
    arklowdun_lib::flush_file_logs();

    let log_path = logs_dir.join("arklowdun.log");
    wait_for_file(&log_path);

    let contents = fs::read_to_string(&log_path).expect("read log file");
    let last_line = contents
        .lines()
        .filter(|line| !line.trim().is_empty())
        .last()
        .expect("log line present");
    let value: serde_json::Value = serde_json::from_str(last_line).expect("json log line");

    assert_eq!(
        value.get("event"),
        Some(&serde_json::Value::String("smoke_test".into()))
    );
    assert_eq!(
        value.get("level"),
        Some(&serde_json::Value::String("INFO".into()))
    );
    assert!(value.get("timestamp").and_then(|v| v.as_str()).is_some());
    assert_eq!(
        value.get("target"),
        Some(&serde_json::Value::String("arklowdun".into()))
    );
}

fn wait_for_file(path: &std::path::Path) {
    for _ in 0..20 {
        if path.exists() {
            if let Ok(metadata) = fs::metadata(path) {
                if metadata.len() > 0 {
                    return;
                }
            }
        }
        sleep(Duration::from_millis(50));
    }
    panic!("log file did not appear: {:?}", path);
}
