use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;
use ts_rs::TS;
use uuid::Uuid;

/// Unique identifier used to correlate critical failures across logs and UI.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[repr(transparent)]
#[serde(transparent)]
#[ts(type = "string")]
pub struct CrashId(Uuid);

impl CrashId {
    /// Generate a new UUIDv7 crash identifier.
    pub fn new() -> Self {
        Self(Uuid::now_v7())
    }

    /// Access the underlying UUID value.
    pub fn as_uuid(&self) -> &Uuid {
        &self.0
    }
}

impl fmt::Display for CrashId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(&self.0, f)
    }
}

impl FromStr for CrashId {
    type Err = uuid::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(Self(Uuid::parse_str(s)?))
    }
}

impl From<Uuid> for CrashId {
    fn from(value: Uuid) -> Self {
        Self(value)
    }
}

impl From<CrashId> for Uuid {
    fn from(value: CrashId) -> Self {
        value.0
    }
}

impl Default for CrashId {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_matches_serialized_form() {
        let id = CrashId::new();
        let rendered = id.to_string();
        let json = serde_json::to_string(&id).expect("serialize crash id");
        assert_eq!(json.trim_matches('"'), rendered);
        assert!(Uuid::parse_str(&rendered).is_ok());
    }

    #[test]
    fn parse_roundtrips() {
        let id = CrashId::new();
        let parsed: CrashId = id.to_string().parse().expect("parse crash id");
        assert_eq!(parsed, id);
    }
}
