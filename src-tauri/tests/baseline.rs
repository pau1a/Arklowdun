#![allow(clippy::unwrap_used, clippy::expect_used)]

use anyhow::Result;
use sqlx::{Row, SqlitePool};

async fn setup_pool() -> Result<SqlitePool> {
    let pool = SqlitePool::connect("sqlite::memory:")
        .await
        .expect("connect in-memory sqlite");
    arklowdun_lib::migrate::apply_migrations(&pool)
        .await
        .expect("apply baseline");
    Ok(pool)
}

#[tokio::test]
async fn baseline_seeds_categories() -> Result<()> {
    let pool = setup_pool().await?;

    let household: (String, String) =
        sqlx::query_as("SELECT id, name FROM household ORDER BY id LIMIT 1")
            .fetch_one(&pool)
            .await?;
    assert_eq!(household.0, "default");
    assert_eq!(household.1, "Default Household");

    let rows = sqlx::query(
        "SELECT id, name, slug, color, position, z, created_at, updated_at
         FROM categories
         WHERE household_id = 'default' AND deleted_at IS NULL
         ORDER BY position",
    )
    .fetch_all(&pool)
    .await?;

    let expected = [
        ("cat_primary", "Primary", "primary", "#4F46E5"),
        ("cat_secondary", "Secondary", "secondary", "#1D4ED8"),
        ("cat_tasks", "Tasks", "tasks", "#0EA5E9"),
        ("cat_bills", "Bills", "bills", "#F59E0B"),
        ("cat_insurance", "Insurance", "insurance", "#EA580C"),
        ("cat_property", "Property", "property", "#F97316"),
        ("cat_vehicles", "Vehicles", "vehicles", "#22C55E"),
        ("cat_pets", "Pets", "pets", "#16A34A"),
        ("cat_family", "Family", "family", "#EF4444"),
        ("cat_inventory", "Inventory", "inventory", "#C026D3"),
        ("cat_budget", "Budget", "budget", "#A855F7"),
        ("cat_shopping", "Shopping", "shopping", "#6366F1"),
    ];
    assert_eq!(rows.len(), expected.len());

    for (idx, row) in rows.iter().enumerate() {
        let (id, name, slug, color, position, z, created_at, updated_at) = (
            row.try_get::<String, _>("id")?,
            row.try_get::<String, _>("name")?,
            row.try_get::<String, _>("slug")?,
            row.try_get::<String, _>("color")?,
            row.try_get::<i64, _>("position")?,
            row.try_get::<i64, _>("z")?,
            row.try_get::<i64, _>("created_at")?,
            row.try_get::<i64, _>("updated_at")?,
        );
        assert_eq!(id, expected[idx].0);
        assert_eq!(name, expected[idx].1);
        assert_eq!(slug, expected[idx].2);
        assert_eq!(color, expected[idx].3);
        assert_eq!(position, idx as i64);
        assert_eq!(z, 0);
        assert_eq!(created_at, 1_672_531_200_000);
        assert_eq!(updated_at, 1_672_531_200_000);
    }

    let idx_exists: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM sqlite_master WHERE type='index' AND name='notes_deadline_idx'",
    )
    .fetch_optional(&pool)
    .await?;
    assert_eq!(idx_exists, Some(1));

    Ok(())
}

#[tokio::test]
async fn notes_round_trip_persists_all_fields() -> Result<()> {
    let pool = setup_pool().await?;

    sqlx::query(
        "INSERT INTO notes
           (id, household_id, position, created_at, updated_at, deleted_at,
            z, text, color, x, y, deadline, deadline_tz)
         VALUES
           ('note_1', 'default', 0, 2000, 2000, NULL,
            5, 'Content', '#ABCDEF', 10.5, -3.25, 5000, 'UTC')",
    )
    .execute(&pool)
    .await?;

    let row = sqlx::query(
        "SELECT text, color, x, y, z, deadline, deadline_tz
           FROM notes WHERE id = 'note_1'",
    )
    .fetch_one(&pool)
    .await?;

    assert_eq!(row.try_get::<String, _>("text")?, "Content");
    assert_eq!(row.try_get::<String, _>("color")?, "#ABCDEF");
    assert_eq!(row.try_get::<f64, _>("x")?, 10.5);
    assert_eq!(row.try_get::<f64, _>("y")?, -3.25);
    assert_eq!(row.try_get::<i64, _>("z")?, 5);
    assert_eq!(row.try_get::<Option<i64>, _>("deadline")?, Some(5000));
    assert_eq!(
        row.try_get::<Option<String>, _>("deadline_tz")?,
        Some("UTC".to_string())
    );

    Ok(())
}

#[tokio::test]
async fn notes_are_scoped_by_household() -> Result<()> {
    let pool = setup_pool().await?;

    sqlx::query(
        "INSERT INTO notes
           (id, household_id, position, created_at, updated_at, z, text, color, x, y)
         VALUES ('note_scope', 'default', 0, 10, 10, 1, 'scope', '#FFFF88', 0, 0)",
    )
    .execute(&pool)
    .await?;

    let count_default: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM notes WHERE household_id = 'default' AND deleted_at IS NULL",
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(count_default, 1);

    let count_other: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM notes WHERE household_id = 'other' AND deleted_at IS NULL",
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(count_other, 0);

    Ok(())
}
