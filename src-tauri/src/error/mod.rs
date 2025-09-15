use std::collections::HashMap;
use std::error::Error as StdError;
use std::fmt;

use crate::security::error_map::UiError;
use anyhow::Error as AnyhowError;
use serde::{Deserialize, Serialize};
use serde_json::Error as SerdeJsonError;
use sqlx::Error as SqlxError;
use std::io::Error as IoError;
use ts_rs::TS;

/// A structured application error that can be serialized and surfaced to the UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct AppError {
    /// Machine readable error code.
    pub code: String,
    /// Human friendly message that can be shown directly to the user.
    pub message: String,
    /// Arbitrary key/value pairs that provide additional context.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    #[ts(optional, type = "Record<string, string>")]
    pub context: HashMap<String, String>,
    /// Optional nested cause that preserves the error chain.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cause: Option<Box<AppError>>,
}

pub type AppResult<T> = std::result::Result<T, AppError>;
pub type Result<T> = AppResult<T>;

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
        }
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

impl From<AppError> for AnyhowError {
    fn from(error: AppError) -> Self {
        AnyhowError::new(error)
    }
}

impl From<AnyhowError> for AppError {
    fn from(error: AnyhowError) -> Self {
        fn convert(err: &(dyn StdError + 'static)) -> AppError {
            if let Some(app) = err.downcast_ref::<AppError>() {
                return app.clone();
            }

            let mut root = AppError::new(AppError::UNKNOWN_CODE, err.to_string());
            if let Some(source) = err.source() {
                root.cause = Some(Box::new(convert(source)));
            }
            root
        }

        convert(error.as_ref())
    }
}

impl From<IoError> for AppError {
    fn from(error: IoError) -> Self {
        let code = format!("IO/{:?}", error.kind());
        let mut app_error = AppError::new(code, error.to_string());
        if let Some(os_code) = error.raw_os_error() {
            app_error = app_error.with_context("os_code", os_code.to_string());
        }
        app_error
    }
}

impl From<SerdeJsonError> for AppError {
    fn from(error: SerdeJsonError) -> Self {
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

        let mut app_error = AppError::new(code, error.to_string());
        let line = error.line();
        if line > 0 {
            app_error = app_error.with_context("line", line.to_string());
        }
        let column = error.column();
        if column > 0 {
            app_error = app_error.with_context("column", column.to_string());
        }
        app_error
    }
}

impl From<SqlxError> for AppError {
    fn from(error: SqlxError) -> Self {
        match error {
            SqlxError::RowNotFound => AppError::new("SQLX/ROW_NOT_FOUND", "Record not found"),
            SqlxError::ColumnNotFound(name) => {
                AppError::new("SQLX/COLUMN_NOT_FOUND", format!("Column not found: {name}"))
            }
            SqlxError::PoolTimedOut => AppError::new(
                "SQLX/POOL_TIMEOUT",
                "Timed out acquiring a database connection",
            ),
            SqlxError::PoolClosed => AppError::new("SQLX/POOL_CLOSED", "Database pool is closed"),
            SqlxError::Io(err) => AppError::from(err).with_context("source", "sqlx"),
            SqlxError::Database(db) => {
                let code = db
                    .code()
                    .map(|code| format!("Sqlite/{code}"))
                    .unwrap_or_else(|| "SQLX/DATABASE".to_string());
                let mut app_error = AppError::new(code, db.message().to_string());
                if let Some(constraint) = db.constraint() {
                    app_error = app_error.with_context("constraint", constraint.to_string());
                }
                app_error
            }
            SqlxError::ColumnDecode { index, source } => {
                AppError::new("SQLX/COLUMN_DECODE", source.to_string())
                    .with_context("column_index", index.to_string())
            }
            SqlxError::Decode(decode_err) => AppError::new("SQLX/DECODE", decode_err.to_string()),
            other => AppError::new("SQLX/ERROR", other.to_string()),
        }
    }
}

impl From<UiError> for AppError {
    fn from(error: UiError) -> Self {
        AppError::new(error.code, error.message)
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
        let err = (|| -> anyhow::Result<()> {
            Err(std::io::Error::new(std::io::ErrorKind::Other, "disk full"))
                .context("failed to save file")
        })()
        .unwrap_err();

        let app_error = AppError::from(err);
        assert_eq!(app_error.code(), AppError::UNKNOWN_CODE);
        assert_eq!(app_error.message(), "failed to save file");

        let cause = app_error.cause().expect("io cause present");
        assert_eq!(cause.code(), AppError::UNKNOWN_CODE);
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
        let anyhow_error: AnyhowError = error.clone().into();
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
}
