use anyhow::Result;
use serde_json::{Map, Value};
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
async fn notes_filter_by_category() -> Result<()> {
    let pool = setup_pool().await?;

    let mut category_payload = Map::new();
    category_payload.insert("household_id".into(), Value::from("default"));
    category_payload.insert("name".into(), Value::from("Tasks"));
    category_payload.insert("slug".into(), Value::from("tasks-temp"));
    category_payload.insert("color".into(), Value::from("#123456"));
    category_payload.insert("position".into(), Value::from(140));
    category_payload.insert("z".into(), Value::from(0));

    let category = arklowdun_lib::commands::create_command(&pool, "categories", category_payload).await?;
    let category_id = category
        .get("id")
        .and_then(Value::as_str)
        .expect("created category has id")
        .to_string();

    let mut other_category_payload = Map::new();
    other_category_payload.insert("household_id".into(), Value::from("default"));
    other_category_payload.insert("name".into(), Value::from("Errands"));
    other_category_payload.insert("slug".into(), Value::from("errands-temp"));
    other_category_payload.insert("color".into(), Value::from("#654321"));
    other_category_payload.insert("position".into(), Value::from(141));
    other_category_payload.insert("z".into(), Value::from(0));

    let other_category =
        arklowdun_lib::commands::create_command(&pool, "categories", other_category_payload).await?;
    let other_category_id = other_category
        .get("id")
        .and_then(Value::as_str)
        .expect("created category has id")
        .to_string();

    let mut note_payload = Map::new();
    note_payload.insert("household_id".into(), Value::from("default"));
    note_payload.insert("text".into(), Value::from("Pay electricity"));
    note_payload.insert("color".into(), Value::from("#FFF4B8"));
    note_payload.insert("category_id".into(), Value::from(category_id.clone()));

    let note = arklowdun_lib::commands::create_command(&pool, "notes", note_payload).await?;
    let note_id = note
        .get("id")
        .and_then(Value::as_str)
        .expect("created note has id")
        .to_string();

    let mut other_note_payload = Map::new();
    other_note_payload.insert("household_id".into(), Value::from("default"));
    other_note_payload.insert("text".into(), Value::from("Buy milk"));
    other_note_payload.insert("color".into(), Value::from("#FFF4B8"));
    other_note_payload.insert("category_id".into(), Value::from(other_category_id.clone()));

    arklowdun_lib::commands::create_command(&pool, "notes", other_note_payload).await?;

    let filtered = arklowdun_lib::repo::notes::list_with_categories(
        &pool,
        "default",
        None,
        None,
        None,
        Some(vec![category_id.clone()]),
    )
    .await?;

    assert_eq!(filtered.len(), 1, "filter returns only matching category notes");
    let first = &filtered[0];
    let fetched_id: String = first.try_get("id")?;
    assert_eq!(fetched_id, note_id);
    let fetched_category: Option<String> = first.try_get("category_id")?;
    assert_eq!(fetched_category.as_deref(), Some(category_id.as_str()));

    let unmatched = arklowdun_lib::repo::notes::list_with_categories(
        &pool,
        "default",
        None,
        None,
        None,
        Some(vec!["nonexistent".to_string()]),
    )
    .await?;
    assert!(unmatched.is_empty(), "unknown category filter returns empty");

    let other_filtered = arklowdun_lib::repo::notes::list_with_categories(
        &pool,
        "default",
        None,
        None,
        None,
        Some(vec![other_category_id.clone()]),
    )
    .await?;
    assert_eq!(other_filtered.len(), 1);

    let unfiltered = arklowdun_lib::repo::notes::list_with_categories(
        &pool,
        "default",
        None,
        None,
        None,
        None,
    )
    .await?;
    assert!(unfiltered.len() >= 2, "unfiltered query returns all notes");

    Ok(())
}
