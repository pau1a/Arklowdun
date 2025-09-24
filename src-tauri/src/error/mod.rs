mod crash_id;

use std::any::Any;
use std::borrow::Cow;
use std::cell::RefCell;
use std::collections::HashMap;
use std::error::Error as StdError;
use std::fmt;
use std::panic::PanicHookInfo;

use crate::{db::health::DbHealthReport, security::error_map::UiError};
use anyhow::Error as AnyhowError;
use once_cell::sync::OnceCell;
use serde::{Deserialize, Serialize};
use serde_json::Error as SerdeJsonError;
use sqlx::Error as SqlxError;
use std::io::Error as IoError;
use ts_rs::TS;

pub use crash_id::CrashId;

const CRASH_MESSAGE_PREFIX: &str = "Something went wrong. Crash ID: ";

thread_local! {
    static HOOK_CRASH_ID: RefCell<Option<CrashId>> = const { RefCell::new(None) };
}

static PANIC_HOOK: OnceCell<()> = OnceCell::new();

pub fn install_panic_hook() {
    PANIC_HOOK.get_or_init(|| {
        let _ = std::panic::take_hook();
        std::panic::set_hook(Box::new(|info| {
            let crash_id = CrashId::new();
            HOOK_CRASH_ID.with(|slot| {
                *slot.borrow_mut() = Some(crash_id.clone());
            });
            let message = panic_message(info);
            let location = info
                .location()
                .map(|loc| format!("{}:{}", loc.file(), loc.line()))
                .unwrap_or_else(|| "unknown".to_string());
            tracing::error!(
                target = "arklowdun",
                event = "panic_hook",
                crash_id = %crash_id,
                location = %location,
                panic = %message
            );
        }));
    });
}

pub(crate) fn take_panic_crash_id() -> Option<CrashId> {
    HOOK_CRASH_ID.with(|slot| slot.borrow_mut().take())
}

pub(crate) fn panic_payload(payload: &(dyn Any + Send)) -> String {
    if let Some(s) = payload.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        "unknown panic payload".to_string()
    }
}

fn panic_message(info: &PanicHookInfo) -> String {
    panic_payload(info.payload())
}

/// A structured application error that can be serialized and surfaced to the UI.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct AppError {
    /// Machine readable error code.
    pub code: String,
    /// Human friendly message that can be shown directly to the user.
    pub message: String,
    /// Arbitrary key/value pairs that provide additional context.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    #[ts(type = "Record<string, string> | undefined")]
    pub context: HashMap<String, String>,
    /// Optional nested cause that preserves the error chain.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cause: Option<Box<AppError>>,
    /// Crash identifier associated with critical failures.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[ts(type = "string | undefined")]
    pub crash_id: Option<CrashId>,
    /// Optional database health report associated with the error.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub health_report: Option<DbHealthReport>,
}

/// Serializable representation of [`AppError`] for clients.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ErrorDto {
    /// Machine readable error code.
    pub code: String,
    /// Human friendly message that can be shown directly to the user.
    pub message: String,
    /// Arbitrary key/value pairs that provide additional context.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub context: HashMap<String, String>,
    /// Optional nested cause that preserves the error chain.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cause: Option<Box<ErrorDto>>,
    /// Crash identifier associated with critical failures.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crash_id: Option<CrashId>,
    /// Optional database health report associated with the error.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub health_report: Option<DbHealthReport>,
}

pub type AppResult<T> = std::result::Result<T, AppError>;

impl AppError {
    /// Default code used when an upstream error does not expose a specific code.
    pub const UNKNOWN_CODE: &'static str = "APP/UNKNOWN";
    /// Code used for errors created from free-form messages.
    pub const GENERIC_CODE: &'static str = "APP/GENERIC";

