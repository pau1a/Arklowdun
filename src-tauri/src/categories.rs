use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{sqlite::SqliteRow, Row};
use tauri::State;
use ts_rs::TS;

use crate::{
    commands, repo, state::AppState, util::dispatch_async_app_result, AppError, AppResult,
};

const HOUSEHOLD_REQUIRED_CODE: &str = "HOUSEHOLD/REQUIRED";
const HOUSEHOLD_MISMATCH_CODE: &str = "HOUSEHOLD/MISMATCH";

fn default_visible() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct Category {
    pub id: String,
    pub household_id: String,
    pub name: String,
    pub slug: String,
    pub color: String,
    #[ts(type = "number")]
    pub position: i64,
    #[ts(type = "number")]
    pub z: i64,
    #[serde(default = "default_visible")]
    pub is_visible: bool,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub deleted_at: Option<i64>,
}

impl Category {
    fn from_row(row: SqliteRow) -> Result<Self, AppError> {
        Self::try_from(&row)
    }
}

impl TryFrom<&SqliteRow> for Category {
    type Error = AppError;

    fn try_from(row: &SqliteRow) -> Result<Self, Self::Error> {
        Ok(Self {
            id: row.try_get("id").map_err(AppError::from)?,
            household_id: row.try_get("household_id").map_err(AppError::from)?,
            name: row.try_get("name").map_err(AppError::from)?,
            slug: row.try_get("slug").map_err(AppError::from)?,
            color: row.try_get("color").map_err(AppError::from)?,
            position: row.try_get("position").map_err(AppError::from)?,
            z: row.try_get("z").map_err(AppError::from)?,
            is_visible: row
                .try_get::<i64, _>("is_visible")
                .map(|value| value != 0)
                .map_err(AppError::from)?,
            created_at: row.try_get("created_at").map_err(AppError::from)?,
            updated_at: row.try_get("updated_at").map_err(AppError::from)?,
            deleted_at: row
                .try_get::<Option<i64>, _>("deleted_at")
                .map_err(AppError::from)?,
        })
    }
}

fn decode_category(value: Value) -> AppResult<Category> {
    match value {
        Value::Object(map) => {
            let get_string = |key: &str| -> AppResult<String> {
                map.get(key)
                    .and_then(Value::as_str)
                    .map(|s| s.to_string())
                    .ok_or_else(|| {
                        AppError::new("CATEGORY/DECODE", "Missing field")
                            .with_context("field", key.to_string())
                    })
            };
            let get_i64 = |key: &str| -> AppResult<i64> {
                map.get(key).and_then(Value::as_i64).ok_or_else(|| {
                    AppError::new("CATEGORY/DECODE", "Missing field")
                        .with_context("field", key.to_string())
                })
            };
            let bool_value = map.get("is_visible").map(|v| match v {
                Value::Bool(flag) => *flag,
                Value::Number(num) => num.as_i64().map(|n| n != 0).unwrap_or(true),
                _ => true,
            });
            Ok(Category {
                id: get_string("id")?,
                household_id: get_string("household_id")?,
                name: get_string("name")?,
                slug: get_string("slug")?,
                color: get_string("color")?,
                position: get_i64("position")?,
                z: get_i64("z")?,
                is_visible: bool_value.unwrap_or(true),
                created_at: get_i64("created_at")?,
                updated_at: get_i64("updated_at")?,
                deleted_at: map.get("deleted_at").and_then(Value::as_i64),
            })
        }
        _ => Err(AppError::new(
            "CATEGORY/DECODE",
            "Expected object payload for category",
        )),
    }
}

fn require_household_field(data: &serde_json::Map<String, Value>) -> AppResult<String> {
    let household_value = data
        .get("household_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            AppError::new(
                HOUSEHOLD_REQUIRED_CODE,
                "household_id is required for categories",
            )
        })?;

    repo::require_household(&household_value).map_err(|_| {
        AppError::new(
            HOUSEHOLD_REQUIRED_CODE,
            "household_id is required for categories",
        )
    })?;

    Ok(household_value)
}

fn ensure_household_match(expected: &str, provided: Option<&Value>) -> AppResult<()> {
    if let Some(value) = provided {
        match value.as_str().map(str::trim) {
            Some(actual) if actual == expected => Ok(()),
            Some(actual) => Err(AppError::new(
                HOUSEHOLD_MISMATCH_CODE,
                "household_id does not match category",
            )
            .with_context("expected", expected.to_string())
            .with_context("received", actual.to_string())),
            _ => Err(AppError::new(
                HOUSEHOLD_MISMATCH_CODE,
                "household_id does not match category",
            )
            .with_context("expected", expected.to_string())),
        }?
    }
    Ok(())
}

