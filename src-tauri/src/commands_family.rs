use tauri::State;

use serde_json::json;

use crate::{
    family_logging::LogScope,
    ipc::guard,
    model_family::{
        AttachmentAddPayload, AttachmentImportPathsPayload, AttachmentRemovePayload,
        AttachmentsListRequest, RenewalDeletePayload, RenewalInput, RenewalUpsertPayload,
        RenewalsListRequest,
    },
    repo_family,
    state::AppState,
    util::dispatch_async_app_result,
    AppResult,
};

#[tauri::command]
pub async fn member_attachments_list(
    state: State<'_, AppState>,
    request: AttachmentsListRequest,
) -> AppResult<Vec<repo_family::AttachmentRef>> {
    let scope = LogScope::new(
        "member_attachments_list",
        None,
        Some(request.member_id.clone()),
    );
    let pool = state.pool_clone();
    let request_clone = AttachmentsListRequest {
        member_id: request.member_id.clone(),
    };

    let result = dispatch_async_app_result(move || {
        let pool = pool.clone();
        let request = request_clone.clone();
        async move { repo_family::attachments_list(&pool, &request).await }
    })
    .await;

    match result {
        Ok(records) => {
            scope.success(
                Some(&request.member_id),
                json!({ "rows": records.len(), "message": "attachments listed" }),
            );
            Ok(records)
        }
        Err(err) => {
            scope.fail(&err);
            Err(err)
        }
    }
}

#[tauri::command]
pub async fn member_attachments_add(
    state: State<'_, AppState>,
    payload: AttachmentAddPayload,
) -> AppResult<repo_family::AttachmentRef> {
    let scope = LogScope::new(
        "member_attachments_add",
        Some(payload.household_id.clone()),
        Some(payload.member_id.clone()),
    );
    let permit = match guard::ensure_db_writable(&state) {
        Ok(permit) => permit,
        Err(err) => {
            scope.fail(&err);
            return Err(err);
        }
    };

    let pool = state.pool_clone();
    let vault = state.vault();
    let payload_clone = AttachmentAddPayload {
        household_id: payload.household_id.clone(),
        member_id: payload.member_id.clone(),
        root_key: payload.root_key.clone(),
        relative_path: payload.relative_path.clone(),
        title: payload.title.clone(),
        mime_hint: payload.mime_hint.clone(),
    };

    let result = dispatch_async_app_result(move || {
        let pool = pool.clone();
        let vault = vault.clone();
        let payload = payload_clone.clone();
        async move { repo_family::attachments_add(&pool, &vault, payload).await }
    })
    .await;
    drop(permit);

    match result {
        Ok(record) => {
            scope.success(
                Some(&payload.member_id),
                json!({
                    "rows": 1,
                    "attachment_id": record.id.to_string(),
                    "message": "attachment added",
                }),
            );
            Ok(record)
        }
        Err(err) => {
            scope.fail(&err);
            Err(err)
        }
    }
}

#[tauri::command]
pub async fn member_attachments_remove(
    state: State<'_, AppState>,
    payload: AttachmentRemovePayload,
) -> AppResult<()> {
    let scope = LogScope::new("member_attachments_remove", None, None);
    let permit = match guard::ensure_db_writable(&state) {
        Ok(permit) => permit,
        Err(err) => {
            scope.fail(&err);
            return Err(err);
        }
    };

    let pool = state.pool_clone();
    let payload_clone = AttachmentRemovePayload {
        id: payload.id.clone(),
    };

    let result = dispatch_async_app_result(move || {
        let pool = pool.clone();
        let payload = payload_clone.clone();
        async move { repo_family::attachments_remove(&pool, payload).await }
    })
    .await;
    drop(permit);

    match result {
        Ok(()) => {
            scope.success(
                None,
                json!({
                    "rows": 0,
                    "attachment_id": payload.id,
                    "message": "attachment removed",
                }),
            );
            Ok(())
        }
        Err(err) => {
            scope.fail(&err);
            Err(err)
        }
    }
}

