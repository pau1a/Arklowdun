use anyhow::Result;
use sqlx::SqlitePool;
use uuid::Uuid;

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
async fn notes_filter_by_category() -> Result<()> {
    let pool = setup_pool().await?;
    let now = now_ms();

    let category_id = Uuid::now_v7().to_string();
    sqlx::query(
        r#"
        INSERT INTO categories (id, household_id, name, slug, color, position, z, is_visible, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
        "#,
    )
    .bind(&category_id)
    .bind("default")
    .bind("Tasks")
    .bind(format!("tasks-{}", &category_id[..8]))
    .bind("#123456")
    .bind(140_i64)
    .bind(0_i64)
    .bind(1_i64)
    .bind(now)
    .execute(&pool)
    .await?;

    let other_category_id = Uuid::now_v7().to_string();
    sqlx::query(
        r#"
        INSERT INTO categories (id, household_id, name, slug, color, position, z, is_visible, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
        "#,
    )
    .bind(&other_category_id)
    .bind("default")
    .bind("Errands")
    .bind(format!("errands-{}", &other_category_id[..8]))
    .bind("#654321")
    .bind(141_i64)
    .bind(0_i64)
    .bind(1_i64)
    .bind(now + 1)
    .execute(&pool)
    .await?;

    let note_id = Uuid::now_v7().to_string();
    sqlx::query(
        r#"
        INSERT INTO notes (id, household_id, category_id, position, created_at, updated_at, z, text, color, x, y)
        VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7, ?8, ?9, ?10)
        "#,
    )
    .bind(&note_id)
    .bind("default")
    .bind(&category_id)
    .bind(0_i64)
    .bind(now)
    .bind(0_i64)
    .bind("Pay electricity")
    .bind("#FFF4B8")
    .bind(0_f64)
    .bind(0_f64)
    .execute(&pool)
    .await?;

    let other_note_id = Uuid::now_v7().to_string();
    sqlx::query(
        r#"
        INSERT INTO notes (id, household_id, category_id, position, created_at, updated_at, z, text, color, x, y)
        VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7, ?8, ?9, ?10)
        "#,
    )
    .bind(&other_note_id)
    .bind("default")
    .bind(&other_category_id)
    .bind(0_i64)
    .bind(now)
    .bind(0_i64)
    .bind("Buy milk")
    .bind("#FFF4B8")
    .bind(0_f64)
    .bind(0_f64)
    .execute(&pool)
    .await?;

    let filtered: Vec<String> = sqlx::query_scalar(
        r#"
        SELECT id FROM notes
        WHERE household_id = ?1
          AND deleted_at IS NULL
          AND category_id IN (?2)
        ORDER BY position, created_at, id
        "#,
    )
    .bind("default")
    .bind(&category_id)
    .fetch_all(&pool)
    .await?;

    assert_eq!(
        filtered,
        vec![note_id.clone()],
        "filter returns only matching category notes"
    );

    let fetched_category: Option<String> =
        sqlx::query_scalar("SELECT category_id FROM notes WHERE id = ?1")
            .bind(&note_id)
            .fetch_one(&pool)
            .await?;
    assert_eq!(fetched_category.as_deref(), Some(category_id.as_str()));

    let unmatched: Vec<String> = sqlx::query_scalar(
        r#"
        SELECT id FROM notes
        WHERE household_id = ?1
          AND deleted_at IS NULL
          AND category_id IN (?2)
        ORDER BY position, created_at, id
        "#,
    )
    .bind("default")
    .bind("nonexistent")
    .fetch_all(&pool)
    .await?;
    assert!(
        unmatched.is_empty(),
        "unknown category filter returns empty"
    );

    let other_filtered: Vec<String> = sqlx::query_scalar(
        r#"
        SELECT id FROM notes
        WHERE household_id = ?1
          AND deleted_at IS NULL
          AND category_id IN (?2)
        ORDER BY position, created_at, id
        "#,
    )
    .bind("default")
    .bind(&other_category_id)
    .fetch_all(&pool)
    .await?;
    assert_eq!(other_filtered, vec![other_note_id.clone()]);

    let unfiltered: Vec<String> = sqlx::query_scalar(
        r#"
        SELECT id FROM notes
        WHERE household_id = ?1
          AND deleted_at IS NULL
        ORDER BY position, created_at, id
        "#,
    )
    .bind("default")
    .fetch_all(&pool)
    .await?;
    assert!(unfiltered.len() >= 2, "unfiltered query returns all notes");

    Ok(())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system time before epoch")
        .as_millis() as i64
}
