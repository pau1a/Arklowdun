use std::{
  fs::{create_dir_all, File},
  io::Write,
  path::PathBuf,
};

use chrono::Utc;
use tauri::AppHandle;

pub struct ImportLogger {
  pub file: File,
}

impl ImportLogger {
  pub fn new(mut dir: PathBuf) -> anyhow::Result<(Self, PathBuf)> {
    create_dir_all(&dir)?;
    let ts = Utc::now().format("%Y%m%d_%H%M%S").to_string();
    dir.push(format!("import_{ts}.log"));
    let f = File::create(&dir)?;
    Ok((Self { file: f }, dir))
  }
  pub fn line(&mut self, s: &str) {
    let _ = writeln!(self.file, "{s}");
  }
}

pub async fn run_import(
  app: &AppHandle,
  household_id: String,
  dry_run: bool,
) -> Result<(), sqlx::Error> {
  // UFCS so we don’t depend on `use tauri::Manager;`
  let data_dir = tauri::Manager::path(app)
    .app_data_dir()
    .unwrap_or_default();

  let mut logs_dir = data_dir.clone();
  logs_dir.push("logs");

  let (mut ilog, log_path) = ImportLogger::new(logs_dir)
    .map_err(|e| sqlx::Error::Protocol(e.to_string().into()))?;

  // UFCS so we don’t depend on `use tauri::Emitter;`
  let _ = tauri::Emitter::emit(app, "import://started", &serde_json::json!({ "logPath": log_path }));

  // Simulated steps; replace with real importer work
  for (idx, step) in ["scan", "validate", "normalize", "write"]
    .iter()
    .enumerate()
  {
    let payload = serde_json::json!({ "step": step, "current": idx + 1, "total": 4 });
    ilog.line(&format!("[step] {payload}"));
    let _ = tauri::Emitter::emit(app, "import://progress", &payload);
  }

  let summary = serde_json::json!({
    "imported": 0,
    "skipped": 0,
    "durationMs": 0,
    "dryRun": dry_run,
    "household": household_id
  });
  ilog.line(&format!("[done] {summary}"));
  let _ = tauri::Emitter::emit(app, "import://done", &summary);

  Ok(())
}
