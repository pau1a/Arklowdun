use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const ATTACHMENTS_PATH_CONFLICT: &str = "ATTACHMENTS/PATH_CONFLICT";
pub const ATTACHMENTS_OUT_OF_VAULT: &str = "ATTACHMENTS/OUT_OF_VAULT";
pub const ATTACHMENTS_SYMLINK_REJECTED: &str = "ATTACHMENTS/SYMLINK_REJECTED";
pub const ATTACHMENTS_INVALID_ROOT: &str = "ATTACHMENTS/INVALID_ROOT";
pub const ATTACHMENTS_INVALID_INPUT: &str = "ATTACHMENTS/INVALID_INPUT";
pub const FAMILY_DECODE_ERROR: &str = "FAMILY/DECODE";
pub const GENERIC_FAIL: &str = "GENERIC/FAIL";
pub const GENERIC_FAIL_MESSAGE: &str = "Something went wrong — please try again.";

pub const RENEWALS_INVALID_KIND: &str = "RENEWALS/INVALID_KIND";
pub const RENEWALS_INVALID_OFFSET: &str = "RENEWALS/INVALID_OFFSET";
pub const RENEWALS_INVALID_EXPIRY: &str = "RENEWALS/INVALID_EXPIRY";
pub const RENEWALS_INVALID_LABEL: &str = "RENEWALS/INVALID_LABEL";

pub const VALIDATION_HOUSEHOLD_MISMATCH: &str = "VALIDATION/HOUSEHOLD_MISMATCH";
pub const VALIDATION_MEMBER_MISSING: &str = "VALIDATION/MEMBER_NOT_FOUND";
pub const VALIDATION_SCOPE_REQUIRED: &str = "VALIDATION/HOUSEHOLD_OR_MEMBER_REQUIRED";

pub const ALLOWED_ATTACHMENT_ROOTS: &[&str] = &["appData"];
pub const RENEWAL_KINDS: &[&str] = &[
    "passport",
    "driving_licence",
    "photo_id",
    "insurance",
    "pension",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AttachmentRef {
    pub id: Uuid,
    pub household_id: String,
    pub member_id: String,
    pub root_key: String,
    pub relative_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_hint: Option<String>,
    pub added_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AttachmentsListRequest {
    #[serde(alias = "memberId")]
    pub member_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AttachmentAddPayload {
    #[serde(alias = "householdId")]
    pub household_id: String,
    #[serde(alias = "memberId")]
    pub member_id: String,
    #[serde(alias = "rootKey")]
    pub root_key: String,
    #[serde(alias = "relativePath")]
    pub relative_path: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default, alias = "mimeHint")]
    pub mime_hint: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AttachmentRemovePayload {
    pub id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RenewalsListRequest {
    #[serde(default, alias = "memberId")]
    pub member_id: Option<String>,
    #[serde(default, alias = "householdId")]
    pub household_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RenewalUpsertPayload {
    #[serde(default, alias = "id")]
    pub id: Option<Uuid>,
    #[serde(alias = "householdId")]
    pub household_id: String,
    #[serde(alias = "memberId")]
    pub member_id: String,
    pub kind: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(alias = "expiresAt")]
    pub expires_at: i64,
    #[serde(alias = "remindOnExpiry")]
    pub remind_on_expiry: bool,
    #[serde(alias = "remindOffsetDays")]
    pub remind_offset_days: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RenewalDeletePayload {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RenewalInput {
    pub id: Option<Uuid>,
    pub household_id: String,
    pub member_id: String,
    pub kind: String,
    pub label: Option<String>,
    pub expires_at: i64,
    pub remind_on_expiry: bool,
    pub remind_offset_days: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Renewal {
    pub id: Uuid,
    pub household_id: String,
    pub member_id: String,
    pub kind: String,
    pub label: Option<String>,
    pub expires_at: i64,
    pub remind_on_expiry: bool,
    pub remind_offset_days: i64,
    pub updated_at: i64,
}
