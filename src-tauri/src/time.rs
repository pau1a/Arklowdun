use chrono::{DateTime, Utc};

pub fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

// Keep for parity with TS docs; we don’t call it in Rust paths (yet).
#[allow(dead_code)]
pub fn to_date(ms: i64) -> DateTime<Utc> {
    // from_timestamp_millis returns Option<DateTime<Utc>>
    DateTime::<Utc>::from_timestamp_millis(ms)
        .unwrap_or_else(|| DateTime::<Utc>::from_timestamp_millis(0).unwrap())
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
        let d = to_date(0);
        assert_eq!(d.timestamp_millis(), 0);
    }
}
