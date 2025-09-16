use anyhow::Context;

/// Initialize logging similarly to the main app, including the file sink.
///
/// This sets up the tracing subscriber and wires the file sink to the
/// same location the app uses. When `ARK_FAKE_APPDATA` is set (in tests),
/// logs are written under that directory's `logs/` subfolder.
pub fn init() -> anyhow::Result<()> {
    // Install subscriber (stdout + file layer via RotatingFileWriter).
    crate::init_logging();

    // Wire the file sink for non-Tauri contexts.
    // Use the exact same identifier the Tauri app uses (see tauri.conf.json5).
    let _ = crate::init_file_logging_standalone("com.paula.arklowdun")
        .context("initialize file logging for standalone binary")?;

    Ok(())
}
