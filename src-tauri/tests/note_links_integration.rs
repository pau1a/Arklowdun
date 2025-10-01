use arklowdun_lib::{
    migrate,
    note_links::{
        create_link, get_link_for_note, list_notes_for_entity, quick_create_note_for_entity,
        NoteLinkEntityType,
    },
};
use sqlx::SqlitePool;
use uuid::Uuid;

async fn setup_pool() -> SqlitePool {
    let pool = SqlitePool::connect("sqlite::memory:")
        .await
        .expect("connect sqlite memory");
    migrate::apply_migrations(&pool)
        .await
        .expect("apply migrations");
    pool
}

async fn insert_household(pool: &SqlitePool, id: &str) {
    let now = 1_700_000_000_000i64;
    sqlx::query(
        "INSERT INTO household (id, name, created_at, updated_at, deleted_at, tz)
         VALUES (?1, ?2, ?3, ?3, NULL, 'UTC')",
    )
    .bind(id)
    .bind(format!("Household {id}"))
    .bind(now)
    .execute(pool)
    .await
    .expect("insert household");
}

async fn insert_note(
    pool: &SqlitePool,
    household_id: &str,
    category_id: &str,
    position: i64,
    created_at: i64,
    text: &str,
) -> String {
    let id = Uuid::now_v7().to_string();
    sqlx::query(
        "INSERT INTO notes (id, household_id, category_id, position, created_at, updated_at, z, text, color, x, y)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7, '#FFF4B8', 0.0, 0.0)",
    )
    .bind(&id)
    .bind(household_id)
    .bind(category_id)
    .bind(position)
    .bind(created_at)
    .bind(position)
    .bind(text)
    .execute(pool)
    .await
    .expect("insert note");
    id
}

async fn insert_event(
    pool: &SqlitePool,
    household_id: &str,
    title: &str,
    timestamp: i64,
) -> String {
    let id = Uuid::now_v7().to_string();
    sqlx::query(
        "INSERT INTO events (id, title, reminder, household_id, created_at, updated_at, deleted_at, tz, start_at_utc)
         VALUES (?1, ?2, NULL, ?3, ?4, ?4, NULL, 'UTC', ?5)",
    )
    .bind(&id)
    .bind(title)
    .bind(household_id)
    .bind(timestamp)
    .bind(timestamp)
    .execute(pool)
    .await
    .expect("insert event");
    id
}

async fn insert_file(
    pool: &SqlitePool,
    household_id: &str,
    filename: &str,
    ordinal: i64,
) -> String {
    let file_id = Uuid::now_v7().to_string();
    sqlx::query(
        "INSERT INTO files_index (
             household_id,
             file_id,
             filename,
             updated_at_utc,
             ordinal,
             score_hint
         ) VALUES (?1, ?2, ?3, ?4, ?5, 0)",
    )
    .bind(household_id)
    .bind(&file_id)
    .bind(filename)
    .bind("2024-01-01T00:00:00Z")
    .bind(ordinal)
    .execute(pool)
    .await
    .expect("insert file");
    file_id
}

#[tokio::test]
async fn cross_household_rejected() {
    let pool = setup_pool().await;
    insert_household(&pool, "other").await;
    let note_id = insert_note(&pool, "default", "cat_primary", 0, 1, "Default note").await;
    let event_id = insert_event(&pool, "other", "Other household event", 1).await;

    let err = create_link(
        &pool,
        "default",
        &note_id,
        NoteLinkEntityType::Event,
        &event_id,
        None,
    )
    .await
    .expect_err("cross household link should fail");

    assert_eq!(err.code(), "NOTE_LINK/CROSS_HOUSEHOLD");
}

#[tokio::test]
async fn entity_not_found() {
    let pool = setup_pool().await;
    let note_id = insert_note(&pool, "default", "cat_primary", 0, 1, "Detached").await;

    let err = create_link(
        &pool,
        "default",
        &note_id,
        NoteLinkEntityType::Event,
        "missing-event",
        None,
    )
    .await
    .expect_err("missing entity should fail");

    assert_eq!(err.code(), "NOTE_LINK/ENTITY_NOT_FOUND");
}

