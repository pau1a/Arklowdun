use anyhow::Result;
use arklowdun_lib::{create_household, default_household_id, diagnostics, migrate};
use sqlx::sqlite::SqlitePoolOptions;

async fn memory_pool() -> Result<sqlx::SqlitePool> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await?;
    sqlx::query("PRAGMA foreign_keys=ON;")
        .execute(&pool)
        .await?;
    migrate::apply_migrations(&pool).await?;
    Ok(pool)
}

#[tokio::test]
async fn household_stats_reports_counts_per_household() -> Result<()> {
    let pool = memory_pool().await?;

    let default_id = default_household_id(&pool).await?;
    let secondary = create_household(&pool, "Secondary", None).await?;

    sqlx::query(
        "INSERT INTO notes (id, household_id, category_id, position, created_at, updated_at, z, text, color, x, y)\n         VALUES (?1, ?2, NULL, 0, 0, 0, 0, 'Default active note', '#FFFFFF', 0, 0)",
    )
    .bind("note-default-active")
    .bind(&default_id)
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO notes (id, household_id, category_id, position, created_at, updated_at, deleted_at, z, text, color, x, y)\n         VALUES (?1, ?2, NULL, 1, 0, 0, 1, 0, 'Default deleted note', '#FFFFFF', 0, 0)",
    )
    .bind("note-default-deleted")
    .bind(&default_id)
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO notes (id, household_id, category_id, position, created_at, updated_at, z, text, color, x, y)\n         VALUES (?1, ?2, NULL, 0, 0, 0, 0, 'Secondary note', '#FFFFFF', 0, 0)",
    )
    .bind("note-secondary")
    .bind(&secondary.id)
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO events (id, title, household_id, created_at, updated_at, deleted_at, tz, start_at_utc)\n         VALUES (?1, 'Default archived', ?2, 0, 0, 1, 'UTC', 0)",
    )
    .bind("event-default-deleted")
    .bind(&default_id)
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO events (id, title, household_id, created_at, updated_at, tz, start_at_utc)\n         VALUES (?1, 'Secondary active', ?2, 0, 0, 'UTC', 0)",
    )
    .bind("event-secondary")
    .bind(&secondary.id)
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO files_index (household_id, file_id, category, filename, updated_at_utc, ordinal, score_hint, size_bytes, mime, modified_at_utc, sha256)\n         VALUES (?1, ?2, 'misc', ?3, '2024-01-01T00:00:00Z', 0, 0, 0, 'application/octet-stream', NULL, NULL)",
    )
    .bind(&secondary.id)
    .bind("file-secondary")
    .bind("secondary.txt")
    .execute(&pool)
    .await?;

    let stale_ms: i64 = 180 * 24 * 60 * 60 * 1000;
    let now: i64 = 200 * 24 * 60 * 60 * 1000;

    sqlx::query(
        "INSERT INTO family_members (id, name, household_id, created_at, updated_at, position, last_verified)\n         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)",
    )
    .bind("mem-default-fresh")
    .bind("Fresh Member")
    .bind(&default_id)
    .bind(now)
    .bind(now)
    .bind(now)
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO family_members (id, name, household_id, created_at, updated_at, position, last_verified)\n         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)",
    )
    .bind("mem-default-stale")
    .bind("Stale Member")
    .bind(&default_id)
    .bind(now)
    .bind(now)
    .bind(now - stale_ms - 1)
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO family_members (id, name, household_id, created_at, updated_at, deleted_at, position)\n         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
    )
    .bind("mem-default-deleted")
    .bind("Deleted Member")
    .bind(&default_id)
    .bind(now)
    .bind(now)
    .bind(now)
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO family_members (id, name, household_id, created_at, updated_at, position, last_verified)\n         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)",
    )
    .bind("mem-secondary")
    .bind("Secondary Member")
    .bind(&secondary.id)
    .bind(now)
    .bind(now)
    .bind(now)
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO member_attachments (id, household_id, member_id, title, root_key, relative_path, mime_hint, added_at)\n         VALUES (?1, ?2, ?3, 'Passport', 'appData', 'docs/passport.pdf', 'application/pdf', ?4)",
    )
    .bind("att-active")
    .bind(&default_id)
    .bind("mem-default-fresh")
    .bind(now)
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO member_attachments (id, household_id, member_id, title, root_key, relative_path, mime_hint, added_at)\n         VALUES (?1, ?2, ?3, 'Driver licence', 'appData', 'docs/licence.pdf', 'application/pdf', ?4)",
    )
    .bind("att-deleted")
    .bind(&default_id)
    .bind("mem-default-deleted")
    .bind(now)
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO member_renewals (id, household_id, member_id, kind, label, expires_at, remind_on_expiry, remind_offset_days, created_at, updated_at)\n         VALUES (?1, ?2, ?3, 'passport', 'Renew passport', ?4, 1, 30, ?5, ?5)",
    )
    .bind("ren-active")
    .bind(&default_id)
    .bind("mem-default-fresh")
    .bind(now + stale_ms)
    .bind(now)
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO member_renewals (id, household_id, member_id, kind, label, expires_at, remind_on_expiry, remind_offset_days, created_at, updated_at)\n         VALUES (?1, ?2, ?3, 'passport', 'Old', ?4, 1, 30, ?5, ?5)",
    )
    .bind("ren-deleted")
    .bind(&default_id)
    .bind("mem-default-deleted")
    .bind(now + stale_ms)
    .bind(now)
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO notes (id, household_id, category_id, position, created_at, updated_at, z, text, color, x, y, member_id)\n         VALUES (?1, ?2, NULL, 2, ?3, ?3, 0, 'Linked note', '#FFFFFF', 0, 0, ?4)",
    )
    .bind("note-linked-active")
    .bind(&default_id)
    .bind(now)
    .bind("mem-default-fresh")
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO notes (id, household_id, category_id, position, created_at, updated_at, z, text, color, x, y, member_id)\n         VALUES (?1, ?2, NULL, 3, ?3, ?3, 0, 'Linked deleted', '#FFFFFF', 0, 0, ?4)",
    )
    .bind("note-linked-deleted")
    .bind(&default_id)
    .bind(now)
    .bind("mem-default-deleted")
    .execute(&pool)
    .await?;

    let stats = diagnostics::household_stats(&pool).await?;

    let mut default_entry = None;
    let mut secondary_entry = None;
    for entry in stats {
        if entry.id == default_id {
            default_entry = Some(entry);
        } else if entry.id == secondary.id {
            secondary_entry = Some(entry);
        }
    }

    let default_entry = default_entry.expect("default household present");
    assert_eq!(default_entry.counts.get("notes"), Some(&3));
    assert_eq!(default_entry.counts.get("events"), Some(&0));
    assert_eq!(default_entry.family.members_total, 2);
    assert_eq!(default_entry.family.attachments_total, 1);
    assert_eq!(default_entry.family.renewals_total, 1);
    assert_eq!(default_entry.family.notes_linked_total, 1);
    assert_eq!(default_entry.family.members_stale, 1);

    let secondary_entry = secondary_entry.expect("secondary household present");
    assert_eq!(secondary_entry.counts.get("notes"), Some(&1));
    assert_eq!(secondary_entry.counts.get("events"), Some(&1));
    assert_eq!(secondary_entry.counts.get("files"), Some(&1));
    assert_eq!(secondary_entry.family.members_total, 1);
    assert_eq!(secondary_entry.family.attachments_total, 0);
    assert_eq!(secondary_entry.family.renewals_total, 0);
    assert_eq!(secondary_entry.family.notes_linked_total, 0);
    assert_eq!(secondary_entry.family.members_stale, 0);

    Ok(())
}
