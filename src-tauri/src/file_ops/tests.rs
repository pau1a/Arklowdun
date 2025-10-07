use super::*;
use tempfile::tempdir;

#[test]
fn resolve_conflict_name_advances_suffix() {
    let dir = tempdir().expect("tempdir");
    let base = dir.path().join("report.pdf");
    std::fs::write(&base, b"a").expect("write base");
    std::fs::write(dir.path().join("report (1).pdf"), b"b").expect("write suffix 1");
    std::fs::write(dir.path().join("report (2).pdf"), b"c").expect("write suffix 2");

    let resolved = resolve_conflict_name(&base).expect("resolve conflict");
    assert_eq!(
        resolved.file_name().unwrap().to_string_lossy(),
        "report (3).pdf"
    );
}

#[test]
fn resolve_conflict_name_returns_original_when_free() {
    let dir = tempdir().expect("tempdir");
    let base = dir.path().join("note.txt");
    let resolved = resolve_conflict_name(&base).expect("resolve");
    assert_eq!(resolved, base);
}

#[cfg(target_os = "windows")]
#[test]
fn os_eq_clause_windows_lowercases() {
    assert_eq!(
        os_eq_clause("relative_path", "?1"),
        "LOWER(relative_path) = LOWER(?1)"
    );
}

#[cfg(not(target_os = "windows"))]
#[test]
fn os_eq_clause_unix_matches_exact() {
    assert_eq!(os_eq_clause("relative_path", "?1"), "relative_path = ?1");
}

#[test]
fn csv_escape_quotes_fields() {
    assert_eq!(csv_escape(Some("plain")), "plain");
    assert_eq!(csv_escape(Some("with,comma")), "\"with,comma\"");
    assert_eq!(csv_escape(Some("with\"quote")), "\"with""quote\"");
}
