use serde::Serialize;

use super::fs_policy::FsPolicyError;

#[derive(Serialize)]
pub struct UiError {
    pub code: &'static str,
    pub message: &'static str,
}

impl From<FsPolicyError> for UiError {
    fn from(e: FsPolicyError) -> Self {
        match e {
            FsPolicyError::UncRejected
            | FsPolicyError::DotDotRejected
            | FsPolicyError::CrossVolume
            | FsPolicyError::OutsideRoot
            | FsPolicyError::Symlink => UiError {
                code: "NOT_ALLOWED",
                message: "That location isn't allowed.",
            },
            FsPolicyError::Invalid => UiError {
                code: "INVALID_INPUT",
                message: "Invalid path.",
            },
            FsPolicyError::Io(_) => UiError {
                code: "IO/GENERIC",
                message: "File error.",
            },
        }
    }
}
