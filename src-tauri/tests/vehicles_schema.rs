use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, RwLock};

use anyhow::Result;
use serde_json::{json, Map, Value};
use sqlx::SqlitePool;
use tauri::{App, Manager};
use tempfile::TempDir;

use arklowdun_lib::{
    db, events_tz_backfill::BackfillCoordinator, files_indexer::FilesIndexer,
    household_active::StoreHandle, migrate, pets::metrics::PetAttachmentMetrics, vault::Vault,
    vault_migration::VaultMigrationManager, vehicles_create, vehicles_delete, vehicles_get,
    vehicles_restore, vehicles_update, AppState,
};

fn build_app(state: AppState) -> App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            vehicles_get,
            vehicles_create,
            vehicles_update,
            vehicles_delete,
            vehicles_restore
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build tauri app")
}

async fn build_app_state(
    dir: &TempDir,
) -> Result<(App<tauri::test::MockRuntime>, SqlitePool, PathBuf)> {
    let db_path = dir.path().join("vehicles.sqlite");
    let pool = SqlitePool::connect(&format!("sqlite://{}", db_path.display())).await?;
    sqlx::query("PRAGMA foreign_keys=ON;")
        .execute(&pool)
        .await?;
    migrate::apply_migrations(&pool).await?;

    let attachments_root = dir.path().join("attachments");
    std::fs::create_dir_all(&attachments_root)?;
    let vault = Arc::new(Vault::new(&attachments_root));
    let files_indexer = Arc::new(FilesIndexer::new(pool.clone(), vault.clone()));
    let health = db::health::run_health_checks(&pool, &db_path).await?;

    let state = AppState {
        pool: Arc::new(RwLock::new(pool.clone())),
        active_household_id: Arc::new(Mutex::new(String::new())),
        store: StoreHandle::in_memory(),
        backfill: Arc::new(Mutex::new(BackfillCoordinator::new())),
        db_health: Arc::new(Mutex::new(health)),
        db_path: Arc::new(db_path.clone()),
        vault,
        vault_migration: Arc::new(VaultMigrationManager::new(&attachments_root)?),
        maintenance: Arc::new(AtomicBool::new(false)),
        files_indexer,
        pet_metrics: Arc::new(PetAttachmentMetrics::new()),
    };

    Ok((build_app(state), pool, db_path))
}

fn as_object(value: Value) -> Map<String, Value> {
    value.as_object().cloned().expect("expected object")
}

#[tokio::test]
async fn vehicles_round_trip_fields_preserved() -> Result<()> {
    let dir = TempDir::new()?;
    let (app, _pool, _db_path) = build_app_state(&dir).await?;

    let payload = json!({
        "household_id": "default",
        "name": "Fleet Car",
        "make": "Tesla",
        "model": "Model S",
        "trim": "Long Range",
        "model_year": 2022,
        "colour_primary": "White",
        "body_type": "Saloon",
        "doors": 4,
        "seats": 5,
        "transmission": "automatic",
        "drivetrain": "AWD",
        "fuel_type_primary": "electric",
        "engine_kw": 340,
        "emissions_co2_gkm": 0,
        "mot_date": 1672531200000_i64,
        "service_date": 1675123200000_i64,
        "mot_last_date": 1640995200000_i64,
        "ved_expiry_date": 1703980800000_i64,
        "insurance_provider": "Direct Line",
        "insurance_policy_number": "POL-001",
        "insurance_start_date": 1672444800000_i64,
        "insurance_end_date": 1703980800000_i64,
        "breakdown_provider": "AA",
        "purchase_date": 1669852800000_i64,
        "purchase_price": 7545000_i64,
        "seller_name": "Arc Motors",
        "odometer_at_purchase": 1200,
        "finance_lender": "NatWest",
        "finance_monthly_payment": 0,
        "odometer_unit": "mi",
        "odometer_current": 18250,
        "odometer_updated_at": 1704067200000_i64,
        "service_interval_miles": 10000,
        "service_interval_months": 12,
        "next_service_due_date": 1706659200000_i64,
        "next_service_due_miles": 28000,
        "cambelt_due_date": 1738195200000_i64,
        "cambelt_due_miles": 60000,
        "tyre_size_front": "225/45 R17",
        "tyre_pressure_front_psi": 36,
        "oil_grade": "0W-20",
        "next_mot_due": 1703980800000_i64,
        "next_service_due": 1706659200000_i64,
        "next_ved_due": 1709251200000_i64,
        "next_insurance_due": 1703980800000_i64,
        "primary_driver_id": "driver_default",
        "additional_driver_ids": "[\"driver_default_2\"]",
        "key_count": 2,
        "has_spare_key": true,
        "hero_image_path": "images/veh_default_01.jpg",
        "default_attachment_root_key": "attachments",
        "default_attachment_folder_relpath": "vehicles/veh_default_01",
        "status": "active",
        "tags": "[\"electric\",\"fleet\"]",
        "notes": "Seeded from integration test",
        "reg": "REG-ROUND-1",
        "vin": "ROUNDTRIPVIN00001",
    });

    let mut map = as_object(payload);
    let created = vehicles_create(app.state(), map.clone()).await?;
    let id = created
        .get("id")
        .and_then(Value::as_str)
        .expect("id present")
        .to_string();

    let fetched = vehicles_get(app.state(), Some("default".into()), id.clone())
        .await?
        .expect("vehicle returned");

    let fetched_map = fetched.as_object().expect("object result");
    assert_eq!(fetched_map.get("name"), Some(&Value::from("Fleet Car")));
    assert_eq!(
        fetched_map.get("hero_image_path"),
        Some(&Value::from("images/veh_default_01.jpg"))
    );
    assert_eq!(fetched_map.get("has_spare_key"), Some(&Value::from(true)));
    assert_eq!(
        fetched_map.get("next_service_due"),
        Some(&Value::from(1706659200000_i64))
    );
    assert_eq!(
        fetched_map.get("tags"),
        Some(&Value::from("[\"electric\",\"fleet\"]"))
    );

    // Ensure we can update and soft delete / restore without error.
    let mut update = Map::new();
    update.insert("notes".into(), Value::from("Updated"));
    vehicles_update(app.state(), id.clone(), update, Some("default".into())).await?;
    vehicles_delete(app.state(), "default".into(), id.clone()).await?;
    vehicles_restore(app.state(), "default".into(), id.clone()).await?;
    Ok(())
}