async fn list_categories(
    pool: sqlx::SqlitePool,
    household_id: String,
    order_by: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> AppResult<Vec<Category>> {
    let rows = repo::list_active(
        &pool,
        "categories",
        &household_id,
        order_by.as_deref(),
        limit,
        offset,
    )
    .await
    .map_err(|err| {
        AppError::from(err)
            .with_context("operation", "list")
            .with_context("table", "categories".to_string())
            .with_context("household_id", household_id.clone())
    })?;

    rows.into_iter()
        .map(|row| Category::from_row(row).map_err(|err| err.with_context("operation", "list")))
        .collect()
}

async fn get_category(
    pool: sqlx::SqlitePool,
    household_id: Option<String>,
    id: String,
) -> AppResult<Option<Category>> {
    let row = repo::get_active(&pool, "categories", household_id.as_deref(), &id)
        .await
        .map_err(|err| {
            AppError::from(err)
                .with_context("operation", "get")
                .with_context("table", "categories".to_string())
                .with_context("id", id.clone())
        })?;

    row.map(Category::from_row).transpose()
}

#[tauri::command]
pub async fn categories_list(
    state: State<'_, AppState>,
    household_id: String,
    order_by: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> AppResult<Vec<Category>> {
    let pool = state.pool_clone();
    dispatch_async_app_result(move || {
        let household_id = household_id.clone();
        async move { list_categories(pool, household_id, order_by, limit, offset).await }
    })
    .await
}

#[tauri::command]
pub async fn categories_get(
    state: State<'_, AppState>,
    household_id: Option<String>,
    id: String,
) -> AppResult<Option<Category>> {
    let pool = state.pool_clone();
    dispatch_async_app_result(move || {
        let household_id = household_id.clone();
        async move { get_category(pool, household_id, id).await }
    })
    .await
}

#[tauri::command]
pub async fn categories_create(
    state: State<'_, AppState>,
    data: serde_json::Map<String, Value>,
) -> AppResult<Category> {
    let _permit = crate::ipc::guard::ensure_db_writable(&state)?;
    let pool = state.pool_clone();
    dispatch_async_app_result(move || {
        let data = data.clone();
        async move {
            require_household_field(&data)?;
            let created = commands::create_command(&pool, "categories", data).await?;
            decode_category(created)
        }
    })
    .await
}

#[tauri::command]
pub async fn categories_update(
    state: State<'_, AppState>,
    id: String,
    data: serde_json::Map<String, Value>,
    household_id: Option<String>,
) -> AppResult<Category> {
    let _permit = crate::ipc::guard::ensure_db_writable(&state)?;
    let pool = state.pool_clone();
    dispatch_async_app_result(move || {
        let data = data.clone();
        let household_id = household_id.clone();
        let id_clone = id.clone();
        async move {
            let household_id = household_id
                .as_deref()
                .and_then(|value| {
                    let trimmed = value.trim();
                    if trimmed.is_empty() {
                        None
                    } else {
                        Some(trimmed.to_string())
                    }
                })
                .ok_or_else(|| {
                    AppError::new(
                        HOUSEHOLD_REQUIRED_CODE,
                        "household_id is required for category updates",
                    )
                })?;

            repo::require_household(&household_id).map_err(|_| {
                AppError::new(
                    HOUSEHOLD_REQUIRED_CODE,
                    "household_id is required for category updates",
                )
            })?;

            ensure_household_match(&household_id, data.get("household_id"))?;

            commands::update_command(&pool, "categories", &id, data, Some(household_id.as_str()))
                .await?;
            get_category(pool.clone(), Some(household_id.clone()), id_clone)
                .await?
                .ok_or_else(|| {
                    AppError::new("CATEGORY/NOT_FOUND", "Category not found after update")
                })
        }
    })
    .await
}

#[tauri::command]
pub async fn categories_delete(
    state: State<'_, AppState>,
    household_id: String,
    id: String,
) -> AppResult<()> {
    let _permit = crate::ipc::guard::ensure_db_writable(&state)?;
    let pool = state.pool_clone();
    dispatch_async_app_result(move || {
        let household_id = household_id.clone();
        let id = id.clone();
        async move { commands::delete_command(&pool, "categories", &household_id, &id).await }
    })
    .await
}

#[tauri::command]
pub async fn categories_restore(
    state: State<'_, AppState>,
    household_id: String,
    id: String,
) -> AppResult<Category> {
    let _permit = crate::ipc::guard::ensure_db_writable(&state)?;
    let pool = state.pool_clone();
    dispatch_async_app_result(move || {
        let household_id = household_id.clone();
        let id_clone = id.clone();
        async move {
            commands::restore_command(&pool, "categories", &household_id, &id).await?;
            get_category(pool, Some(household_id), id_clone)
                .await?
                .ok_or_else(|| {
                    AppError::new("CATEGORY/NOT_FOUND", "Category not found after restore")
                })
        }
    })
    .await
}
