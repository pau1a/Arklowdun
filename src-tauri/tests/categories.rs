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

    let fetched =
        arklowdun_lib::commands::get_command(&pool, "categories", Some("default"), &created_id)
            .await?
            .expect("category retrievable after create");

    assert_eq!(
        fetched.get("slug").and_then(Value::as_str),
        Some("gardening")
    );
    assert_eq!(fetched.get("is_visible").and_then(Value::as_i64), Some(0));

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

    let after_delete =
        arklowdun_lib::commands::get_command(&pool, "categories", Some("default"), &id).await?;
    assert!(after_delete.is_none(), "deleted category hidden from get");

    let deleted_at: Option<i64> =
        sqlx::query_scalar("SELECT deleted_at FROM categories WHERE id = ?")
            .bind(&id)
            .fetch_one(&pool)
            .await?;
    assert!(deleted_at.is_some(), "delete sets deleted_at");

    arklowdun_lib::commands::restore_command(&pool, "categories", "default", &id).await?;

    let restored = arklowdun_lib::commands::get_command(&pool, "categories", Some("default"), &id)
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
    arklowdun_lib::commands::update_command(&pool, "categories", &id, hide_patch, Some("default"))
        .await?;

    let hidden = arklowdun_lib::commands::get_command(&pool, "categories", Some("default"), &id)
        .await?
        .expect("category still retrievable after hide");
    assert_eq!(hidden.get("is_visible").and_then(Value::as_i64), Some(0));

    let mut show_patch = Map::new();
    show_patch.insert("is_visible".into(), Value::from(1));
    arklowdun_lib::commands::update_command(&pool, "categories", &id, show_patch, Some("default"))
        .await?;

    let shown = arklowdun_lib::commands::get_command(&pool, "categories", Some("default"), &id)
        .await?
        .expect("category readable after show");
    assert_eq!(shown.get("is_visible").and_then(Value::as_i64), Some(1));

    Ok(())
}

#[tokio::test]
async fn categories_toggle_roundtrip() -> Result<()> {
    let pool = setup_pool().await?;

    let mut payload = Map::new();
    payload.insert("household_id".into(), Value::from("default"));
    payload.insert("name".into(), Value::from("Seasonal"));
    payload.insert("slug".into(), Value::from("seasonal"));
    payload.insert("color".into(), Value::from("#AA5500"));
    payload.insert("position".into(), Value::from(140));
    payload.insert("z".into(), Value::from(0));

    let created = arklowdun_lib::commands::create_command(&pool, "categories", payload).await?;
    let id = created
        .get("id")
        .and_then(Value::as_str)
        .expect("created category has id")
        .to_string();

    let visible_before: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM categories WHERE household_id = ? AND deleted_at IS NULL AND is_visible = 1 ORDER BY position, created_at, id",
    )
    .bind("default")
    .fetch_all(&pool)
    .await?;
    assert!(
        visible_before.contains(&id),
        "category appears in visible list before hiding",
    );

    let mut hide_patch = Map::new();
    hide_patch.insert("is_visible".into(), Value::from(0));
    arklowdun_lib::commands::update_command(&pool, "categories", &id, hide_patch, Some("default"))
        .await?;

    let visible_after_hide: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM categories WHERE household_id = ? AND deleted_at IS NULL AND is_visible = 1 ORDER BY position, created_at, id",
    )
    .bind("default")
    .fetch_all(&pool)
    .await?;
    assert!(
        !visible_after_hide.contains(&id),
        "hidden category removed from visible list",
    );

    let mut show_patch = Map::new();
    show_patch.insert("is_visible".into(), Value::from(1));
    arklowdun_lib::commands::update_command(&pool, "categories", &id, show_patch, Some("default"))
        .await?;

    let visible_after_show: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM categories WHERE household_id = ? AND deleted_at IS NULL AND is_visible = 1 ORDER BY position, created_at, id",
    )
    .bind("default")
    .fetch_all(&pool)
    .await?;
    assert!(
        visible_after_show.contains(&id),
        "category returns to visible list after re-enable",
    );

    Ok(())
}

#[tokio::test]
async fn notes_hidden_category() -> Result<()> {
    let pool = setup_pool().await?;

    let mut category_payload = Map::new();
    category_payload.insert("household_id".into(), Value::from("default"));
    category_payload.insert("name".into(), Value::from("Projects"));
    category_payload.insert("slug".into(), Value::from("projects"));
    category_payload.insert("color".into(), Value::from("#005577"));
    category_payload.insert("position".into(), Value::from(160));
    category_payload.insert("z".into(), Value::from(0));

    let created_category =
        arklowdun_lib::commands::create_command(&pool, "categories", category_payload).await?;
    let category_id = created_category
        .get("id")
        .and_then(Value::as_str)
        .expect("created category has id")
        .to_string();

    let mut note_payload = Map::new();
    note_payload.insert("household_id".into(), Value::from("default"));
    note_payload.insert("category_id".into(), Value::from(category_id.clone()));
    note_payload.insert("text".into(), Value::from("Pay insurance"));

    let created_note =
        arklowdun_lib::commands::create_command(&pool, "notes", note_payload).await?;
    let note_id = created_note
        .get("id")
        .and_then(Value::as_str)
        .expect("created note has id")
        .to_string();

    let visible_notes_before: Vec<String> = sqlx::query_scalar(
        "SELECT n.id FROM notes n JOIN categories c ON n.category_id = c.id WHERE n.household_id = ? AND n.deleted_at IS NULL AND c.is_visible = 1",
    )
    .bind("default")
    .fetch_all(&pool)
    .await?;
    assert!(
        visible_notes_before.contains(&note_id),
        "note visible while category is enabled",
    );

    let mut hide_patch = Map::new();
    hide_patch.insert("is_visible".into(), Value::from(0));
    arklowdun_lib::commands::update_command(
        &pool,
        "categories",
        &category_id,
        hide_patch,
        Some("default"),
    )
    .await?;

    let stored_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM notes WHERE id = ?")
        .bind(&note_id)
        .fetch_one(&pool)
        .await?;
    assert_eq!(stored_count, 1, "hidden category does not delete note");

    let visible_notes_hidden: Vec<String> = sqlx::query_scalar(
        "SELECT n.id FROM notes n JOIN categories c ON n.category_id = c.id WHERE n.household_id = ? AND n.deleted_at IS NULL AND c.is_visible = 1",
    )
    .bind("default")
    .fetch_all(&pool)
    .await?;
    assert!(
        !visible_notes_hidden.contains(&note_id),
        "note excluded while category hidden",
    );

    let mut show_patch = Map::new();
    show_patch.insert("is_visible".into(), Value::from(1));
    arklowdun_lib::commands::update_command(
        &pool,
        "categories",
        &category_id,
        show_patch,
        Some("default"),
    )
    .await?;

    let visible_notes_after: Vec<String> = sqlx::query_scalar(
        "SELECT n.id FROM notes n JOIN categories c ON n.category_id = c.id WHERE n.household_id = ? AND n.deleted_at IS NULL AND c.is_visible = 1",
    )
    .bind("default")
    .fetch_all(&pool)
    .await?;
    assert!(
        visible_notes_after.contains(&note_id),
        "note returns after category re-enabled",
    );

    Ok(())
}
