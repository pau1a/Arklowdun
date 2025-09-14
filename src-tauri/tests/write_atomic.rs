use arklowdun_lib::db::write_atomic;
use std::fs;
use tempfile::tempdir;

#[test]
fn commit_writes_file() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("file.txt");
    write_atomic(&path, b"hello").unwrap();
    assert_eq!(fs::read(&path).unwrap(), b"hello");
}

#[test]
fn overwrite_is_atomic() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("file.txt");
    fs::write(&path, b"old").unwrap();
    write_atomic(&path, b"new").unwrap();
    assert_eq!(fs::read(&path).unwrap(), b"new");
}

#[test]
fn failure_leaves_original() {
    let dir = tempdir().unwrap();
    let existing = dir.path().join("orig.txt");
    fs::write(&existing, b"old").unwrap();
    let bad_path = dir.path().join("missing").join("file.txt");
    assert!(write_atomic(&bad_path, b"data").is_err());
    assert_eq!(fs::read(&existing).unwrap(), b"old");
    assert!(!bad_path.parent().unwrap().exists());
}

#[cfg(target_os = "windows")]
#[test]
fn overwrite_uses_replacefilew() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("file.txt");
    fs::write(&path, b"old").unwrap();
    write_atomic(&path, b"new").unwrap();
    assert_eq!(fs::read(&path).unwrap(), b"new");
}