#[tokio::test]
async fn duplicate_link_is_rejected() {
    let pool = setup_pool().await;
    let event_id = insert_event(&pool, "default", "Team sync", 1).await;
    let note_id = insert_note(&pool, "default", "cat_primary", 0, 1, "Agenda").await;

    create_link(
        &pool,
        "default",
        &note_id,
        NoteLinkEntityType::Event,
        &event_id,
        None,
    )
    .await
    .expect("first link succeeds");

    let err = create_link(
        &pool,
        "default",
        &note_id,
        NoteLinkEntityType::Event,
        &event_id,
        None,
    )
    .await
    .expect_err("duplicate link should fail");

    assert_eq!(err.code(), "NOTE_LINK/ALREADY_EXISTS");
}

#[tokio::test]
async fn list_filters_by_category_ids() {
    let pool = setup_pool().await;
    let event_id = insert_event(&pool, "default", "Town hall", 1).await;
    let note_primary = insert_note(&pool, "default", "cat_primary", 0, 1, "Primary note").await;
    let note_secondary =
        insert_note(&pool, "default", "cat_secondary", 1, 2, "Secondary note").await;

    create_link(
        &pool,
        "default",
        &note_primary,
        NoteLinkEntityType::Event,
        &event_id,
        None,
    )
    .await
    .expect("link primary");
    create_link(
        &pool,
        "default",
        &note_secondary,
        NoteLinkEntityType::Event,
        &event_id,
        None,
    )
    .await
    .expect("link secondary");

    let page = list_notes_for_entity(
        &pool,
        "default",
        NoteLinkEntityType::Event,
        &event_id,
        Some(vec!["cat_primary".to_string()]),
        None,
        Some(10),
    )
    .await
    .expect("list notes");

    assert_eq!(page.notes.len(), 1);
    assert_eq!(page.notes[0].id, note_primary);
}

#[tokio::test]
async fn file_links_are_supported() {
    let pool = setup_pool().await;
    let file_id = insert_file(&pool, "default", "transcript.txt", 1).await;
    let note_id = insert_note(&pool, "default", "cat_primary", 0, 1, "Attached note").await;

    let link = create_link(
        &pool,
        "default",
        &note_id,
        NoteLinkEntityType::File,
        &file_id,
        None,
    )
    .await
    .expect("file link succeeds");

    assert_eq!(link.entity_id, file_id);

    let page = list_notes_for_entity(
        &pool,
        "default",
        NoteLinkEntityType::File,
        &file_id,
        None,
        None,
        Some(10),
    )
    .await
    .expect("list file notes");

    assert_eq!(page.notes.len(), 1);
    assert_eq!(page.notes[0].id, note_id);
}

#[tokio::test]
async fn quick_create_is_atomic() {
    let pool = setup_pool().await;
    let event_id = insert_event(&pool, "default", "Retro", 1).await;

    let err = quick_create_note_for_entity(
        &pool,
        "default",
        NoteLinkEntityType::Event,
        &event_id,
        "missing-category",
        "Should fail",
        None,
    )
    .await
    .expect_err("invalid category should fail");

    assert!(
        err.code().starts_with("Sqlite/"),
        "expected sqlite constraint error, got {}",
        err.code()
    );

    let link_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM note_links")
        .fetch_one(&pool)
        .await
        .expect("count links");
    assert_eq!(link_count, 0, "no links inserted on failure");

    let note_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM notes")
        .fetch_one(&pool)
        .await
        .expect("count notes");
    assert_eq!(note_count, 0, "no notes inserted on failure");
}

