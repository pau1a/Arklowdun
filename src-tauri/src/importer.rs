use chrono::{SecondsFormat, Utc};
use serde_json::{json, Value};
use std::time::Instant;
use std::{
    env,
    fs::{create_dir_all, read_dir, File},
    io::Write,
    path::{Path, PathBuf},
    time::SystemTime,
};
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub struct ImportLogger {
    file: File,
    seq: u64,
    bytes: u64,
    max_bytes: u64,
    truncated: bool,
}

impl ImportLogger {
    pub fn new(dir: PathBuf) -> anyhow::Result<(Self, PathBuf)> {
        create_dir_all(&dir)?;
        let ts = Utc::now().format("%Y%m%d_%H%M%S");
        let mut path = dir.clone();
        let mut counter = 0;
        loop {
            let name = if counter == 0 {
                format!("import_{}.log", ts)
            } else {
                format!("import_{}_{}.log", ts, counter)
            };
            path.push(&name);
            if !path.exists() {
                break;
            }
            path.pop();
            counter += 1;
        }
        let f = File::create(&path)?;
        Ok((
            Self {
                file: f,
                seq: 0,
                bytes: 0,
                max_bytes: 10 * 1024 * 1024,
                truncated: false,
            },
            path,
        ))
    }

    fn write_line(&mut self, line: &str) {
        let _ = writeln!(self.file, "{}", line);
        let _ = self.file.flush();
        self.bytes += line.len() as u64 + 1;
    }

    pub fn record(&mut self, level: &str, event: &str, mut v: Value) -> Option<Value> {
        if self.truncated {
            return None;
        }
        let obj = v.as_object_mut()?;
        obj.insert(
            "ts".into(),
            Utc::now()
                .to_rfc3339_opts(SecondsFormat::Millis, true)
                .into(),
        );
        self.seq += 1;
        obj.insert("seq".into(), self.seq.into());
        obj.insert("level".into(), level.into());
        obj.insert("event".into(), event.into());
        let line = serde_json::to_string(&v).ok()?;
        let needed = line.len() as u64 + 1;
        if self.bytes + needed > self.max_bytes {
            let warn = json!({
                "ts": Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
                "level": "warn",
                "seq": self.seq + 1,
                "event": "warning",
                "fields": {"reason": "log_truncated"}
            });
            if let Ok(w) = serde_json::to_string(&warn) {
                self.write_line(&w);
            }
            self.truncated = true;
            return None;
        }
        self.write_line(&line);
        Some(v)
    }
}

fn cleanup_logs(dir: &Path) {
    let max_files: usize = env::var("IMPORT_LOG_RETENTION")
        .ok()
        .and_then(|v| v.parse().ok())
        .filter(|v| *v > 0)
        .unwrap_or(10);
    if let Ok(entries) = read_dir(dir) {
        let mut files: Vec<(SystemTime, PathBuf)> = entries
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let path = e.path();
                if path.is_file() {
                    let meta = e.metadata().ok()?;
                    let created = meta.created().or_else(|_| meta.modified()).ok()?;
                    Some((created, path))
                } else {
                    None
                }
            })
            .collect();
        files.sort_by_key(|(t, _)| *t);
        let len = files.len();
        if len > max_files {
            for (_, p) in files.into_iter().take(len - max_files) {
                let _ = std::fs::remove_file(p);
            }
        }
    }
}

pub async fn run_import<R: Runtime>(
    app: &AppHandle<R>,
    household_id: String,
    dry_run: bool,
) -> Result<(), sqlx::Error> {
    let data_dir = app.path().app_data_dir().unwrap_or_default();
    let mut logs_dir = data_dir.clone();
    logs_dir.push("logs");

    let (mut ilog, log_path) =
        ImportLogger::new(logs_dir.clone()).map_err(|e| sqlx::Error::Protocol(e.to_string()))?;

    let version = app.package_info().version.to_string();
    let platform = env::consts::OS;
    let start_payload = json!({
        "fields": {
            "household": household_id,
            "dry_run": dry_run,
            "version": version,
            "platform": platform,
            "logPath": log_path
        }
    });
    if let Some(p) = ilog.record("info", "start", start_payload) {
        let _ = app.emit("import://started", &p);
    }

    let steps = ["scan", "validate", "normalize", "write"];
    let overall_start = Instant::now();
    let result: anyhow::Result<()> = {
        for step in steps.iter() {
            if let Some(p) = ilog.record("info", "step_start", json!({"step": step})) {
                let _ = app.emit("import://progress", &p);
            }
            let step_start = Instant::now();
            // real work would happen here
            let dur = step_start.elapsed().as_millis() as u64;
            if let Some(p) = ilog.record(
                "info",
                "step_end",
                json!({"step": step, "duration_ms": dur}),
            ) {
                let _ = app.emit("import://progress", &p);
            }
        }
        Ok(())
    };

    match result {
        Ok(()) => {
            let total_dur = overall_start.elapsed().as_millis() as u64;
            let summary = json!({
                "duration_ms": total_dur,
                "fields": {"imported": 0, "skipped": 0}
            });
            if let Some(p) = ilog.record("info", "done", summary) {
                let _ = app.emit("import://done", &p);
            }
        }
        Err(e) => {
            if let Some(p) = ilog.record(
                "error",
                "error",
                json!({"fields": {"source": e.to_string()}}),
            ) {
                let _ = app.emit("import://error", &p);
            }
            drop(ilog);
            cleanup_logs(&logs_dir);
            return Err(sqlx::Error::Protocol(e.to_string()));
        }
    }

    drop(ilog);
    cleanup_logs(&logs_dir);
    Ok(())
}
