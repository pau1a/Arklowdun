#![allow(clippy::unwrap_used, clippy::expect_used)]

use assert_cmd::prelude::*;
use std::process::Command;
use std::{fs, thread::sleep, time::Duration};
use tauri::Manager;

#[test]
fn file_sink_writes_json_lines() {
    let tmp = tempfile::tempdir().unwrap();
    std::env::set_var("ARK_FAKE_APPDATA", tmp.path());

    // Initialize file logging in this process to ensure the directory exists
    let app = tauri::test::mock_app();
    let handle = app.app_handle();
    arklowdun_lib::init_file_logging(handle.clone()).expect("file logging to initialize");

    // resolve_logs_dir() uses ARK_FAKE_APPDATA in the library, so mirror that here
    let fake = std::env::var("ARK_FAKE_APPDATA").expect("ARK_FAKE_APPDATA set");
    let logs_dir = std::path::PathBuf::from(fake).join("logs");
    // Write a couple of lines using the standalone stress logger so the worker drains on process exit
    let status = Command::cargo_bin("log_stress")
        .expect("find log_stress bin")
        .env("ARK_FAKE_APPDATA", tmp.path())
        .env("ARK_STRESS_RUN_ID", "smoke")
        .env("ARK_STRESS_LINES", "1000")
        .status()
        .expect("spawn log_stress");
    assert!(status.success(), "log_stress failed");

    // Run a second time to ensure bytes land regardless of buffer timing
    let status2 = Command::cargo_bin("log_stress")
        .expect("find log_stress bin")
        .env("ARK_FAKE_APPDATA", tmp.path())
        .env("ARK_STRESS_RUN_ID", "smoke2")
        .env("ARK_STRESS_LINES", "1000")
        .status()
        .expect("spawn log_stress 2");
    assert!(status2.success(), "log_stress second run failed");
    // Give the non-blocking writer a moment to drain
    std::thread::sleep(std::time::Duration::from_millis(200));

    // Resolve the current log file (arklowdun.log or a rotated sibling) once it has content
    let log_path = wait_for_log_with_content(&logs_dir);

    let contents = fs::read_to_string(&log_path).expect("read log file with content");

    // Parse all JSON lines; prefer a stress_line, else take the first JSON line
    let parsed: Vec<serde_json::Value> = contents
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .collect();
    assert!(
        !parsed.is_empty(),
        "no JSON lines found in log file: {}",
        log_path.display()
    );

    let is_event = |obj: &serde_json::Value, name: &str| -> bool {
        obj.get("event")
            .and_then(|e| e.as_str())
            .map(|s| s == name)
            .or_else(|| {
                obj.get("fields")
                    .and_then(|f| f.get("event"))
                    .and_then(|e| e.as_str())
                    .map(|s| s == name)
            })
            .unwrap_or(false)
    };

    let line = parsed
        .iter()
        .find(|v| is_event(v, "stress_line") || is_event(v, "smoke_test"))
        .unwrap_or_else(|| &parsed[0]);

    // Helper to get string fields that may appear at top-level or under fields{}
    let get = |obj: &serde_json::Value, key: &str| -> Option<String> {
        obj.get(key)
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .or_else(|| {
                obj.get("fields")
                    .and_then(|f| f.get(key))
                    .and_then(|v| v.as_str().map(|s| s.to_string()))
            })
    };

    // event should exist and be a string
    assert!(get(&line, "event").is_some());
    assert_eq!(get(&line, "level").as_deref(), Some("INFO"));
    assert!(
        line.get("timestamp").and_then(|v| v.as_str()).is_some(),
        "timestamp must be present"
    );
    let target_binding = get(&line, "target");
    let target = target_binding.as_deref();
    assert!(
        matches!(target, Some("arklowdun") | Some("arklowdun_lib")),
        "unexpected target: {:?}",
        target
    );
}

fn wait_for_log_with_content(dir: &std::path::Path) -> std::path::PathBuf {
    // Wait up to ~10s for the first bytes to land (non-blocking writer).
    for _ in 0..200 {
        arklowdun_lib::flush_file_logs();
        if let Ok(entries) = fs::read_dir(dir) {
            // Prefer the current file, but accept any rotated sibling
            let mut candidates: Vec<std::path::PathBuf> = entries
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| {
                    p.file_name()
                        .and_then(|n| n.to_str())
                        .map(|n| n.starts_with("arklowdun.log"))
                        .unwrap_or(false)
                })
                .collect();
            candidates.sort();

            for p in candidates {
                if let Ok(metadata) = fs::metadata(&p) {
                    if metadata.len() > 0 {
                        return p;
                    }
                }
                if let Ok(contents) = fs::read_to_string(&p) {
                    if contents.lines().any(|l| !l.trim().is_empty()) {
                        return p;
                    }
                }
            }
        }
        sleep(Duration::from_millis(50));
    }
    // Dump directory contents for debugging before failing
    if let Ok(entries) = fs::read_dir(dir) {
        eprintln!("Logs dir contents for {:?}:", dir);
        for e in entries.flatten() {
            let p = e.path();
            let name = p
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("<non-utf8>");
            let size = fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
            eprintln!("  {}  {} bytes", name, size);
            if let Ok(txt) = fs::read_to_string(&p) {
                let lines: Vec<&str> = txt.lines().collect();
                let start = lines.len().saturating_sub(5);
                for line in &lines[start..] {
                    eprintln!("    {}", line);
                }
            }
        }
    }
    panic!("log file did not appear in dir: {:?}", dir);
}
