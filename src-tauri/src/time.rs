use chrono::{DateTime, Utc};

use crate::{AppError, AppResult};

pub fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

// Keep for parity with TS docs; we don’t call it in Rust paths (yet).
#[cfg_attr(not(test), allow(dead_code))]
#[allow(clippy::result_large_err)]
pub(crate) fn to_date(ms: i64) -> AppResult<DateTime<Utc>> {
    DateTime::<Utc>::from_timestamp_millis(ms).ok_or_else(|| {
        AppError::new("TIME/INVALID_TIMESTAMP", "Timestamp is out of range")
            .with_context("timestamp", ms.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn now_ms_is_reasonable() {
        let a = now_ms();
        assert!(a > 1_500_000_000_000); // after 2017
        assert!(a < 4_100_000_000_000); // before year ~2100
    }

    #[test]
    fn to_date_epoch() {
        let d = to_date(0).expect("epoch timestamp is valid");
        assert_eq!(d.timestamp_millis(), 0);
    }
}
