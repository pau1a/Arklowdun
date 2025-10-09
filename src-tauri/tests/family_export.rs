use std::fs::File;
use std::io::Read;

use anyhow::Result;
use arklowdun_lib::{
    export::family::{export_household_family, FamilyExportOptions},
    migrate,
};
use chrono::Utc;
use serde_json::Value;
use sqlx::sqlite::SqlitePoolOptions;
use tempfile::TempDir;
use zip::ZipArchive;

fn read_jsonl(archive: &mut ZipArchive<File>, name: &str) -> Result<Vec<Value>> {
    let mut file = archive.by_name(name)?;
    let mut buf = String::new();
    file.read_to_string(&mut buf)?;
    let mut rows = Vec::new();
    for line in buf.lines() {
        if line.trim().is_empty() {
            continue;
        }
        rows.push(serde_json::from_str(line)?);
    }
    Ok(rows)
}

#[tokio::test]
async fn family_export_masks_sensitive_fields() -> Result<()> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await?;
    sqlx::query("PRAGMA foreign_keys=ON;")
        .execute(&pool)
        .await?;
    migrate::apply_migrations(&pool).await?;

    sqlx::query(
        "INSERT INTO household (id, name, created_at, updated_at, deleted_at, tz, is_default, color)\n         VALUES (?1, 'Primary', 0, 0, NULL, 'UTC', 1, NULL)",
    )
    .bind("hh-export")
    .execute(&pool)
    .await?;

    let created_at = Utc::now().timestamp_millis();

    sqlx::query(
        "INSERT INTO family_members (id, name, household_id, created_at, updated_at, position, nickname, full_name, relationship, phone_mobile, email, passport_number, driving_licence_number, nhs_number, national_insurance_number, tax_id, bank_accounts_json, pension_details_json, social_links_json, tags_json, groups_json, last_verified, verified_by)\n         VALUES (?1, 'Paula', ?2, ?3, ?3, 0, 'P', 'Paula Livingstone', 'Partner', '+447700900123', 'paula@example.com', 'ABCD1234', 'LIC99999', '1234567890', 'QQ123456C', 'TAX1234', ?4, ?5, ?6, ?7, ?8, ?3, 'Des')",
    )
    .bind("mem-1")
    .bind("hh-export")
    .bind(created_at)
    .bind(
        "[{\"bank\":\"Monzo\",\"account_number\":\"12345678\",\"sort_code\":\"04-00-04\",\"primary\":true}]",
    )
    .bind("[{\"provider\":\"Nest\",\"policy_number\":\"PN123456\"}]")
    .bind("{\"linkedin\":\"https://example.com\"}")
    .bind("[\"Keyholder\"]")
    .bind("[\"Emergency contacts\"]")
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO family_members (id, name, household_id, created_at, updated_at, position, notes)\n         VALUES (?1, 'Alex', ?2, ?3, ?3, 1, 'Loves maps')",
    )
    .bind("mem-2")
    .bind("hh-export")
    .bind(created_at + 1)
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO family_members (id, name, household_id, created_at, updated_at, deleted_at, position)\n         VALUES (?1, 'Old Member', ?2, ?3, ?3, ?3, 2)",
    )
    .bind("mem-deleted")
    .bind("hh-export")
    .bind(created_at - 10)
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO member_attachments (id, household_id, member_id, title, root_key, relative_path, mime_hint, added_at)\n         VALUES (?1, ?2, ?3, 'Passport scan', 'appData', 'attachments/passport.pdf', 'application/pdf', ?4)",
    )
    .bind("att-1")
    .bind("hh-export")
    .bind("mem-1")
    .bind(created_at)
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO member_attachments (id, household_id, member_id, title, root_key, relative_path, mime_hint, added_at)\n         VALUES (?1, ?2, ?3, 'Utility bill', 'appData', 'attachments/bill.pdf', 'application/pdf', ?4)",
    )
    .bind("att-2")
    .bind("hh-export")
    .bind("mem-2")
    .bind(created_at + 2)
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO member_attachments (id, household_id, member_id, title, root_key, relative_path, mime_hint, added_at)\n         VALUES (?1, ?2, ?3, 'Old doc', 'appData', 'attachments/old.pdf', 'application/pdf', ?4)",
    )
    .bind("att-deleted")
    .bind("hh-export")
    .bind("mem-deleted")
    .bind(created_at + 3)
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO member_renewals (id, household_id, member_id, kind, label, expires_at, remind_on_expiry, remind_offset_days, created_at, updated_at)\n         VALUES (?1, ?2, ?3, 'passport', 'Renew passport', ?4, 1, 30, ?5, ?5)",
    )
    .bind("ren-1")
    .bind("hh-export")
    .bind("mem-1")
    .bind(created_at + 100_000)
    .bind(created_at)
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO member_renewals (id, household_id, member_id, kind, label, expires_at, remind_on_expiry, remind_offset_days, created_at, updated_at)\n         VALUES (?1, ?2, ?3, 'insurance', 'Car insurance', ?4, 0, 60, ?5, ?5)",
    )
    .bind("ren-2")
    .bind("hh-export")
    .bind("mem-2")
    .bind(created_at + 200_000)
    .bind(created_at + 1)
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO member_renewals (id, household_id, member_id, kind, label, expires_at, remind_on_expiry, remind_offset_days, created_at, updated_at)\n         VALUES (?1, ?2, ?3, 'passport', 'Old', ?4, 1, 30, ?5, ?5)",
    )
    .bind("ren-deleted")
    .bind("hh-export")
    .bind("mem-deleted")
    .bind(created_at + 50_000)
    .bind(created_at)
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO notes (id, household_id, category_id, position, created_at, updated_at, z, text, color, x, y, member_id)\n         VALUES (?1, ?2, NULL, 0, ?3, ?3, 0, 'Unlinked note', '#FFFFFF', 0, 0, NULL)",
    )
    .bind("note-1")
    .bind("hh-export")
    .bind(created_at)
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO notes (id, household_id, category_id, position, created_at, updated_at, z, text, color, x, y, member_id)\n         VALUES (?1, ?2, NULL, 1, ?3, ?3, 0, 'Linked active', '#FFFFFF', 0, 0, ?4)",
    )
    .bind("note-2")
    .bind("hh-export")
    .bind(created_at + 1)
    .bind("mem-1")
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO notes (id, household_id, category_id, position, created_at, updated_at, z, text, color, x, y, member_id)\n         VALUES (?1, ?2, NULL, 2, ?3, ?3, 0, 'Linked deleted', '#FFFFFF', 0, 0, ?4)",
    )
    .bind("note-deleted")
    .bind("hh-export")
    .bind(created_at + 2)
    .bind("mem-deleted")
    .execute(&pool)
    .await?;

    let out_dir = TempDir::new()?;
    let result = export_household_family(
        &pool,
        FamilyExportOptions {
            household_id: "hh-export".into(),
            out_dir: out_dir.path().to_path_buf(),
        },
    )
    .await?;

    assert!(!result.partial);

    let file = File::open(&result.zip_path)?;
    let mut archive = ZipArchive::new(file)?;

    let mut manifest_data = String::new();
    archive
        .by_name("export/manifest.json")?
        .read_to_string(&mut manifest_data)?;
    let manifest: Value = serde_json::from_str(&manifest_data)?;
    assert_eq!(manifest["household_id"], "hh-export");
    assert_eq!(manifest["family_plan_version"], "PR0.5");
    assert_eq!(
        manifest["modules"],
        Value::Array(MODULES.iter().map(|m| Value::String((*m).into())).collect())
    );
    assert_eq!(
        manifest["redaction"]["policy"],
        "mask-sensitive-identifiers"
    );
    assert_eq!(manifest["redaction"]["format"], "***####");
    assert_eq!(manifest["redaction"]["todo"], REDACTION_TODO);
    assert_eq!(manifest["partial"], Value::Bool(false));

    let members = read_jsonl(&mut archive, "export/family_members.jsonl")?;
    assert_eq!(members.len(), 2);
    let paula = members
        .iter()
        .find(|value| value["id"] == "mem-1")
        .expect("Paula exported");
    assert_eq!(paula["passport_number"], "***1234");
    assert_eq!(paula["driving_licence_number"], "***9999");
    assert_eq!(paula["nhs_number"], "***7890");
    assert_eq!(paula["national_insurance_number"], "***456C");
    assert_eq!(paula["tax_id"], "***1234");
    assert_eq!(paula["phone_mobile"], "+447700900123");
    assert_eq!(paula["email"], "paula@example.com");
    let bank_accounts = paula["bank_accounts_json"]
        .as_array()
        .expect("bank accounts array");
    assert_eq!(bank_accounts.len(), 1);
    assert_eq!(bank_accounts[0]["account_number"], "***5678");
    assert_eq!(bank_accounts[0]["sort_code"], "04-00-04");
    let pension = paula["pension_details_json"]
        .as_array()
        .expect("pension array");
    assert_eq!(pension[0]["policy_number"], "***3456");

    let attachments = read_jsonl(&mut archive, "export/member_attachments.jsonl")?;
    assert_eq!(attachments.len(), 2);
    assert!(attachments
        .iter()
        .all(|row| row["member_id"] != "mem-deleted"));

    let renewals = read_jsonl(&mut archive, "export/member_renewals.jsonl")?;
    assert_eq!(renewals.len(), 2);
    for renewal in &renewals {
        if renewal["id"] == "ren-1" {
            assert_eq!(renewal["remind_on_expiry"], true);
        }
    }

    let notes = read_jsonl(&mut archive, "export/notes.jsonl")?;
    assert_eq!(notes.len(), 2);
    assert!(notes.iter().any(|row| row["member_id"] == "mem-1"));
    assert!(notes.iter().all(|row| row["member_id"] != "mem-deleted"));

    Ok(())
}

const MODULES: [&str; 4] = [
    "family_members",
    "member_attachments",
    "member_renewals",
    "notes",
];

const REDACTION_TODO: &str =
    "Full encryption/redaction of bank and pension fields pending future work.";
