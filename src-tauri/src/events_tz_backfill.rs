use chrono::{LocalResult, NaiveDateTime, Offset, TimeZone, Utc};
use chrono_tz::Tz;
use serde::Serialize;
use sqlx::Row;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::{state::AppState, time::now_ms, AppError};

#[derive(Serialize)]
pub struct BackfillReport {
    pub household_id: String,
    pub tz_used: String,
    pub to_update: u64,
    pub updated: u64,
    pub dry_run: bool,
}

#[derive(Serialize, Clone)]
struct Progress {
    processed: u64,
    total: u64,
}

/// Legacy `start_at` values were stored as local wall-clock milliseconds with no
/// timezone. Interpret `local_ms` using `tz` and return the corresponding UTC
/// instant. Ambiguous times during a DST fall-back choose the earlier
/// occurrence; gaps choose the earliest valid instant after the gap.
fn to_utc_ms(local_ms: i64, tz: Tz) -> i64 {
    #[allow(deprecated)]
    let naive = NaiveDateTime::from_timestamp_millis(local_ms).expect("valid ms");
    let local = match tz.from_local_datetime(&naive) {
        LocalResult::Single(dt) => dt,
        LocalResult::Ambiguous(a, _b) => a,
        LocalResult::None => tz
            .offset_from_utc_datetime(&naive)
            .fix()
            .from_utc_datetime(&naive)
            .with_timezone(&tz),
    };
    local.with_timezone(&Utc).timestamp_millis()
}

#[tauri::command]
// TXN: domain=OUT OF SCOPE tables=events
pub async fn events_backfill_timezone(
    app: AppHandle,
    household_id: String,
    default_tz: Option<String>,
    dry_run: bool,
) -> Result<BackfillReport, AppError> {
    let pool = {
        let state: State<AppState> = app.state();
        state.pool.clone()
    };

    let tz_used = match sqlx::query("SELECT tz FROM household WHERE id = ?")
        .bind(&household_id)
        .fetch_one(&pool)
        .await
    {
        Ok(row) => row.try_get::<String, _>("tz").unwrap_or_default(),
        Err(_) => String::new(),
    };
    let tz_str = if !tz_used.is_empty() {
        tz_used
    } else {
        default_tz.unwrap_or_else(|| "Europe/London".into())
    };
    let tz: Tz = tz_str.parse().unwrap_or(chrono_tz::Europe::London);

    let total: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM events WHERE household_id = ? AND (tz IS NULL OR start_at_utc IS NULL)",
    )
    .bind(&household_id)
    .fetch_one(&pool)
    .await
    .map_err(|err| {
        AppError::from(err)
            .with_context("operation", "events_backfill_timezone")
            .with_context("step", "count")
            .with_context("household_id", household_id.clone())
    })?;

    if dry_run {
        return Ok(BackfillReport {
            household_id,
            tz_used: tz.name().to_string(),
            to_update: total as u64,
            updated: 0,
            dry_run: true,
        });
    }

    let mut tx = pool.begin().await.map_err(|err| {
        AppError::from(err)
            .with_context("operation", "events_backfill_timezone")
            .with_context("step", "begin_tx")
            .with_context("household_id", household_id.clone())
    })?;

    // Legacy rows store `start_at` as wall-clock ms in `tz`; derive UTC values.
    let rows = sqlx::query("SELECT id, start_at, end_at FROM events WHERE household_id = ? AND (tz IS NULL OR start_at_utc IS NULL)")
        .bind(&household_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(|err| {
            AppError::from(err)
                .with_context("operation", "events_backfill_timezone")
                .with_context("step", "load_events")
                .with_context("household_id", household_id.clone())
        })?;

    let total_u = total as u64;
    let mut processed = 0u64;
    for row in rows {
        let id: String = row.try_get("id").unwrap();
        let start_at: i64 = row.try_get("start_at").unwrap_or(0);
        let end_at: Option<i64> = row.try_get("end_at").ok();

        let start_at_utc = to_utc_ms(start_at, tz);
        let end_at_utc = end_at.map(|e| to_utc_ms(e, tz));

        sqlx::query("UPDATE events SET tz = ?, start_at_utc = ?, end_at_utc = ? WHERE id = ?")
            .bind(tz.name())
            .bind(start_at_utc)
            .bind(end_at_utc)
            .bind(&id)
            .execute(&mut *tx)
            .await
            .map_err(|err| {
                AppError::from(err)
                    .with_context("operation", "events_backfill_timezone")
                    .with_context("step", "update_event")
                    .with_context("event_id", id.clone())
                    .with_context("household_id", household_id.clone())
            })?;

        processed += 1;
        if processed % 50 == 0 || processed == total_u {
            let _ = app.emit(
                "events_tz_backfill_progress",
                Progress {
                    processed,
                    total: total_u,
                },
            );
        }
    }

    tx.commit().await.map_err(|err| {
        AppError::from(err)
            .with_context("operation", "events_backfill_timezone")
            .with_context("step", "commit_tx")
            .with_context("household_id", household_id.clone())
    })?;

    use std::fs::{create_dir_all, File};
    use std::io::Write;
    let ts = now_ms();
    if let Some(mut dir) = app.path().app_data_dir() {
        dir.push("logs");
        let _ = create_dir_all(&dir);
        let path = dir.join(format!("events_tz_backfill_{}_{}.log", household_id, ts));
        if let Ok(mut f) = File::create(&path) {
            let _ = writeln!(f, "tz_used={}", tz.name());
            let _ = writeln!(f, "to_update={}", total_u);
            let _ = writeln!(f, "updated={}", processed);
        }
    }

    Ok(BackfillReport {
        household_id,
        tz_used: tz.name().to_string(),
        to_update: total_u,
        updated: processed,
        dry_run: false,
    })
}

#[cfg(test)]
mod tests {
    use super::to_utc_ms;
    use chrono::{TimeZone, Utc};
    use chrono_tz::Tz;

    #[test]
    fn london_conversion() {
        let tz: Tz = "Europe/London".parse().unwrap();
        let local_ms = chrono::NaiveDate::from_ymd_opt(2025, 9, 7)
            .unwrap()
            .and_hms_opt(10, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp_millis();
        let expected = tz
            .with_ymd_and_hms(2025, 9, 7, 10, 0, 0)
            .unwrap()
            .with_timezone(&Utc)
            .timestamp_millis();
        assert_eq!(to_utc_ms(local_ms, tz), expected);
    }

    #[test]
    fn new_york_conversion_dst() {
        let tz: Tz = "America/New_York".parse().unwrap();
        let local_ms = chrono::NaiveDate::from_ymd_opt(2025, 3, 9)
            .unwrap()
            .and_hms_opt(3, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp_millis();
        let expected = tz
            .with_ymd_and_hms(2025, 3, 9, 3, 0, 0)
            .unwrap()
            .with_timezone(&Utc)
            .timestamp_millis();
        assert_eq!(to_utc_ms(local_ms, tz), expected);
    }

    #[test]
    fn tokyo_conversion() {
        let tz: Tz = "Asia/Tokyo".parse().unwrap();
        let local_ms = chrono::NaiveDate::from_ymd_opt(2025, 9, 7)
            .unwrap()
            .and_hms_opt(10, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp_millis();
        let expected = tz
            .with_ymd_and_hms(2025, 9, 7, 10, 0, 0)
            .unwrap()
            .with_timezone(&Utc)
            .timestamp_millis();
        assert_eq!(to_utc_ms(local_ms, tz), expected);
    }
}
