use std::collections::HashMap;
use std::time::Instant;

use serde::Deserialize;
use serde_json::{json, Map, Value};
use tracing::{debug, error, info, warn};

use crate::{ipc::guard, AppError};

fn context_to_json(context: &HashMap<String, String>) -> Option<Value> {
    if context.is_empty() {
        None
    } else {
        let mut map = Map::with_capacity(context.len());
        for (key, value) in context {
            map.insert(key.clone(), Value::String(value.clone()));
        }
        Some(Value::Object(map))
    }
}

fn is_validation_error(code: &str) -> bool {
    code.starts_with("ATTACHMENTS/")
        || code.starts_with("RENEWALS/")
        || code.starts_with("VALIDATION/")
}

fn wrap_details(value: Value) -> Value {
    if value.is_object() {
        value
    } else {
        json!({ "value": value })
    }
}

fn default_details() -> Value {
    Value::Object(Map::new())
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum UiLogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UiLogRecord {
    pub cmd: String,
    pub level: UiLogLevel,
    #[serde(default)]
    pub household_id: Option<String>,
    #[serde(default)]
    pub member_id: Option<String>,
    #[serde(default)]
    pub duration_ms: Option<u64>,
    #[serde(default = "default_details")]
    pub details: Value,
}

pub fn emit_ui_log(record: UiLogRecord) {
    let UiLogRecord {
        cmd,
        level,
        household_id,
        member_id,
        duration_ms,
        details,
    } = record;

    let wrapped_details = wrap_details(details);

    match level {
        UiLogLevel::Debug => debug!(
            target: "arklowdun",
            area = "family",
            cmd = cmd.as_str(),
            household_id = household_id.as_deref(),
            member_id = member_id.as_deref(),
            duration_ms = duration_ms,
            details = %wrapped_details
        ),
        UiLogLevel::Info => info!(
            target: "arklowdun",
            area = "family",
            cmd = cmd.as_str(),
            household_id = household_id.as_deref(),
            member_id = member_id.as_deref(),
            duration_ms = duration_ms,
            details = %wrapped_details
        ),
        UiLogLevel::Warn => warn!(
            target: "arklowdun",
            area = "family",
            cmd = cmd.as_str(),
            household_id = household_id.as_deref(),
            member_id = member_id.as_deref(),
            duration_ms = duration_ms,
            details = %wrapped_details
        ),
        UiLogLevel::Error => error!(
            target: "arklowdun",
            area = "family",
            cmd = cmd.as_str(),
            household_id = household_id.as_deref(),
            member_id = member_id.as_deref(),
            duration_ms = duration_ms,
            details = %wrapped_details
        ),
    }
}

pub struct LogScope {
    cmd: &'static str,
    household_id: Option<String>,
    member_id: Option<String>,
    start: Instant,
}

impl LogScope {
    pub fn new(cmd: &'static str, household_id: Option<String>, member_id: Option<String>) -> Self {
        let scope = Self {
            cmd,
            household_id,
            member_id,
            start: Instant::now(),
        };
        debug!(
            target: "arklowdun",
            area = "family",
            cmd = scope.cmd,
            household_id = scope.household_id.as_deref(),
            member_id = scope.member_id.as_deref(),
            details = %json!({ "stage": "enter" })
        );
        scope
    }

    fn elapsed_ms(&self) -> u128 {
        self.start.elapsed().as_millis()
    }

    fn resolved_household(&self, override_id: Option<&str>) -> Option<String> {
        override_id
            .map(|value| value.to_string())
            .or_else(|| self.household_id.clone())
    }

    fn resolved_member(&self, override_id: Option<&str>) -> Option<String> {
        override_id
            .map(|value| value.to_string())
            .or_else(|| self.member_id.clone())
    }

    pub fn success(&self, member_id: Option<&str>, details: Value) {
        info!(
            target: "arklowdun",
            area = "family",
            cmd = self.cmd,
            household_id = self.household_id.as_deref(),
            member_id = member_id.or(self.member_id.as_deref()),
            duration_ms = self.elapsed_ms() as u64,
            details = %wrap_details(details)
        );
    }

    pub fn success_with_ids(
        &self,
        household_id: Option<&str>,
        member_id: Option<&str>,
        details: Value,
    ) {
        info!(
            target: "arklowdun",
            area = "family",
            cmd = self.cmd,
            household_id = self.resolved_household(household_id).as_deref(),
            member_id = self.resolved_member(member_id).as_deref(),
            duration_ms = self.elapsed_ms() as u64,
            details = %wrap_details(details)
        );
    }

    pub fn warn(&self, details: Value) {
        self.emit_warn(details, None, None);
    }

    pub fn warn_with_ids(
        &self,
        household_id: Option<&str>,
        member_id: Option<&str>,
        details: Value,
    ) {
        self.emit_warn(details, household_id, member_id);
    }

    pub fn fail(&self, err: &AppError) {
        if err.code() == guard::DB_UNHEALTHY_CODE {
            self.emit_warn(
                json!({ "code": err.code(), "message": "DB_UNHEALTHY – write blocked" }),
                None,
                None,
            );
            return;
        }

        if is_validation_error(err.code()) {
            let mut map = Map::new();
            map.insert("code".into(), Value::String(err.code().to_string()));
            map.insert("message".into(), Value::String(err.message().to_string()));
            if let Some(context) = context_to_json(err.context()) {
                map.insert("context".into(), context);
            }
            self.emit_warn(Value::Object(map), None, None);
            return;
        }

        let mut map = Map::new();
        map.insert("code".into(), Value::String(err.code().to_string()));
        map.insert("message".into(), Value::String(err.message().to_string()));
        if let Some(context) = context_to_json(err.context()) {
            map.insert("context".into(), context);
        }
        if let Some(crash) = err.crash_id() {
            map.insert("crash_id".into(), Value::String(crash.to_string()));
        }
        error!(
            target: "arklowdun",
            area = "family",
            cmd = self.cmd,
            household_id = self.household_id.as_deref(),
            member_id = self.member_id.as_deref(),
            duration_ms = self.elapsed_ms() as u64,
            details = %Value::Object(map)
        );
    }

    fn emit_warn(&self, details: Value, household_id: Option<&str>, member_id: Option<&str>) {
        warn!(
            target: "arklowdun",
            area = "family",
            cmd = self.cmd,
            household_id = self.resolved_household(household_id).as_deref(),
            member_id = self.resolved_member(member_id).as_deref(),
            duration_ms = self.elapsed_ms() as u64,
            details = %wrap_details(details)
        );
    }
}
