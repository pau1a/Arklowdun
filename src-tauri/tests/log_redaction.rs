#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::sync::{Arc, Mutex};
use tracing_subscriber::{fmt, EnvFilter};

#[test]
fn fs_deny_logs_no_path() {
    // Capture logs
    let buf = Arc::new(Mutex::new(Vec::<u8>::new()));
    let writer = buf.clone();
    let _ = fmt()
        .with_env_filter(EnvFilter::new("arklowdun=info"))
        .with_writer(move || Redactor(writer.clone()))
        .json()
        .try_init();

    // Arrange a fake appdata and mock app
    let dir = std::env::temp_dir().join("ark_redaction_smoke");
    std::fs::create_dir_all(&dir).ok();
    std::env::set_var("ARK_FAKE_APPDATA", &dir);

    let app = tauri::test::mock_app();
    let handle = app.handle();

    // Trigger a deny via canonicalize_and_verify("..")
    let err = arklowdun_lib::security::fs_policy::canonicalize_and_verify(
        "..",
        arklowdun_lib::security::fs_policy::RootKey::AppData,
        handle,
    )
    .unwrap_err();
    let reason = err.name();
    let ui: arklowdun_lib::security::error_map::UiError = err.into();
    arklowdun_lib::log_fs_deny(
        arklowdun_lib::security::fs_policy::RootKey::AppData,
        &ui,
        reason,
    );

    let s = String::from_utf8(buf.lock().unwrap().clone()).unwrap();
    assert!(s.contains("\"event\":\"fs_guard_check\""));
    assert!(s.contains("\"ok\":false"));
    assert!(
        !s.contains(dir.to_string_lossy().as_ref()),
        "log leaked a raw path"
    );
}

struct Redactor(Arc<Mutex<Vec<u8>>>);
impl std::io::Write for Redactor {
    fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(b);
        Ok(b.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
