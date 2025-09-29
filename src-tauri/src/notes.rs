use serde_json::{Map, Value};
use tauri::State;

use crate::{
    commands,
    ipc::guard,
    repo::{self, notes::list_with_categories},
    state::AppState,
    util::dispatch_async_app_result,
    AppError, AppResult,
};

#[tauri::command]
pub async fn notes_list(
    state: State<'_, AppState>,
    household_id: String,
    order_by: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
    category_ids: Option<Vec<String>>,
) -> AppResult<Vec<Value>> {
    let pool = state.pool_clone();
    dispatch_async_app_result(move || {
        let household_id = household_id.clone();
        async move {
            let (category_filter, should_short_circuit) = match category_ids {
                Some(ids) if ids.is_empty() => (Vec::new(), true),
                Some(ids) => (ids, false),
                None => (Vec::new(), false),
            };

            if should_short_circuit {
                return Ok(Vec::new());
            }

            let rows = list_with_categories(
                &pool,
                &household_id,
                order_by.as_deref(),
                limit,
                offset,
                if category_filter.is_empty() {
                    None
                } else {
                    Some(category_filter)
                },
            )
            .await
            .map_err(|err| {
                AppError::from(err)
                    .with_context("operation", "list")
                    .with_context("table", "notes".to_string())
                    .with_context("household_id", household_id.clone())
            })?;

            Ok(rows.into_iter().map(repo::row_to_json).collect())
        }
    })
    .await
}

#[tauri::command]
pub async fn notes_get(
    state: State<'_, AppState>,
    household_id: Option<String>,
    id: String,
) -> AppResult<Option<Value>> {
    let pool = state.pool_clone();
    dispatch_async_app_result(move || {
        let household_id = household_id.clone();
        let id = id.clone();
        async move { commands::get_command(&pool, "notes", household_id.as_deref(), &id).await }
    })
    .await
}

#[tauri::command]
pub async fn notes_create(
    state: State<'_, AppState>,
    data: Map<String, Value>,
) -> AppResult<Value> {
    let _permit = guard::ensure_db_writable(&state)?;
    let pool = state.pool_clone();
    dispatch_async_app_result(move || {
        let data = data.clone();
        async move { commands::create_command(&pool, "notes", data).await }
    })
    .await
}

#[tauri::command]
pub async fn notes_update(
    state: State<'_, AppState>,
    id: String,
    data: Map<String, Value>,
    household_id: Option<String>,
) -> AppResult<()> {
    let _permit = guard::ensure_db_writable(&state)?;
    let pool = state.pool_clone();
    dispatch_async_app_result(move || {
        let household_id = household_id.clone();
        let id = id.clone();
        let data = data.clone();
        async move {
            commands::update_command(&pool, "notes", &id, data, household_id.as_deref()).await
        }
    })
    .await
}

#[tauri::command]
pub async fn notes_delete(
    state: State<'_, AppState>,
    household_id: String,
    id: String,
) -> AppResult<()> {
    let _permit = guard::ensure_db_writable(&state)?;
    let pool = state.pool_clone();
    dispatch_async_app_result(move || {
        let household_id = household_id.clone();
        let id = id.clone();
        async move { commands::delete_command(&pool, "notes", &household_id, &id).await }
    })
    .await
}

#[tauri::command]
pub async fn notes_restore(
    state: State<'_, AppState>,
    household_id: String,
    id: String,
) -> AppResult<()> {
    let _permit = guard::ensure_db_writable(&state)?;
    let pool = state.pool_clone();
    dispatch_async_app_result(move || {
        let household_id = household_id.clone();
        let id = id.clone();
        async move { commands::restore_command(&pool, "notes", &household_id, &id).await }
    })
    .await
}
