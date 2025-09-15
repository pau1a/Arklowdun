use super::fs_policy::{canonicalize_and_verify, reject_symlinks, FsPolicyError, RootKey};
use tempfile::tempdir;

fn setup() -> (tauri::AppHandle, tempfile::TempDir) {
    let dir = tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join("attachments")).unwrap();
    std::env::set_var("ARK_FAKE_APPDATA", dir.path().to_string_lossy().to_string());
    let app = tauri::test::mock_app();
    (app.app_handle(), dir)
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
    let (handle, tmp) = setup();
    let abs = tmp.path().join("attachments").join("img.png");
    let res =
        canonicalize_and_verify(abs.to_str().unwrap(), RootKey::Attachments, &handle).unwrap();
    assert_eq!(res.real_path, abs);
}

#[test]
fn allow_relative_inside() {
    let (handle, tmp) = setup();
    let res = canonicalize_and_verify("file.txt", RootKey::Attachments, &handle).unwrap();
    let expected = tmp.path().join("attachments").join("file.txt");
    assert_eq!(res.real_path, expected);
}

#[cfg(unix)]
#[test]
fn reject_symlink_segment() {
    use std::os::unix::fs::symlink;
    let (handle, tmp) = setup();
    let outside = tmp.path().join("outside");
    std::fs::create_dir_all(&outside).unwrap();
    let link = tmp.path().join("attachments").join("link");
    symlink(&outside, &link).unwrap();
    let res = canonicalize_and_verify("link/file.txt", RootKey::Attachments, &handle).unwrap();
    let err = reject_symlinks(&res.real_path).unwrap_err();
    assert!(matches!(err, FsPolicyError::Symlink));
}

#[test]
fn reject_outside_root() {
    let (handle, tmp) = setup();
    let outside = tmp.path().join("evil.txt");
    let err = canonicalize_and_verify(outside.to_str().unwrap(), RootKey::Attachments, &handle)
        .unwrap_err();
    assert!(matches!(err, FsPolicyError::OutsideRoot));
}
