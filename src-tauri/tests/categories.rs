use anyhow::Result;
use serde_json::{Map, Value};
use sqlx::SqlitePool;

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
async fn categories_list_returns_seeded_rows() -> Result<()> {
    let pool = setup_pool().await?;

    let rows = arklowdun_lib::commands::list_command(
        &pool,
        "categories",
        "default",
        Some("position, created_at, id"),
        None,
        None,
    )
    .await?;

    assert!(!rows.is_empty(), "expected seeded categories");
    let slugs: Vec<&str> = rows
        .iter()
        .filter_map(|value| value.as_object())
        .filter_map(|map| map.get("slug").and_then(Value::as_str))
        .collect();
    assert!(slugs.contains(&"primary"));

    for value in rows {
        let obj = value
            .as_object()
            .expect("list_command returns object values");
        let visible = obj
            .get("is_visible")
            .and_then(Value::as_i64)
            .unwrap_or_default();
        assert_eq!(visible, 1, "seeded categories start visible");
    }

    Ok(())
}

#[tokio::test]
async fn categories_create_and_get_round_trip() -> Result<()> {
    let pool = setup_pool().await?;

    let mut payload = Map::new();
    payload.insert("household_id".into(), Value::from("default"));
    payload.insert("name".into(), Value::from("Gardening"));
    payload.insert("slug".into(), Value::from("gardening"));
    payload.insert("color".into(), Value::from("#008000"));
    payload.insert("position".into(), Value::from(99));
    payload.insert("z".into(), Value::from(3));
    payload.insert("is_visible".into(), Value::from(0));

    let created = arklowdun_lib::commands::create_command(&pool, "categories", payload).await?;
    let created_id = created
        .get("id")
        .and_then(Value::as_str)
        .expect("created category has id")
        .to_string();

    let fetched = arklowdun_lib::commands::get_command(
        &pool,
        "categories",
        Some("default"),
        &created_id,
    )
    .await?
    .expect("category retrievable after create");

    assert_eq!(
        fetched.get("slug").and_then(Value::as_str),
        Some("gardening")
    );
    assert_eq!(
        fetched.get("is_visible").and_then(Value::as_i64),
        Some(0)
    );

    Ok(())
}

#[tokio::test]
async fn categories_delete_and_restore_softly() -> Result<()> {
    let pool = setup_pool().await?;

    let mut payload = Map::new();
    payload.insert("household_id".into(), Value::from("default"));
    payload.insert("name".into(), Value::from("Archive"));
    payload.insert("slug".into(), Value::from("archive"));
    payload.insert("color".into(), Value::from("#444444"));
    payload.insert("position".into(), Value::from(120));
    payload.insert("z".into(), Value::from(0));

    let created = arklowdun_lib::commands::create_command(&pool, "categories", payload).await?;
    let id = created
        .get("id")
        .and_then(Value::as_str)
        .expect("created category has id")
        .to_string();

    arklowdun_lib::commands::delete_command(&pool, "categories", "default", &id).await?;

    let after_delete = arklowdun_lib::commands::get_command(
        &pool,
        "categories",
        Some("default"),
        &id,
    )
    .await?;
    assert!(after_delete.is_none(), "deleted category hidden from get");

    let deleted_at: Option<i64> = sqlx::query_scalar("SELECT deleted_at FROM categories WHERE id = ?")
        .bind(&id)
        .fetch_one(&pool)
        .await?;
    assert!(deleted_at.is_some(), "delete sets deleted_at");

    arklowdun_lib::commands::restore_command(&pool, "categories", "default", &id).await?;

    let restored = arklowdun_lib::commands::get_command(
        &pool,
        "categories",
        Some("default"),
        &id,
    )
    .await?
    .expect("restored category readable");
    assert!(
        restored.get("deleted_at").and_then(Value::as_i64).is_none(),
        "restore clears deleted_at"
    );

    Ok(())
}

#[tokio::test]
async fn categories_toggle_updates_is_visible() -> Result<()> {
    let pool = setup_pool().await?;

    let mut payload = Map::new();
    payload.insert("household_id".into(), Value::from("default"));
    payload.insert("name".into(), Value::from("Seasonal"));
    payload.insert("slug".into(), Value::from("seasonal"));
    payload.insert("color".into(), Value::from("#AA5500"));
    payload.insert("position".into(), Value::from(130));
    payload.insert("z".into(), Value::from(0));

    let created = arklowdun_lib::commands::create_command(&pool, "categories", payload).await?;
    let id = created
        .get("id")
        .and_then(Value::as_str)
        .expect("created category has id")
        .to_string();

    let mut hide_patch = Map::new();
    hide_patch.insert("is_visible".into(), Value::from(0));
    arklowdun_lib::commands::update_command(
        &pool,
        "categories",
        &id,
        hide_patch,
        Some("default"),
    )
    .await?;

    let hidden = arklowdun_lib::commands::get_command(
        &pool,
        "categories",
        Some("default"),
        &id,
    )
    .await?
    .expect("category still retrievable after hide");
    assert_eq!(hidden.get("is_visible").and_then(Value::as_i64), Some(0));

    let mut show_patch = Map::new();
    show_patch.insert("is_visible".into(), Value::from(1));
    arklowdun_lib::commands::update_command(
        &pool,
        "categories",
        &id,
        show_patch,
        Some("default"),
    )
    .await?;

    let shown = arklowdun_lib::commands::get_command(
        &pool,
        "categories",
        Some("default"),
        &id,
    )
    .await?
    .expect("category readable after show");
    assert_eq!(shown.get("is_visible").and_then(Value::as_i64), Some(1));

    Ok(())
}