    /// Construct a new application error with the provided code and message.
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        AppError {
            code: code.into(),
            message: message.into(),
            context: HashMap::new(),
            cause: None,
            crash_id: None,
            health_report: None,
        }
    }

    /// Construct a critical error carrying a Crash ID.
    pub fn critical(code: impl Into<String>, message: impl Into<String>) -> Self {
        AppError::new(code, message).into_critical()
    }

    /// Returns the crash identifier when this is a critical error.
    pub fn crash_id(&self) -> Option<&CrashId> {
        self.crash_id.as_ref()
    }

    /// True when the error represents a critical failure.
    pub fn is_critical(&self) -> bool {
        self.crash_id.is_some()
    }

    /// Attach a specific crash identifier to the error.
    pub fn with_crash_id(mut self, crash_id: CrashId) -> Self {
        self.crash_id = Some(crash_id);
        self
    }

    /// Attach the database health report that triggered this error.
    pub fn with_health_report(mut self, report: DbHealthReport) -> Self {
        self.health_report = Some(report);
        self
    }

    /// Returns the database health report associated with the error, if any.
    pub fn health_report(&self) -> Option<&DbHealthReport> {
        self.health_report.as_ref()
    }

    /// Ensure the error is marked as critical, allocating a new Crash ID if needed.
    pub fn into_critical(mut self) -> Self {
        if self.crash_id.is_none() {
            self.crash_id = Some(CrashId::new());
        }
        self
    }

    pub(crate) fn set_crash_id(&mut self, crash_id: CrashId) {
        self.crash_id = Some(crash_id);
    }

    /// Returns the error code.
    pub fn code(&self) -> &str {
        &self.code
    }

    /// Returns the error message.
    pub fn message(&self) -> &str {
        &self.message
    }

    /// Returns the contextual metadata associated with the error.
    pub fn context(&self) -> &HashMap<String, String> {
        &self.context
    }

    /// Returns the nested cause if one is present.
    pub fn cause(&self) -> Option<&AppError> {
        self.cause.as_deref()
    }

    /// Adds a contextual key/value pair to the error.
    pub fn with_context(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.context.insert(key.into(), value.into());
        self
    }

    /// Extends the context map with additional key/value pairs.
    pub fn with_contexts<I, K, V>(mut self, entries: I) -> Self
    where
        I: IntoIterator<Item = (K, V)>,
        K: Into<String>,
        V: Into<String>,
    {
        self.context
            .extend(entries.into_iter().map(|(k, v)| (k.into(), v.into())));
        self
    }

    /// Sets the nested cause for the error.
    pub fn with_cause(mut self, cause: impl Into<AppError>) -> Self {
        self.cause = Some(Box::new(cause.into()));
        self
    }

    fn sanitized_message(&self) -> Cow<'_, str> {
        match &self.crash_id {
            Some(id) => Cow::Owned(format!("{CRASH_MESSAGE_PREFIX}{id}.")),
            None => Cow::Borrowed(self.message.as_str()),
        }
    }

    pub(crate) fn log_with_event(&self, event: &'static str) {
        if let Some(id) = &self.crash_id {
            tracing::error!(
                target = "arklowdun",
                event = event,
                code = %self.code,
                crash_id = %id,
                message = %self.message,
                has_context = !self.context.is_empty(),
                has_cause = self.cause.is_some()
            );
        }
    }

    fn with_error_source(mut self, source: Option<&(dyn StdError + 'static)>) -> Self {
        if self.cause.is_none() {
            if let Some(source) = source {
                self.cause = Some(Box::new(AppError::from_std_error(source)));
            }
        }
        self
    }

    fn from_io_ref(error: &IoError) -> Self {
        let code = format!("IO/{:?}", error.kind());
        let base = AppError::new(code, error.to_string());
        let app_error = match error.raw_os_error() {
            Some(os_code) => base.with_context("os_code", os_code.to_string()),
            None => base,
        };
        app_error.with_error_source(error.source())
    }

    fn from_serde_json_ref(error: &SerdeJsonError) -> Self {
        let code = if error.is_data() {
            "JSON/DATA"
        } else if error.is_syntax() {
            "JSON/SYNTAX"
        } else if error.is_eof() {
            "JSON/EOF"
        } else if error.is_io() {
            "JSON/IO"
        } else {
            "JSON/ERROR"
        };

        let base = AppError::new(code, error.to_string());
        let with_line = {
            let line = error.line();
            if line > 0 {
                base.with_context("line", line.to_string())
            } else {
                base
            }
        };
        let with_col = {
            let column = error.column();
            if column > 0 {
                with_line.with_context("column", column.to_string())
            } else {
                with_line
            }
        };
        with_col.with_error_source(error.source())
    }

    fn from_sqlx_ref(error: &SqlxError) -> Self {
        let app_error = match error {
            SqlxError::RowNotFound => AppError::new("SQLX/ROW_NOT_FOUND", "Record not found"),
            SqlxError::ColumnNotFound(name) => {
                AppError::new("SQLX/COLUMN_NOT_FOUND", format!("Column not found: {name}"))
            }
            SqlxError::PoolTimedOut => AppError::new(
                "SQLX/POOL_TIMEOUT",
                "Timed out acquiring a database connection",
            ),
            SqlxError::PoolClosed => AppError::new("SQLX/POOL_CLOSED", "Database pool is closed"),
            SqlxError::Io(err) => {
                return AppError::from_io_ref(err).with_context("source", "sqlx");
            }
            SqlxError::Database(db) => {
                let code = db
                    .code()
                    .map(|code| format!("Sqlite/{code}"))
                    .unwrap_or_else(|| "SQLX/DATABASE".to_string());
                match db.constraint() {
                    Some(constraint) => AppError::new(code, db.message().to_string())
                        .with_context("constraint", constraint.to_string()),
                    None => AppError::new(code, db.message().to_string()),
                }
            }
            SqlxError::ColumnDecode { index, source } => {
                AppError::new("SQLX/COLUMN_DECODE", source.to_string())
                    .with_context("column_index", index.to_string())
            }
            SqlxError::Decode(decode_err) => AppError::new("SQLX/DECODE", decode_err.to_string()),
            other => AppError::new("SQLX/ERROR", other.to_string()),
        };

        app_error.with_error_source(error.source())
    }

    fn from_std_error(err: &(dyn StdError + 'static)) -> Self {
        if let Some(app) = err.downcast_ref::<AppError>() {
            return app.clone();
        }
        if let Some(sqlx) = err.downcast_ref::<SqlxError>() {
            return AppError::from_sqlx_ref(sqlx);
        }
        if let Some(io) = err.downcast_ref::<IoError>() {
            return AppError::from_io_ref(io);
        }
        if let Some(json) = err.downcast_ref::<SerdeJsonError>() {
            return AppError::from_serde_json_ref(json);
        }

        let mut root = AppError::new(AppError::UNKNOWN_CODE, err.to_string());
        if let Some(source) = err.source() {
            root.cause = Some(Box::new(AppError::from_std_error(source)));
        }
        root
    }

    /// Convert the error into a serializable DTO, cloning as needed.
    pub fn to_dto(&self) -> ErrorDto {
        ErrorDto::from(self)
    }

    /// Convert the error into a serializable DTO, consuming the value.
    pub fn into_dto(self) -> ErrorDto {
        self.into()
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.context.is_empty() {
            write!(f, "[{}] {}", self.code, self.message)
        } else {
            write!(f, "[{}] {} ({:?})", self.code, self.message, self.context)
        }
    }
}

impl std::error::Error for AppError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        self.cause
            .as_deref()
            .map(|cause| cause as &(dyn std::error::Error + 'static))
    }
}

impl From<&str> for AppError {
    fn from(message: &str) -> Self {
        AppError::new(AppError::GENERIC_CODE, message)
    }
}

impl From<String> for AppError {
    fn from(message: String) -> Self {
        AppError::new(AppError::GENERIC_CODE, message)
    }
}

// Do not implement From<AppError> for anyhow::Error to avoid conflicting impls.

impl From<AnyhowError> for AppError {
    fn from(error: AnyhowError) -> Self {
        AppError::from_std_error(error.as_ref())
    }
}

impl From<IoError> for AppError {
    fn from(error: IoError) -> Self {
        AppError::from_io_ref(&error)
    }
}

impl From<&IoError> for AppError {
    fn from(error: &IoError) -> Self {
        AppError::from_io_ref(error)
    }
}

impl From<SerdeJsonError> for AppError {
    fn from(error: SerdeJsonError) -> Self {
        AppError::from_serde_json_ref(&error)
    }
}

impl From<&SerdeJsonError> for AppError {
    fn from(error: &SerdeJsonError) -> Self {
        AppError::from_serde_json_ref(error)
    }
}

impl From<SqlxError> for AppError {
    fn from(error: SqlxError) -> Self {
        AppError::from_sqlx_ref(&error)
    }
}

impl From<&SqlxError> for AppError {
    fn from(error: &SqlxError) -> Self {
        AppError::from_sqlx_ref(error)
    }
}

impl From<UiError> for AppError {
    fn from(error: UiError) -> Self {
        AppError::new(error.code, error.message)
    }
}

impl From<&AppError> for ErrorDto {
    fn from(error: &AppError) -> Self {
        ErrorDto {
            code: error.code.clone(),
            message: error.sanitized_message().into_owned(),
            context: error.context.clone(),
            cause: error
                .cause
                .as_ref()
                .map(|cause| Box::new(ErrorDto::from(cause.as_ref()))),
            crash_id: error.crash_id.clone(),
            health_report: error.health_report.clone(),
        }
    }
}

impl From<AppError> for ErrorDto {
    fn from(error: AppError) -> Self {
        let message = error.sanitized_message().into_owned();

        ErrorDto {
            code: error.code,
            message,
            context: error.context,
            cause: error.cause.map(|cause| Box::new(ErrorDto::from(*cause))),
            crash_id: error.crash_id,
            health_report: error.health_report,
        }
    }
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        if self.is_critical() {
            self.log_with_event("critical_failure");
        }
        let dto = ErrorDto::from(self);
        <ErrorDto as serde::Serialize>::serialize(&dto, serializer)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::Context;

    #[test]
    fn builds_error_with_context_and_cause() {
        let error = AppError::new("TEST/CODE", "Something went wrong")
            .with_context("entity", "budget")
            .with_context("id", "1234")
            .with_cause(AppError::from("inner failure"));

        assert_eq!(error.code(), "TEST/CODE");
        assert_eq!(error.message(), "Something went wrong");
        assert_eq!(error.context().get("entity"), Some(&"budget".to_string()));
        assert_eq!(error.context().get("id"), Some(&"1234".to_string()));
        let cause = error.cause().expect("cause present");
        assert_eq!(cause.message(), "inner failure");
        assert_eq!(cause.code(), AppError::GENERIC_CODE);
    }

    #[test]
    fn converts_anyhow_error_chain_into_nested_causes() {
        let err = Err::<(), _>(std::io::Error::other("disk full"))
            .context("failed to save file")
            .unwrap_err();

        let app_error = AppError::from(err);
        assert_eq!(app_error.code(), AppError::UNKNOWN_CODE);
        assert_eq!(app_error.message(), "failed to save file");

        let cause = app_error.cause().expect("io cause present");
        assert_eq!(cause.code(), "IO/Other");
        assert!(cause.message().contains("disk full"));
    }

    #[test]
    fn converts_anyhow_preserves_existing_app_error_chain() {
        let inner = AppError::new("VALIDATION", "nope")
            .with_context("field", "name")
            .with_cause(AppError::new("DB/FAIL", "db fail"));
        let err = AnyhowError::from(inner.clone()).context("outer failure");

        let converted = AppError::from(err);
        assert_eq!(converted.code(), AppError::UNKNOWN_CODE);
        assert_eq!(converted.message(), "outer failure");
        let cause = converted.cause().expect("inner cause present");
        assert_eq!(cause, &inner);
    }

    #[test]
    fn into_anyhow_preserves_display() {
        let error = AppError::new("VALIDATION", "Missing field").with_context("field", "name");
        let anyhow_error: AnyhowError = AnyhowError::new(error.clone());
        assert_eq!(anyhow_error.to_string(), error.to_string());
    }

    #[test]
    fn serde_json_errors_capture_position() {
        let err: SerdeJsonError =
            serde_json::from_str::<serde_json::Value>("{\"foo\": }").expect_err("invalid json");
        let app_error = AppError::from(err);
        assert_eq!(app_error.code(), "JSON/SYNTAX");
        assert!(app_error.context().contains_key("line"));
        assert!(app_error.context().contains_key("column"));
    }

    #[test]
    fn sqlx_row_not_found_translates_to_specific_code() {
        let err = SqlxError::RowNotFound;
        let app_error = AppError::from(err);
        assert_eq!(app_error.code(), "SQLX/ROW_NOT_FOUND");
        assert_eq!(app_error.message(), "Record not found");
    }

    #[test]
    fn io_error_contains_raw_code_when_available() {
        let err = IoError::from_raw_os_error(2);
        let app_error = AppError::from(err);
        assert_eq!(app_error.code(), "IO/NotFound");
        assert_eq!(app_error.context().get("os_code"), Some(&"2".to_string()));
    }

    #[test]
    fn json_shape_is_flat_struct() {
        let error = AppError::new("VALIDATION", "nope").with_context("field", "name");
        let json = serde_json::to_string(&error).expect("serialize app error");
        assert!(json.contains("\"code\":\"VALIDATION\""));
        assert!(!json.contains("Structured"));

        let value: serde_json::Value = serde_json::from_str(&json).expect("parse serialized error");
        assert_eq!(
            value.get("code").and_then(|v| v.as_str()),
            Some("VALIDATION")
        );
        assert_eq!(value.get("message").and_then(|v| v.as_str()), Some("nope"));
        assert_eq!(
            value
                .get("context")
                .and_then(|c| c.get("field"))
                .and_then(|v| v.as_str()),
            Some("name")
        );
        assert!(value.get("cause").is_none());
    }

    #[test]
    fn dto_conversion_clones_structure() {
        let error = AppError::new("VALIDATION", "nope")
            .with_context("field", "name")
            .with_cause(AppError::new("DB/FAIL", "db fail"));

        let dto = error.to_dto();
        assert_eq!(dto.code, "VALIDATION");
        assert_eq!(dto.message, "nope");
        assert_eq!(dto.context.get("field"), Some(&"name".to_string()));

        let cause = dto.cause.expect("cause present");
        assert_eq!(cause.code, "DB/FAIL");
        assert_eq!(cause.message, "db fail");
    }
}
