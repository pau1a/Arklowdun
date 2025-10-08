use std::time::Instant;

use tauri::State;

use crate::{
    ipc::guard,
    model_family::{
        AttachmentAddPayload, AttachmentRemovePayload, AttachmentsListRequest,
        RenewalDeletePayload, RenewalInput, RenewalUpsertPayload, RenewalsListRequest,
    },
    repo_family,
    state::AppState,
    util::dispatch_async_app_result,
    AppError, AppResult,
};

fn log_command_start(cmd: &'static str, household_id: Option<&str>, member_id: Option<&str>) {
    tracing::debug!(
        target: "arklowdun",
        area = "family",
        cmd,
        household_id,
        member_id,
        "ipc_enter"
    );
}

fn log_command_success(
    cmd: &'static str,
    start: Instant,
    household_id: Option<&str>,
    member_id: Option<&str>,
    row_count: usize,
) {
    tracing::info!(
        target: "arklowdun",
        area = "family",
        cmd,
        household_id,
        member_id,
        elapsed_ms = start.elapsed().as_millis() as u64,
        row_count,
        "ipc_success"
    );
}

fn log_command_error(
    cmd: &'static str,
    start: Instant,
    err: &AppError,
    household_id: Option<&str>,
    member_id: Option<&str>,
) {
    let level = if is_validation_error(err.code()) {
        tracing::Level::WARN
    } else {
        tracing::Level::ERROR
    };

    tracing::event!(
        target: "arklowdun",
        level,
        area = "family",
        cmd,
        household_id,
        member_id,
        code = err.code(),
        message = err.message(),
        elapsed_ms = start.elapsed().as_millis() as u64,
        "ipc_failure"
    );
}

fn is_validation_error(code: &str) -> bool {
    code.starts_with("ATTACHMENTS/")
        || code.starts_with("RENEWALS/")
        || code.starts_with("VALIDATION/")
}

#[tauri::command]
pub async fn member_attachments_list(
    state: State<'_, AppState>,
    request: AttachmentsListRequest,
) -> AppResult<Vec<repo_family::AttachmentRef>> {
    log_command_start("member_attachments_list", None, Some(&request.member_id));
    let pool = state.pool_clone();
    let request_clone = AttachmentsListRequest {
        member_id: request.member_id.clone(),
    };
    let start = Instant::now();

    let result = dispatch_async_app_result(move || {
        let pool = pool.clone();
        let request = request_clone.clone();
        async move { repo_family::attachments_list(&pool, &request).await }
    })
    .await;

    match result {
        Ok(records) => {
            log_command_success(
                "member_attachments_list",
                start,
                None,
                Some(&request.member_id),
                records.len(),
            );
            Ok(records)
        }
        Err(err) => {
            log_command_error(
                "member_attachments_list",
                start,
                &err,
                None,
                Some(&request.member_id),
            );
            Err(err)
        }
    }
}

#[tauri::command]
pub async fn member_attachments_add(
    state: State<'_, AppState>,
    payload: AttachmentAddPayload,
) -> AppResult<repo_family::AttachmentRef> {
    log_command_start(
        "member_attachments_add",
        Some(&payload.household_id),
        Some(&payload.member_id),
    );
    let start = Instant::now();
    let permit = match guard::ensure_db_writable(&state) {
        Ok(permit) => permit,
        Err(err) => {
            log_command_error(
                "member_attachments_add",
                start,
                &err,
                Some(&payload.household_id),
                Some(&payload.member_id),
            );
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
            log_command_success(
                "member_attachments_add",
                start,
                Some(&payload.household_id),
                Some(&payload.member_id),
                1,
            );
            Ok(record)
        }
        Err(err) => {
            log_command_error(
                "member_attachments_add",
                start,
                &err,
                Some(&payload.household_id),
                Some(&payload.member_id),
            );
            Err(err)
        }
    }
}

#[tauri::command]
pub async fn member_attachments_remove(
    state: State<'_, AppState>,
    payload: AttachmentRemovePayload,
) -> AppResult<()> {
    log_command_start("member_attachments_remove", None, None);
    let start = Instant::now();
    let permit = match guard::ensure_db_writable(&state) {
        Ok(permit) => permit,
        Err(err) => {
            log_command_error("member_attachments_remove", start, &err, None, None);
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
            log_command_success("member_attachments_remove", start, None, None, 0);
            Ok(())
        }
        Err(err) => {
            log_command_error("member_attachments_remove", start, &err, None, None);
            Err(err)
        }
    }
}

#[tauri::command]
pub async fn member_renewals_list(
    state: State<'_, AppState>,
    request: RenewalsListRequest,
) -> AppResult<Vec<repo_family::Renewal>> {
    let household = request.household_id.as_deref();
    let member = request.member_id.as_deref();
    log_command_start("member_renewals_list", household, member);
    let start = Instant::now();
    let pool = state.pool_clone();
    let request_clone = RenewalsListRequest {
        member_id: request.member_id.clone(),
        household_id: request.household_id.clone(),
    };

    let result = dispatch_async_app_result(move || {
        let pool = pool.clone();
        let request = request_clone.clone();
        async move { repo_family::renewals_list(&pool, &request).await }
    })
    .await;

    match result {
        Ok(records) => {
            log_command_success(
                "member_renewals_list",
                start,
                household,
                member,
                records.len(),
            );
            Ok(records)
        }
        Err(err) => {
            log_command_error("member_renewals_list", start, &err, household, member);
            Err(err)
        }
    }
}

#[tauri::command]
pub async fn member_renewals_upsert(
    state: State<'_, AppState>,
    payload: RenewalUpsertPayload,
) -> AppResult<repo_family::Renewal> {
    log_command_start(
        "member_renewals_upsert",
        Some(&payload.household_id),
        Some(&payload.member_id),
    );
    let start = Instant::now();
    let permit = match guard::ensure_db_writable(&state) {
        Ok(permit) => permit,
        Err(err) => {
            log_command_error(
                "member_renewals_upsert",
                start,
                &err,
                Some(&payload.household_id),
                Some(&payload.member_id),
            );
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
            log_command_success(
                "member_renewals_upsert",
                start,
                Some(&payload.household_id),
                Some(&payload.member_id),
                1,
            );
            Ok(record)
        }
        Err(err) => {
            log_command_error(
                "member_renewals_upsert",
                start,
                &err,
                Some(&payload.household_id),
                Some(&payload.member_id),
            );
            Err(err)
        }
    }
}

#[tauri::command]
pub async fn member_renewals_delete(
    state: State<'_, AppState>,
    payload: RenewalDeletePayload,
) -> AppResult<()> {
    log_command_start("member_renewals_delete", None, None);
    let start = Instant::now();
    let permit = match guard::ensure_db_writable(&state) {
        Ok(permit) => permit,
        Err(err) => {
            log_command_error("member_renewals_delete", start, &err, None, None);
            return Err(err);
        }
    };

    let pool = state.pool_clone();
    let payload_clone = RenewalDeletePayload {
        id: payload.id.clone(),
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
            log_command_success("member_renewals_delete", start, None, None, 0);
            Ok(())
        }
        Err(err) => {
            log_command_error("member_renewals_delete", start, &err, None, None);
            Err(err)
        }
    }
}
