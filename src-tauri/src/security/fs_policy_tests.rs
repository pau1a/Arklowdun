use super::fs_policy::{canonicalize_and_verify, reject_symlinks, FsPolicyError, RootKey};
use tauri::Manager;
use tempfile::tempdir;

fn setup() -> (
    tauri::AppHandle<tauri::test::MockRuntime>,
    tempfile::TempDir,
) {
    let app = tauri::test::mock_app();
    let handle = app.app_handle();
    // Ensure attachments dir exists under the mock app_data_dir
    let base = handle.path().app_data_dir().unwrap();
    std::fs::create_dir_all(base.join("attachments")).unwrap();
    // Keep a tempdir alive for parity with previous signature; unused
    let dir = tempdir().unwrap();
    (handle.clone(), dir)
}

#[test]
fn reject_dotdot() {
    let (handle, _tmp) = setup();
    let err =
        canonicalize_and_verify("../../etc/passwd", RootKey::Attachments, &handle).unwrap_err();
    assert!(matches!(err, FsPolicyError::DotDotRejected));
}

#[cfg(target_os = "windows")]
#[test]
fn reject_unc() {
    let (handle, _tmp) = setup();
    let err = canonicalize_and_verify("\\\\server\\share\\foo", RootKey::Attachments, &handle)
        .unwrap_err();
    assert!(matches!(err, FsPolicyError::UncRejected));
}

#[cfg(target_os = "windows")]
#[test]
fn reject_cross_volume() {
    std::env::set_var("ARK_FAKE_APPDATA", "C:\\base");
    let app = tauri::test::mock_app();
    let handle = app.app_handle();
    let err = canonicalize_and_verify("D:\\foo", RootKey::AppData, &handle).unwrap_err();
    assert!(matches!(err, FsPolicyError::CrossVolume));
}

#[test]
fn allow_absolute_inside() {
    let (handle, _tmp) = setup();
    let abs = handle
        .path()
        .app_data_dir()
        .unwrap()
        .join("attachments")
        .join("img.png");
    let res =
        canonicalize_and_verify(abs.to_str().unwrap(), RootKey::Attachments, &handle).unwrap();
    assert_eq!(res.real_path, abs);
}

#[test]
fn allow_relative_inside() {
    let (handle, _tmp) = setup();
    let res = canonicalize_and_verify("file.txt", RootKey::Attachments, &handle).unwrap();
    let expected = handle
        .path()
        .app_data_dir()
        .unwrap()
        .join("attachments")
        .join("file.txt");
    assert_eq!(res.real_path, expected);
}

#[cfg(unix)]
#[test]
fn reject_symlink_segment() {
    use std::os::unix::fs::symlink;
    let (handle, _tmp) = setup();
    let base = handle.path().app_data_dir().unwrap();
    let outside = base.join("outside");
    std::fs::create_dir_all(&outside).unwrap();
    // Create a unique symlink name to avoid collisions across parallel runs
    let unique = format!(
        "link-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );
    let link = base.join("attachments").join(&unique);
    if link.exists() {
        let _ = std::fs::remove_file(&link);
    }
    symlink(&outside, &link).unwrap();
    let rel = format!("{}/file.txt", unique);
    let res = canonicalize_and_verify(&rel, RootKey::Attachments, &handle).unwrap();
    let err = reject_symlinks(&res.real_path).unwrap_err();
    assert!(matches!(err, FsPolicyError::Symlink));
}

#[test]
fn reject_outside_root() {
    let (handle, _tmp) = setup();
    let base = handle.path().app_data_dir().unwrap();
    let outside = base.parent().unwrap().join("evil.txt");
    let err = canonicalize_and_verify(outside.to_str().unwrap(), RootKey::Attachments, &handle)
        .unwrap_err();
    assert!(matches!(err, FsPolicyError::OutsideRoot));
}