#[tokio::test]
async fn vehicles_unique_indices_enforced() -> Result<()> {
    let dir = TempDir::new()?;
    let (app, _pool, _db_path) = build_app_state(&dir).await?;

    let base = |reg: &str, vin: &str| -> Map<String, Value> {
        as_object(json!({
            "household_id": "default",
            "name": "Uniq",
            "reg": reg,
            "vin": vin,
        }))
    };

    vehicles_create(app.state(), base("UNI-001", "VINUNIQUETEST001")).await?;

    let dup_reg = vehicles_create(app.state(), base("UNI-001", "VINUNIQUETEST002"))
        .await
        .expect_err("duplicate reg should fail");
    assert_eq!(dup_reg.code(), "Sqlite/2067");
    assert_eq!(
        dup_reg.context().get("constraint"),
        Some(&"uq_vehicles_household_reg".to_string())
    );

    let dup_vin = vehicles_create(app.state(), base("UNI-002", "VINUNIQUETEST001"))
        .await
        .expect_err("duplicate vin should fail");
    assert_eq!(dup_vin.code(), "Sqlite/2067");
    assert_eq!(
        dup_vin.context().get("constraint"),
        Some(&"uq_vehicles_household_vin".to_string())
    );

    Ok(())
}

#[tokio::test]
async fn household_delete_cascades_vehicle_records() -> Result<()> {
    let dir = TempDir::new()?;
    let (app, pool, _db_path) = build_app_state(&dir).await?;

    let created = vehicles_create(
        app.state(),
        as_object(json!({
            "household_id": "default",
            "name": "Cascade",
            "reg": "CAS-001",
            "vin": "CASCADEVIN000001",
        })),
    )
    .await?;

    let vehicle_id = created
        .get("id")
        .and_then(Value::as_str)
        .expect("id")
        .to_string();

    sqlx::query(
        "INSERT INTO vehicle_maintenance (id, vehicle_id, household_id, date, type, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'mot', ?5, ?5)",
    )
    .bind("maint-1")
    .bind(&vehicle_id)
    .bind("default")
    .bind(1672531200000_i64)
    .bind(1672531200000_i64)
    .execute(&pool)
    .await?;

    sqlx::query("DELETE FROM household WHERE id = ?1")
        .bind("default")
        .execute(&pool)
        .await?;

    let remaining: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM vehicles")
        .fetch_one(&pool)
        .await?;
    assert_eq!(remaining.0, 0);

    let maintenance: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM vehicle_maintenance")
        .fetch_one(&pool)
        .await?;
    assert_eq!(maintenance.0, 0);

    Ok(())
}

#[tokio::test]
async fn integrity_check_passes() -> Result<()> {
    let dir = TempDir::new()?;
    let (_app, pool, _db_path) = build_app_state(&dir).await?;
    let result: String = sqlx::query_scalar("PRAGMA integrity_check;")
        .fetch_one(&pool)
        .await?;
    assert_eq!(result, "ok");
    Ok(())
}