#[tokio::test]
async fn recurring_series_parent_notes_visible_to_instances() {
    let pool = setup_pool().await;
    let event_id = insert_event(&pool, "default", "Weekly sync", 1).await;
    let note_id = insert_note(&pool, "default", "cat_primary", 0, 1, "Agenda").await;

    create_link(
        &pool,
        "default",
        &note_id,
        NoteLinkEntityType::Event,
        &event_id,
        None,
    )
    .await
    .expect("link parent event");

    let instance_id = format!("{event_id}::{}", 1_700_000_000_000i64);
    let page = list_notes_for_entity(
        &pool,
        "default",
        NoteLinkEntityType::Event,
        &instance_id,
        None,
        None,
        Some(10),
    )
    .await
    .expect("list instance notes");

    assert_eq!(page.notes.len(), 1, "instance inherits parent notes");
    assert_eq!(page.links.len(), 1, "instance returns matching link");
    assert_eq!(page.links[0].entity_id, event_id, "link anchored to parent");
}

#[tokio::test]
async fn recurring_instance_link_normalises_to_parent() {
    let pool = setup_pool().await;
    let event_id = insert_event(&pool, "default", "Daily standup", 1).await;
    let note_id = insert_note(&pool, "default", "cat_primary", 0, 1, "Talking points").await;

    let instance_id = format!("{event_id}::{}", 1_700_123_456_789i64);
    let link = create_link(
        &pool,
        "default",
        &note_id,
        NoteLinkEntityType::Event,
        &instance_id,
        None,
    )
    .await
    .expect("link recurring instance");

    assert_eq!(link.entity_id, event_id, "returned link uses parent id");

    let stored_entity_id: String =
        sqlx::query_scalar("SELECT entity_id FROM note_links WHERE id = ?1")
            .bind(&link.id)
            .fetch_one(&pool)
            .await
            .expect("fetch stored entity id");
    assert_eq!(stored_entity_id, event_id, "link stored with parent id");

    let other_instance = format!("{event_id}::{}", 1_700_987_654_321i64);
    let page = list_notes_for_entity(
        &pool,
        "default",
        NoteLinkEntityType::Event,
        &other_instance,
        None,
        None,
        Some(10),
    )
    .await
    .expect("list other instance notes");

    assert_eq!(page.notes.len(), 1, "other instance sees shared note");
    let fetched_link = get_link_for_note(
        &pool,
        "default",
        &note_id,
        NoteLinkEntityType::Event,
        &other_instance,
    )
    .await
    .expect("retrieve link by instance");
    assert_eq!(
        fetched_link.entity_id, event_id,
        "link lookup resolves to parent"
    );
}

#[tokio::test]
async fn pagination_is_stable() {
    let pool = setup_pool().await;
    let event_id = insert_event(&pool, "default", "Planning", 1).await;

    let mut expected_ids = Vec::new();
    for idx in 0..25 {
        let note_id = insert_note(
            &pool,
            "default",
            "cat_primary",
            idx as i64,
            idx as i64 + 1,
            &format!("Note {idx}"),
        )
        .await;
        create_link(
            &pool,
            "default",
            &note_id,
            NoteLinkEntityType::Event,
            &event_id,
            None,
        )
        .await
        .expect("link note");
        expected_ids.push(note_id);
    }

    let first_page = list_notes_for_entity(
        &pool,
        "default",
        NoteLinkEntityType::Event,
        &event_id,
        None,
        None,
        Some(20),
    )
    .await
    .expect("first page");

    assert_eq!(first_page.notes.len(), 20, "first page size");
    let cursor = first_page.next_cursor.clone().expect("cursor present");
    let second_page = list_notes_for_entity(
        &pool,
        "default",
        NoteLinkEntityType::Event,
        &event_id,
        None,
        Some(cursor),
        Some(20),
    )
    .await
    .expect("second page");

    assert_eq!(second_page.notes.len(), 5, "remaining notes");

    let mut combined: Vec<String> = first_page
        .notes
        .into_iter()
        .chain(second_page.notes.into_iter())
        .map(|note| note.id)
        .collect();
    combined.sort();
    let mut expected_sorted = expected_ids.clone();
    expected_sorted.sort();

    assert_eq!(combined, expected_sorted, "all notes returned exactly once");
}
