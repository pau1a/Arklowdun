use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use anyhow::Context;
use sqlx::SqlitePool;
use thiserror::Error;
use tracing::{info, warn};

use crate::household::{self, HouseholdGuardError};

pub const ACTIVE_HOUSEHOLD_KEY: &str = "activeHouseholdId";

trait ActiveStore: Send + Sync {
    fn get(&self, key: &str) -> Option<String>;
    fn set(&self, key: &str, value: &str);
    fn save(&self) -> anyhow::Result<()>;
}

struct TauriStore {
    inner: Arc<tauri_plugin_store::Store<tauri::Wry>>,
}

impl ActiveStore for TauriStore {
    fn get(&self, key: &str) -> Option<String> {
        self.inner
            .get(key)
            .and_then(|value| value.as_str().map(str::to_owned))
    }

    fn set(&self, key: &str, value: &str) {
        self.inner.set(key, value);
    }

    fn save(&self) -> anyhow::Result<()> {
        self.inner.save().map_err(|err| anyhow::Error::from(err))
    }
}

#[derive(Default)]
struct MemoryStore {
    data: Mutex<HashMap<String, String>>,
}

impl ActiveStore for MemoryStore {
    fn get(&self, key: &str) -> Option<String> {
        self.data
            .lock()
            .map(|guard| guard.get(key).cloned())
            .unwrap_or_default()
    }

    fn set(&self, key: &str, value: &str) {
        if let Ok(mut guard) = self.data.lock() {
            guard.insert(key.to_string(), value.to_string());
        }
    }

    fn save(&self) -> anyhow::Result<()> {
        Ok(())
    }
}

#[derive(Clone)]
pub struct StoreHandle {
    inner: Arc<dyn ActiveStore + Send + Sync>,
}

impl StoreHandle {
    pub fn tauri(store: Arc<tauri_plugin_store::Store<tauri::Wry>>) -> Self {
        Self {
            inner: Arc::new(TauriStore { inner: store }),
        }
    }

    pub fn in_memory() -> Self {
        Self {
            inner: Arc::new(MemoryStore::default()),
        }
    }

    fn read_active(&self) -> Option<String> {
        self.inner.get(ACTIVE_HOUSEHOLD_KEY)
    }

    fn write_active(&self, id: &str) {
        self.inner.set(ACTIVE_HOUSEHOLD_KEY, id);
    }

    fn persist(&self) -> anyhow::Result<()> {
        self.inner.save()
    }

    pub fn snapshot(&self) -> Option<String> {
        self.read_active()
    }
}

#[derive(Error, Debug)]
pub enum ActiveSetError {
    #[error("household not found")]
    NotFound,
    #[error("household is soft-deleted")]
    Deleted,
}

pub async fn get_active_household_id(
    pool: &SqlitePool,
    store: &StoreHandle,
) -> anyhow::Result<String> {
    let mut fallback_reason: Option<&'static str> = None;

    if let Some(candidate) = store.read_active() {
        match household::assert_household_active(pool, &candidate).await {
            Ok(()) => return Ok(candidate),
            Err(HouseholdGuardError::Deleted) => fallback_reason = Some("deleted"),
            Err(HouseholdGuardError::NotFound) => fallback_reason = Some("not_found"),
        }
    } else {
        fallback_reason = Some("missing");
    }

    let reason = fallback_reason.unwrap_or("missing");
    let fallback = household::default_household_id(pool).await?;
    store.write_active(&fallback);
    store
        .persist()
        .context("persist active household selection")?;
    info!(
        target: "arklowdun",
        event = "active_household_fallback",
        reason,
        chosen_id = %fallback
    );
    Ok(fallback)
}

pub async fn set_active_household_id(
    pool: &SqlitePool,
    store: &StoreHandle,
    id: &str,
) -> Result<(), ActiveSetError> {
    match household::assert_household_active(pool, id).await {
        Ok(()) => {
            store.write_active(id);
            if let Err(err) = store.persist() {
                warn!(
                    target: "arklowdun",
                    event = "active_household_store_save_failed",
                    error = %err
                );
            }
            Ok(())
        }
        Err(HouseholdGuardError::Deleted) => {
            warn!(
                target: "arklowdun",
                event = "active_household_set_rejected",
                reason = "deleted",
                id = %id
            );
            Err(ActiveSetError::Deleted)
        }
        Err(HouseholdGuardError::NotFound) => {
            warn!(
                target: "arklowdun",
                event = "active_household_set_rejected",
                reason = "not_found",
                id = %id
            );
            Err(ActiveSetError::NotFound)
        }
    }
}
