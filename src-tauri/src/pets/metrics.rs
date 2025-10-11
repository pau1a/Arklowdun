use serde::Serialize;
use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Hash)]
pub struct MissingAttachmentSnapshot {
    pub household_id: String,
    pub category: String,
    pub relative_path: String,
}

#[derive(Default)]
pub struct PetAttachmentMetrics {
    missing: Mutex<HashSet<MissingAttachmentSnapshot>>,
    thumbnails_built: AtomicU64,
    thumbnails_cache_hits: AtomicU64,
}

impl PetAttachmentMetrics {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record_probe(
        &self,
        household_id: &str,
        category: &str,
        relative_path: &str,
        exists: bool,
    ) {
        let snapshot = MissingAttachmentSnapshot {
            household_id: household_id.to_string(),
            category: category.to_string(),
            relative_path: relative_path.to_string(),
        };
        let mut guard = match self.missing.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        if exists {
            guard.remove(&snapshot);
        } else {
            guard.insert(snapshot);
        }
    }

    pub fn missing_snapshot(&self) -> Vec<MissingAttachmentSnapshot> {
        let guard = match self.missing.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        guard.iter().cloned().collect()
    }

    pub fn missing_count(&self) -> u64 {
        let guard = match self.missing.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        guard.len() as u64
    }

    pub fn record_thumbnail_built(&self) {
        self.thumbnails_built.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_thumbnail_cache_hit(&self) {
        self.thumbnails_cache_hits.fetch_add(1, Ordering::Relaxed);
    }

    pub fn thumbnails_built(&self) -> u64 {
        self.thumbnails_built.load(Ordering::Relaxed)
    }

    pub fn thumbnails_cache_hits(&self) -> u64 {
        self.thumbnails_cache_hits.load(Ordering::Relaxed)
    }
}
