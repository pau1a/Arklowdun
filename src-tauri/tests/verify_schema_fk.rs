#![allow(clippy::expect_used)]

use std::process::Command;
use assert_cmd::prelude::*; // for Command::cargo_bin
use tempfile::tempdir;

// Prefer Cargo-managed binary lookup; this builds/locates the target reliably
fn bin_cmd(name: &str) -> Command {
    Command::cargo_bin(name).expect("cargo_bin lookup")
}

fn tmpdb() -> std::path::PathBuf {
    let dir = tempdir().expect("tempdir");
    // keep dir alive by leaking; tests are short-lived
    let path = dir.path().join("test.sqlite");
    let _ = Box::leak(Box::new(dir));
    path
}

#[test]
fn fk_audit_fails_before_0020() {
    let db = tmpdb();

    // migrate up to 0019
    let status = bin_cmd("migrate")
        .args(["--db", db.to_str().unwrap(), "up", "--to", "0019"])
        .status()
        .expect("spawn migrate up to 0019");
    assert!(status.success(), "migrate up to 0019 failed");

    // run verify_schema --strict-fk (should fail and print missing FKs)
    let out = bin_cmd("verify_schema")
        .args(["--db", db.to_str().unwrap(), "--strict-fk"])
        .output()
        .expect("spawn verify_schema");

    assert!(
        !out.status.success(),
        "verify_schema should fail pre-0020; stdout: {} stderr: {}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let s = String::from_utf8_lossy(&out.stdout);
    assert!(s.contains("files_index") && s.contains("household_id"));
    assert!(s.contains("files_index_meta") && s.contains("household_id"));
}

#[test]
fn fk_audit_passes_after_0020() {
    let db = tmpdb();

    // migrate all (through 0020)
    let status = bin_cmd("migrate")
        .args(["--db", db.to_str().unwrap(), "up"])
        .status()
        .expect("spawn migrate up");
    assert!(status.success(), "migrate up failed");

    // verify strict-fk should succeed (and print [] or nothing)
    let out = bin_cmd("verify_schema")
        .args(["--db", db.to_str().unwrap(), "--strict-fk"])
        .output()
        .expect("spawn verify_schema");
    assert!(
        out.status.success(),
        "verify_schema should pass after 0020; stdout: {} stderr: {}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
}
