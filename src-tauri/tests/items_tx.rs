use anyhow::Result;
use arklowdun_lib::commands;

#[path = "util.rs"]
mod util;

async fn setup_table(pool: &sqlx::SqlitePool, table: &str) -> Result<()> {
    sqlx::query(
        "CREATE TABLE household (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);",
    )
    .execute(pool)
    .await?;
    let sql = format!(
        "CREATE TABLE {table} (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  FOREIGN KEY(household_id) REFERENCES household(id)
);"
    );
    sqlx::query(&sql).execute(pool).await?;
    sqlx::query(
        "INSERT INTO household (id, name, created_at, updated_at) VALUES ('H', 'hh', 0, 0)",
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[tokio::test]
async fn delete_commits_and_renumbers() -> Result<()> {
    for table in ["inventory_items", "shopping_items"] {
        let pool = util::temp_pool().await;
        setup_table(&pool, table).await?;
        for (id, pos) in [("a", 0), ("b", 1), ("c", 2)] {
            sqlx::query(&format!(
                "INSERT INTO {table} (id, household_id, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
            ))
            .bind(id)
            .bind("H")
            .bind(pos)
            .bind(0)
            .bind(0)
            .execute(&pool)
            .await?;
        }

        commands::delete_command(&pool, table, "H", "b", None)
            .await
            .unwrap();

        let deleted_at: Option<i64> =
            sqlx::query_scalar(&format!("SELECT deleted_at FROM {table} WHERE id='b'"))
                .fetch_one(&pool)
                .await?;
        assert!(deleted_at.is_some());

        let rows: Vec<(String, i64)> = sqlx::query_as(&format!(
            "SELECT id, position FROM {table} WHERE deleted_at IS NULL ORDER BY position"
        ))
        .fetch_all(&pool)
        .await?;
        assert_eq!(rows, vec![("a".into(), 0), ("c".into(), 1)]);
    }
    Ok(())
}

#[tokio::test]
async fn restore_commits_and_renumbers() -> Result<()> {
    for table in ["inventory_items", "shopping_items"] {
        let pool = util::temp_pool().await;
        setup_table(&pool, table).await?;
        for (id, pos) in [("a", 0), ("b", 1), ("c", 2)] {
            sqlx::query(&format!(
                "INSERT INTO {table} (id, household_id, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
            ))
            .bind(id)
            .bind("H")
            .bind(pos)
            .bind(0)
            .bind(0)
            .execute(&pool)
            .await?;
        }
        sqlx::query(&format!("UPDATE {table} SET deleted_at = 1 WHERE id = 'b'"))
            .execute(&pool)
            .await?;

        commands::restore_command(&pool, table, "H", "b")
            .await
            .unwrap();

        let deleted_at: Option<i64> =
            sqlx::query_scalar(&format!("SELECT deleted_at FROM {table} WHERE id='b'"))
                .fetch_one(&pool)
                .await?;
        assert!(deleted_at.is_none());

        let rows: Vec<(String, i64)> = sqlx::query_as(&format!(
            "SELECT id, position FROM {table} WHERE deleted_at IS NULL ORDER BY position"
        ))
        .fetch_all(&pool)
        .await?;
        assert_eq!(
            rows,
            vec![("a".into(), 0), ("c".into(), 1), ("b".into(), 2)]
        );
    }
    Ok(())
}

#[tokio::test]
async fn nonexistent_item_errors_and_no_change() -> Result<()> {
    for table in ["inventory_items", "shopping_items"] {
        let pool = util::temp_pool().await;
        setup_table(&pool, table).await?;
        for (id, pos) in [("a", 0), ("b", 1)] {
            sqlx::query(&format!(
                "INSERT INTO {table} (id, household_id, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
            ))
            .bind(id)
            .bind("H")
            .bind(pos)
            .bind(0)
            .bind(0)
            .execute(&pool)
            .await?;
        }
        let before: Vec<(String, i64, Option<i64>)> = sqlx::query_as(&format!(
            "SELECT id, position, deleted_at FROM {table} ORDER BY id"
        ))
        .fetch_all(&pool)
        .await?;

        let res = commands::delete_command(&pool, table, "H", "zzz", None).await;
        assert!(res.is_err());
        let after: Vec<(String, i64, Option<i64>)> = sqlx::query_as(&format!(
            "SELECT id, position, deleted_at FROM {table} ORDER BY id"
        ))
        .fetch_all(&pool)
        .await?;
        assert_eq!(before, after);

        let res = commands::restore_command(&pool, table, "H", "zzz").await;
        assert!(res.is_err());
        let after_restore: Vec<(String, i64, Option<i64>)> = sqlx::query_as(&format!(
            "SELECT id, position, deleted_at FROM {table} ORDER BY id"
        ))
        .fetch_all(&pool)
        .await?;
        assert_eq!(before, after_restore);
    }
    Ok(())
}
