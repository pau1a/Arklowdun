// dev-only smoke check; no UI, no side effects outside tmp
use std::fs;
use tauri::Manager;

fn main() -> anyhow::Result<()> {
    // Arrange a fake appdata under tmp and ensure attachments exists.
    let tmp = std::env::temp_dir().join("ark_smoke");
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(tmp.join("attachments"))?;
    std::env::set_var("ARK_FAKE_APPDATA", &tmp);

    // Mock app handle (no real window/process).
    let app = tauri::test::mock_app();
    let handle = app.handle();

    // 1) Deny traversal: ".." must be rejected.
    {
        use arklowdun_lib::security::fs_policy as fs;
        let err = fs::canonicalize_and_verify("..", fs::RootKey::AppData, &handle).unwrap_err();
        let reason = err.name();
        let ui: arklowdun_lib::security::error_map::UiError = err.into();
        arklowdun_lib::log_fs_deny(fs::RootKey::AppData, &ui, reason);
        assert_eq!(ui.code, "NOT_ALLOWED");
    }

    // 2) Allow in-root relative path under Attachments.
    {
        use arklowdun_lib::security::fs_policy as policy;
        let ok = policy::canonicalize_and_verify("file.txt", policy::RootKey::Attachments, &handle)?;
        // No symlink in segments, so reject_symlinks should be OK.
        policy::reject_symlinks(&ok.real_path)?;
    }

    // 3) Deny symlink segment.
    #[cfg(unix)]
    {
        use arklowdun_lib::security::fs_policy as policy;
        use std::os::unix::fs as unixfs;

        let outside = tmp.join("outside");
        std::fs::create_dir_all(&outside)?;
        let link = tmp.join("attachments").join("link");
        // If re-run, allow AlreadyExists.
        let _ = std::fs::remove_file(&link);
        unixfs::symlink(&outside, &link)?;
        let ok = policy::canonicalize_and_verify("link/evil.txt", policy::RootKey::Attachments, &handle)?;
        let err = policy::reject_symlinks(&ok.real_path).unwrap_err();
        let reason = err.name();
        let ui: arklowdun_lib::security::error_map::UiError = err.into();
        arklowdun_lib::log_fs_deny(policy::RootKey::Attachments, &ui, reason);
        assert_eq!(ui.code, "NOT_ALLOWED");
    }

    println!("SECURITY_SMOKE_OK");
    Ok(())
}
