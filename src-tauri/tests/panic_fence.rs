#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::sync::{Arc, Mutex};

use arklowdun_lib::AppResult;
use tracing_subscriber::{fmt, EnvFilter};
use uuid::Uuid;

#[tauri::command]
async fn panic_command() -> AppResult<()> {
    arklowdun_lib::util::dispatch_async_app_result(|| async move {
        panic!("intentional panic for fence test");
        #[allow(unreachable_code)]
        Ok(())
    })
    .await
}

#[test]
fn panic_is_converted_to_error() {
    let buf = Arc::new(Mutex::new(Vec::<u8>::new()));
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

    let writer = buf.clone();
    let _ = fmt()
        .with_env_filter(EnvFilter::new("arklowdun=trace"))
        .with_writer(move || TestWriter(writer.clone()))
        .json()
        .try_init();

    arklowdun_lib::error::install_panic_hook();

    let builder =
        tauri::test::mock_builder().invoke_handler(tauri::generate_handler![panic_command]);
    let app = builder
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("failed to build app");
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("failed to build window");

    let response = tauri::test::get_ipc_response(
        &window,
        tauri::webview::InvokeRequest {
            cmd: "panic_command".into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "http://tauri.localhost".parse().unwrap(),
            body: tauri::ipc::InvokeBody::default(),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.to_string(),
        },
    );

    let err = response.expect_err("command should return an error");
    let obj = err.as_object().expect("error payload should be an object");
    assert_eq!(
        obj.get("code").and_then(|v| v.as_str()),
        Some("RUNTIME/PANIC")
    );
    let crash_id = obj
        .get("crash_id")
        .and_then(|v| v.as_str())
        .expect("crash_id present");
    assert!(Uuid::parse_str(crash_id).is_ok(), "invalid crash id");
    let expected = format!("Something went wrong. Crash ID: {crash_id}.");
    assert_eq!(
        obj.get("message").and_then(|v| v.as_str()),
        Some(expected.as_str())
    );

    let logs = String::from_utf8(buf.lock().unwrap().clone()).unwrap();
    assert!(
        logs.contains(&format!("\"event\":\"panic_caught\"")),
        "panic log missing: {logs}"
    );
    assert!(
        logs.contains(&format!("\"crash_id\":\"{crash_id}\"")),
        "crash id missing in logs: {logs}"
    );
}
