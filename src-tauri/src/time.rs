use chrono::{DateTime, TimeZone, Utc};

pub fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

pub fn to_date(ms: i64) -> DateTime<Utc> {
    Utc.timestamp_millis_opt(ms).single().unwrap_or_else(|| Utc.timestamp_millis(0))
}
