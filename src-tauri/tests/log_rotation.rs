#![allow(clippy::unwrap_used, clippy::expect_used)]

use assert_cmd::prelude::*;
use serde_json::Value;
use std::{
    collections::HashSet,
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::Command,
    thread::sleep,
    time::Duration,
};
use tempfile::tempdir;

#[test]
fn rotation_survives_restart() {
    let tmp = tempdir().unwrap();
    let appdata = tmp.path().join("appdata");
    fs::create_dir_all(&appdata).unwrap();

    run_stress(&appdata, "first");
    let first = LogState::capture(&appdata);

    assert!(
        first.files.len() <= 4,
        "too many files after first run: {:?}",
        first.files
    );
    assert!(
        first.rotated_count() >= 2,
        "rotation did not create multiple files"
    );
    assert!(first.run_ids.contains("first"));
    assert_eq!(first.run_ids.len(), 1, "unexpected runs in first pass");

    run_stress(&appdata, "second");
    let second = LogState::capture(&appdata);

    assert!(
        second.files.len() <= 4,
        "retention cap exceeded: {:?}",
        second.files
    );
    assert!(second.run_ids.contains("first"), "first run logs missing");
    assert!(second.run_ids.contains("second"), "second run logs missing");
    let current_run = second
        .last_current
        .as_ref()
        .and_then(|value| value.get("run"))
        .and_then(Value::as_str);
    assert_eq!(
        current_run,
        Some("second"),
        "latest log missing second run marker"
    );

    for path in &second.files {
        assert!(
            fs::metadata(path).unwrap().len() > 0,
            "empty log file: {:?}",
            path
        );
    }
}

fn run_stress(appdata: &Path, run_id: &str) {
    let mut cmd = Command::cargo_bin("log_stress").expect("binary built");
    cmd.env("ARK_FAKE_APPDATA", appdata)
        .env("TAURI_ARKLOWDUN_LOG_MAX_SIZE_BYTES", "10240")
        .env("TAURI_ARKLOWDUN_LOG_MAX_FILES", "3")
        .env("ARK_STRESS_LINES", "20000")
        .env("ARK_STRESS_RUN_ID", run_id);
    cmd.assert().success();
}

#[derive(Debug)]
struct LogState {
    files: Vec<PathBuf>,
    run_ids: HashSet<String>,
    last_current: Option<Value>,
}

impl LogState {
    fn capture(appdata: &Path) -> Self {
        let logs_dir = appdata.join("logs");
        wait_for_current_log(&logs_dir);

        let mut files = collect_log_files(&logs_dir);
        files.sort();

        let mut run_ids = HashSet::new();
        let mut last_current = None;

        for path in &files {
            if let Some(value) = read_log_file(path, &mut run_ids) {
                if path.file_name().and_then(|name| name.to_str()) == Some("arklowdun.log") {
                    last_current = Some(value);
                }
            }
        }

        Self {
            files,
            run_ids,
            last_current,
        }
    }

    fn rotated_count(&self) -> usize {
        self.files
            .iter()
            .filter(|path| path.file_name().and_then(|name| name.to_str()) != Some("arklowdun.log"))
            .count()
    }
}

fn collect_log_files(logs_dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = fs::read_dir(logs_dir)
        .unwrap()
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            if path.is_file() && path.file_name()?.to_str()?.starts_with("arklowdun.log") {
                Some(path)
            } else {
                None
            }
        })
        .collect();
    files.sort();
    files
}

fn read_log_file(path: &Path, run_ids: &mut HashSet<String>) -> Option<Value> {
    let file = fs::File::open(path).expect("open log file");
    let reader = BufReader::new(file);
    let mut last = None;

    for line in reader.lines() {
        let line = line.expect("read log line");
        if line.trim().is_empty() {
            continue;
        }
        let value: Value = serde_json::from_str(&line).expect("parse json log");
        assert_eq!(
            value.get("target").and_then(Value::as_str),
            Some("arklowdun")
        );
        assert!(value.get("event").is_some(), "missing event field: {value}");
        assert!(value.get("timestamp").and_then(Value::as_str).is_some());
        assert_eq!(value.get("level").and_then(Value::as_str), Some("INFO"));
        if let Some(run) = value.get("run").and_then(Value::as_str) {
            run_ids.insert(run.to_string());
        }
        last = Some(value);
    }

    last
}

fn wait_for_current_log(logs_dir: &Path) {
    let current = logs_dir.join("arklowdun.log");
    for _ in 0..40 {
        if let Ok(metadata) = fs::metadata(&current) {
            if metadata.len() > 0 {
                return;
            }
        }
        sleep(Duration::from_millis(50));
    }
    panic!("log file never materialized: {:?}", current);
}
