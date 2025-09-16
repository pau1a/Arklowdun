#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::sync::{Arc, Mutex};

use tracing_subscriber::{fmt, EnvFilter};

#[test]
fn critical_error_emits_crash_id_and_log() {
    let buf = Arc::new(Mutex::new(Vec::<u8>::new()));
    let writer = buf.clone();
    let _ = fmt()
        .with_env_filter(EnvFilter::new("arklowdun=trace"))
        .with_writer(move || TestWriter(writer.clone()))
        .json()
        .try_init();

    let error = arklowdun_lib::AppError::critical("UNIT/CRIT", "boom");
    let crash_id = error
        .crash_id()
        .cloned()
        .expect("critical error assigns crash id");
    let crash_str = crash_id.to_string();

    let json = serde_json::to_string(&error).expect("serialize");
    let value: serde_json::Value = serde_json::from_str(&json).expect("parse");
    assert_eq!(
        value.get("crash_id").and_then(|v| v.as_str()),
        Some(crash_str.as_str())
    );
    let expected = format!("Something went wrong. Crash ID: {crash_str}.");
    assert_eq!(
        value.get("message").and_then(|v| v.as_str()),
        Some(expected.as_str())
    );
    assert!(
        !json.contains("\"boom\""),
        "sanitized message leaked original payload: {json}"
    );

    let logs = String::from_utf8(buf.lock().unwrap().clone()).unwrap();
    assert!(
        logs.contains("\"event\":\"critical_failure\""),
        "missing critical_failure log: {logs}"
    );
    assert!(
        logs.contains(&format!("\"crash_id\":\"{crash_id}\"")),
        "log missing crash id: {logs}"
    );
}

#[derive(Clone)]
struct TestWriter(Arc<Mutex<Vec<u8>>>);

impl std::io::Write for TestWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