#[tauri::command]
pub async fn member_attachments_import_paths(
    state: State<'_, AppState>,
    payload: AttachmentImportPathsPayload,
) -> AppResult<Vec<repo_family::AttachmentRef>> {
    let scope = LogScope::new(
        "member_attachments_import_paths",
        Some(payload.household_id.clone()),
        Some(payload.member_id.clone()),
    );
    let permit = match guard::ensure_db_writable(&state) {
        Ok(permit) => permit,
        Err(err) => {
            scope.fail(&err);
            return Err(err);
        }
    };

    let pool = state.pool_clone();
    let vault = state.vault();
    let payload_clone = payload.clone();

    let result = dispatch_async_app_result(move || {
        let pool = pool.clone();
        let vault = vault.clone();
        let payload = payload_clone.clone();
        async move { repo_family::attachments_import_paths(&pool, &vault, payload).await }
    })
    .await;
    drop(permit);

    match result {
        Ok(records) => {
            scope.success(
                Some(&payload.member_id),
                serde_json::json!({
                    "rows": records.len(),
                    "message": "attachments imported",
                }),
            );
            Ok(records)
        }
        Err(err) => {
            scope.fail(&err);
            Err(err)
        }
    }
}

#[tauri::command]
pub async fn member_renewals_list(
    state: State<'_, AppState>,
    request: RenewalsListRequest,
) -> AppResult<Vec<repo_family::Renewal>> {
    let scope = LogScope::new(
        "member_renewals_list",
        Some(request.household_id.clone()),
        Some(request.member_id.clone()),
    );
    let pool = state.pool_clone();
    let request_clone = request.clone();
    let household_id = request.household_id.clone();
    let member_id = request.member_id.clone();

    let result = dispatch_async_app_result(move || {
        let pool = pool.clone();
        let request = request_clone.clone();
        async move { repo_family::renewals_list(&pool, &request).await }
    })
    .await;

    match result {
        Ok(records) => {
            scope.success_with_ids(
                Some(&household_id),
                Some(&member_id),
                json!({
                    "rows": records.len(),
                    "message": "renewals listed",
                }),
            );
            Ok(records)
        }
        Err(err) => {
            scope.fail(&err);
            Err(err)
        }
    }
}

#[tauri::command]
pub async fn member_renewals_upsert(
    state: State<'_, AppState>,
    payload: RenewalUpsertPayload,
) -> AppResult<repo_family::Renewal> {
    let scope = LogScope::new(
        "member_renewals_upsert",
        Some(payload.household_id.clone()),
        Some(payload.member_id.clone()),
    );
    let permit = match guard::ensure_db_writable(&state) {
        Ok(permit) => permit,
        Err(err) => {
            scope.fail(&err);
            return Err(err);
        }
    };

    let pool = state.pool_clone();
    let input = RenewalInput {
        id: payload.id,
        household_id: payload.household_id.clone(),
        member_id: payload.member_id.clone(),
        kind: payload.kind.clone(),
        label: payload.label.clone(),
        expires_at: payload.expires_at,
        remind_on_expiry: payload.remind_on_expiry,
        remind_offset_days: payload.remind_offset_days,
        updated_at: 0,
    };

    let result = dispatch_async_app_result(move || {
        let pool = pool.clone();
        let input = input.clone();
        async move { repo_family::renewals_upsert(&pool, input).await }
    })
    .await;
    drop(permit);

    match result {
        Ok(record) => {
            scope.success(
                Some(&payload.member_id),
                json!({
                    "rows": 1,
                    "renewal_id": record.id.to_string(),
                    "message": "renewal saved",
                }),
            );
            Ok(record)
        }
        Err(err) => {
            scope.fail(&err);
            Err(err)
        }
    }
}

#[tauri::command]
pub async fn member_renewals_delete(
    state: State<'_, AppState>,
    payload: RenewalDeletePayload,
) -> AppResult<()> {
    let scope = LogScope::new(
        "member_renewals_delete",
        Some(payload.household_id.clone()),
        None,
    );
    let permit = match guard::ensure_db_writable(&state) {
        Ok(permit) => permit,
        Err(err) => {
            scope.fail(&err);
            return Err(err);
        }
    };

    let pool = state.pool_clone();
    let payload_clone = RenewalDeletePayload {
        id: payload.id.clone(),
        household_id: payload.household_id.clone(),
    };

    let result = dispatch_async_app_result(move || {
        let pool = pool.clone();
        let payload = payload_clone.clone();
        async move { repo_family::renewals_delete(&pool, payload).await }
    })
    .await;
    drop(permit);

    match result {
        Ok(()) => {
            scope.success(
                None,
                json!({
                    "rows": 0,
                    "renewal_id": payload.id,
                    "household_id": payload.household_id,
                    "message": "renewal deleted",
                }),
            );
            Ok(())
        }
        Err(err) => {
            scope.fail(&err);
            Err(err)
        }
    }
}
