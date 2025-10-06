use std::path::{Path, PathBuf};

/// Derive the attachments root that corresponds to an application data base.
pub fn attachments_root_for_appdata(base: &Path) -> PathBuf {
    base.join("attachments")
}

/// Derive the attachments root adjacent to the SQLite database path.
pub fn attachments_root_for_database(db_path: &Path) -> PathBuf {
    db_path
        .parent()
        .map(|parent| parent.join("attachments"))
        .unwrap_or_else(|| PathBuf::from("attachments"))
}
