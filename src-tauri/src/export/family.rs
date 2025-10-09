use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

use chrono::{SecondsFormat, Utc};
use futures::TryStreamExt;
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tempfile::TempDir;
use tracing::{error, info, warn};
use zip::result::ZipError;
use zip::write::FileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::{AppError, AppResult};

const DATASET_FAMILY_MEMBERS: &str = "family_members";
const DATASET_ATTACHMENTS: &str = "member_attachments";
const DATASET_RENEWALS: &str = "member_renewals";
const DATASET_NOTES: &str = "notes";
const EXPORT_DIR_NAME: &str = "export";
const MANIFEST_NAME: &str = "manifest.json";
const REDACTION_POLICY: &str = "mask-sensitive-identifiers";
const REDACTION_FORMAT: &str = "***####";
const REDACTION_TODO: &str =
    "Full encryption/redaction of bank and pension fields pending future work.";
const ZIP_FILE_PREFIX: &str = "family-export";
const ZIP_EXTENSION: &str = "zip";
const FAMILY_PLAN_VERSION: &str = "PR0.5";

const MODULES: [&str; 4] = [
    DATASET_FAMILY_MEMBERS,
    DATASET_ATTACHMENTS,
    DATASET_RENEWALS,
    DATASET_NOTES,
];

/// Options controlling the household family export bundle.
#[derive(Debug, Clone)]
pub struct FamilyExportOptions {
    pub household_id: String,
    pub out_dir: PathBuf,
}

/// Result of creating the family export bundle.
#[derive(Debug, Clone)]
pub struct FamilyExportResult {
    pub zip_path: PathBuf,
    pub partial: bool,
}

#[derive(Serialize)]
struct Manifest<'a> {
    exported_at: String,
    household_id: &'a str,
    family_plan_version: &'static str,
    modules: &'static [&'static str],
    redaction: ManifestRedaction,
    partial: bool,
}

#[derive(Serialize)]
struct ManifestRedaction {
    policy: &'static str,
    format: &'static str,
    todo: &'static str,
}

/// Create a masked family export bundle for the given household.
#[allow(clippy::too_many_lines)]
pub async fn export_household_family(
    pool: &SqlitePool,
    opts: FamilyExportOptions,
) -> AppResult<FamilyExportResult> {
    fs::create_dir_all(&opts.out_dir)
        .map_err(|err| AppError::from(err).with_context("operation", "create_export_dir"))?;

    let temp_dir = TempDir::new_in(&opts.out_dir)
        .map_err(|err| AppError::from(err).with_context("operation", "family_export_tempdir"))?;
    let export_root = temp_dir.path().join(EXPORT_DIR_NAME);
    fs::create_dir_all(&export_root).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "family_export_create_root")
            .with_context("path", export_root.display().to_string())
    })?;

    let members_path = export_root.join(format!("{DATASET_FAMILY_MEMBERS}.jsonl"));
    let attachments_path = export_root.join(format!("{DATASET_ATTACHMENTS}.jsonl"));
    let renewals_path = export_root.join(format!("{DATASET_RENEWALS}.jsonl"));
    let notes_path = export_root.join(format!("{DATASET_NOTES}.jsonl"));

    let mut partial = false;

    let mut dataset_guard = DatasetGuard::new(&members_path);
    let start = Instant::now();
    match export_family_members(pool, &opts.household_id, &members_path).await {
        Ok(count) => {
            dataset_guard.disarm();
            info!(
                target: "arklowdun",
                area = "family",
                event = "export_dataset",
                dataset = DATASET_FAMILY_MEMBERS,
                count = count,
                ms = start.elapsed().as_millis() as u64
            );
        }
        Err(err) => {
            partial = true;
            error!(
                target: "arklowdun",
                area = "family",
                event = "export_query_failed",
                dataset = DATASET_FAMILY_MEMBERS,
                code = "SQL_ERROR",
                context = %err
            );
        }
    }
    drop(dataset_guard);

    let mut dataset_guard = DatasetGuard::new(&attachments_path);
    let start = Instant::now();
    match export_member_attachments(pool, &opts.household_id, &attachments_path).await {
        Ok(count) => {
            dataset_guard.disarm();
            info!(
                target: "arklowdun",
                area = "family",
                event = "export_dataset",
                dataset = DATASET_ATTACHMENTS,
                count = count,
                ms = start.elapsed().as_millis() as u64
            );
        }
        Err(err) => {
            partial = true;
            error!(
                target: "arklowdun",
                area = "family",
                event = "export_query_failed",
                dataset = DATASET_ATTACHMENTS,
                code = "SQL_ERROR",
                context = %err
            );
        }
    }
    drop(dataset_guard);

    let mut dataset_guard = DatasetGuard::new(&renewals_path);
    let start = Instant::now();
    match export_member_renewals(pool, &opts.household_id, &renewals_path).await {
        Ok(count) => {
            dataset_guard.disarm();
            info!(
                target: "arklowdun",
                area = "family",
                event = "export_dataset",
                dataset = DATASET_RENEWALS,
                count = count,
                ms = start.elapsed().as_millis() as u64
            );
        }
        Err(err) => {
            partial = true;
            error!(
                target: "arklowdun",
                area = "family",
                event = "export_query_failed",
                dataset = DATASET_RENEWALS,
                code = "SQL_ERROR",
                context = %err
            );
        }
    }
    drop(dataset_guard);

    let mut dataset_guard = DatasetGuard::new(&notes_path);
    let start = Instant::now();
    match export_notes(pool, &opts.household_id, &notes_path).await {
        Ok(count) => {
            dataset_guard.disarm();
            info!(
                target: "arklowdun",
                area = "family",
                event = "export_dataset",
                dataset = DATASET_NOTES,
                count = count,
                ms = start.elapsed().as_millis() as u64
            );
        }
        Err(err) => {
            partial = true;
            error!(
                target: "arklowdun",
                area = "family",
                event = "export_query_failed",
                dataset = DATASET_NOTES,
                code = "SQL_ERROR",
                context = %err
            );
        }
    }
    drop(dataset_guard);

    let manifest_path = export_root.join(MANIFEST_NAME);
    let manifest = Manifest {
        exported_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        household_id: &opts.household_id,
        family_plan_version: FAMILY_PLAN_VERSION,
        modules: &MODULES,
        redaction: ManifestRedaction {
            policy: REDACTION_POLICY,
            format: REDACTION_FORMAT,
            todo: REDACTION_TODO,
        },
        partial,
    };

    // TODO(PR12): upgrade to full encryption/redaction once storage supports it.
    let manifest_bytes = serde_json::to_vec_pretty(&manifest).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "family_export_manifest_encode")
            .with_context("path", manifest_path.display().to_string())
    })?;
    fs::write(&manifest_path, &manifest_bytes).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "family_export_manifest_write")
            .with_context("path", manifest_path.display().to_string())
    })?;

    let timestamp = Utc::now().format("%Y%m%dT%H%M%S");
    let file_name = format!(
        "{ZIP_FILE_PREFIX}-{}-{}.{}",
        opts.household_id, timestamp, ZIP_EXTENSION
    );
    let zip_path = opts.out_dir.join(file_name);
    let file = File::create(&zip_path).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "family_export_zip_create")
            .with_context("path", zip_path.display().to_string())
    })?;

    let mut writer = ZipWriter::new(file);
    let options = FileOptions::default().compression_method(CompressionMethod::Deflated);
    writer
        .add_directory(format!("{EXPORT_DIR_NAME}/"), options)
        .map_err(|err| map_zip_error(err, "family_export_zip_dir"))?;

    for name in [
        MANIFEST_NAME,
        &format!("{DATASET_FAMILY_MEMBERS}.jsonl"),
        &format!("{DATASET_ATTACHMENTS}.jsonl"),
        &format!("{DATASET_RENEWALS}.jsonl"),
        &format!("{DATASET_NOTES}.jsonl"),
    ] {
        let source = export_root.join(name);
        if !source.exists() {
            continue;
        }
        let mut file = File::open(&source).map_err(|err| {
            AppError::from(err)
                .with_context("operation", "family_export_zip_open")
                .with_context("path", source.display().to_string())
        })?;
        writer
            .start_file(format!("{EXPORT_DIR_NAME}/{name}"), options)
            .map_err(|err| map_zip_error(err, "family_export_zip_entry"))?;
        std::io::copy(&mut file, &mut writer).map_err(|err| {
            AppError::from(err).with_context("operation", "family_export_zip_copy")
        })?;
    }

    writer
        .finish()
        .map_err(|err| map_zip_error(err, "family_export_zip_finish"))?;

    Ok(FamilyExportResult { zip_path, partial })
}

struct DatasetGuard<'a> {
    path: &'a Path,
    armed: bool,
}

impl<'a> DatasetGuard<'a> {
    fn new(path: &'a Path) -> Self {
        Self { path, armed: true }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for DatasetGuard<'_> {
    fn drop(&mut self) {
        if self.armed {
            let _ = fs::remove_file(self.path);
        }
    }
}

#[derive(Debug, sqlx::FromRow)]
struct FamilyMemberRow {
    id: String,
    household_id: String,
    name: String,
    nickname: Option<String>,
    full_name: Option<String>,
    relationship: Option<String>,
    birthday: Option<i64>,
    notes: Option<String>,
    phone_mobile: Option<String>,
    phone_home: Option<String>,
    phone_work: Option<String>,
    email: Option<String>,
    address: Option<String>,
    personal_website: Option<String>,
    social_links_json: Option<String>,
    passport_number: Option<String>,
    passport_expiry: Option<i64>,
    driving_licence_number: Option<String>,
    driving_licence_expiry: Option<i64>,
    nhs_number: Option<String>,
    national_insurance_number: Option<String>,
    tax_id: Option<String>,
    photo_id_expiry: Option<i64>,
    blood_group: Option<String>,
    allergies: Option<String>,
    medical_notes: Option<String>,
    gp_contact: Option<String>,
    emergency_contact_name: Option<String>,
    emergency_contact_phone: Option<String>,
    bank_accounts_json: Option<String>,
    pension_details_json: Option<String>,
    insurance_refs: Option<String>,
    tags_json: Option<String>,
    groups_json: Option<String>,
    last_verified: Option<i64>,
    verified_by: Option<String>,
    created_at: i64,
    updated_at: i64,
    deleted_at: Option<i64>,
    position: i64,
    photo_path: Option<String>,
    keyholder: Option<i64>,
    status: Option<String>,
}

#[derive(Serialize)]
struct FamilyMemberExport {
    id: String,
    household_id: String,
    name: String,
    nickname: Option<String>,
    full_name: Option<String>,
    relationship: Option<String>,
    birthday: Option<i64>,
    notes: Option<String>,
    phone_mobile: Option<String>,
    phone_home: Option<String>,
    phone_work: Option<String>,
    email: Option<String>,
    address: Option<String>,
    personal_website: Option<String>,
    social_links_json: Option<Value>,
    passport_number: Option<String>,
    passport_expiry: Option<i64>,
    driving_licence_number: Option<String>,
    driving_licence_expiry: Option<i64>,
    nhs_number: Option<String>,
    national_insurance_number: Option<String>,
    tax_id: Option<String>,
    photo_id_expiry: Option<i64>,
    blood_group: Option<String>,
    allergies: Option<String>,
    medical_notes: Option<String>,
    gp_contact: Option<String>,
    emergency_contact_name: Option<String>,
    emergency_contact_phone: Option<String>,
    bank_accounts_json: Option<Value>,
    pension_details_json: Option<Value>,
    insurance_refs: Option<String>,
    tags_json: Option<Value>,
    groups_json: Option<Value>,
    last_verified: Option<i64>,
    verified_by: Option<String>,
    created_at: i64,
    updated_at: i64,
    deleted_at: Option<i64>,
    position: i64,
    photo_path: Option<String>,
    keyholder: Option<bool>,
    status: Option<String>,
}

impl FamilyMemberRow {
    fn into_export(self) -> FamilyMemberExport {
        let bank_accounts = parse_masked_json(
            self.bank_accounts_json,
            DATASET_FAMILY_MEMBERS,
            "bank_accounts_json",
            &self.household_id,
            &self.id,
            mask_bank_accounts,
        );
        let pension_details = parse_masked_json(
            self.pension_details_json,
            DATASET_FAMILY_MEMBERS,
            "pension_details_json",
            &self.household_id,
            &self.id,
            mask_pension_details,
        );

        FamilyMemberExport {
            id: self.id,
            household_id: self.household_id,
            name: self.name,
            nickname: self.nickname,
            full_name: self.full_name,
            relationship: self.relationship,
            birthday: self.birthday,
            notes: self.notes,
            phone_mobile: self.phone_mobile,
            phone_home: self.phone_home,
            phone_work: self.phone_work,
            email: self.email,
            address: self.address,
            personal_website: self.personal_website,
            social_links_json: parse_json_field(self.social_links_json),
            passport_number: self.passport_number.map(|value| mask_tail(&value)),
            passport_expiry: self.passport_expiry,
            driving_licence_number: self.driving_licence_number.map(|value| mask_tail(&value)),
            driving_licence_expiry: self.driving_licence_expiry,
            nhs_number: self.nhs_number.map(|value| mask_tail(&value)),
            national_insurance_number: self
                .national_insurance_number
                .map(|value| mask_tail(&value)),
            tax_id: self.tax_id.map(|value| mask_tail(&value)),
            photo_id_expiry: self.photo_id_expiry,
            blood_group: self.blood_group,
            allergies: self.allergies,
            medical_notes: self.medical_notes,
            gp_contact: self.gp_contact,
            emergency_contact_name: self.emergency_contact_name,
            emergency_contact_phone: self.emergency_contact_phone,
            bank_accounts_json: bank_accounts,
            pension_details_json: pension_details,
            insurance_refs: self.insurance_refs,
            tags_json: parse_json_field(self.tags_json),
            groups_json: parse_json_field(self.groups_json),
            last_verified: self.last_verified,
            verified_by: self.verified_by,
            created_at: self.created_at,
            updated_at: self.updated_at,
            deleted_at: self.deleted_at,
            position: self.position,
            photo_path: self.photo_path,
            keyholder: self.keyholder.map(|value| value != 0),
            status: self.status,
        }
    }
}

async fn export_family_members(
    pool: &SqlitePool,
    household_id: &str,
    path: &Path,
) -> AppResult<u64> {
    let file = File::create(path).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "export_family_members_create")
            .with_context("path", path.display().to_string())
    })?;
    let mut writer = BufWriter::new(file);

    let mut stream = sqlx::query_as::<_, FamilyMemberRow>(
        r#"
            SELECT id, household_id, name, nickname, full_name, relationship, birthday, notes,
                   phone_mobile, phone_home, phone_work, email, address, personal_website,
                   social_links_json, passport_number, passport_expiry, driving_licence_number,
                   driving_licence_expiry, nhs_number, national_insurance_number, tax_id,
                   photo_id_expiry, blood_group, allergies, medical_notes, gp_contact,
                   emergency_contact_name, emergency_contact_phone, bank_accounts_json,
                   pension_details_json, insurance_refs, tags_json, groups_json,
                   last_verified, verified_by, created_at, updated_at, deleted_at,
                   position, photo_path, keyholder, status
            FROM family_members
            WHERE household_id = ?1 AND deleted_at IS NULL
            ORDER BY created_at ASC, id ASC
        "#,
    )
    .bind(household_id)
    .fetch(pool);

    let mut count = 0u64;
    while let Some(row) = stream
        .try_next()
        .await
        .map_err(|err| AppError::from(err).with_context("dataset", DATASET_FAMILY_MEMBERS))?
    {
        let export_row = row.into_export();
        let line = serde_json::to_vec(&export_row).map_err(|err| {
            AppError::from(err)
                .with_context("operation", "export_family_members_encode")
                .with_context("dataset", DATASET_FAMILY_MEMBERS)
        })?;
        writer.write_all(&line).map_err(|err| {
            AppError::from(err)
                .with_context("operation", "export_family_members_write")
                .with_context("dataset", DATASET_FAMILY_MEMBERS)
        })?;
        writer.write_all(b"\n").map_err(|err| {
            AppError::from(err)
                .with_context("operation", "export_family_members_write")
                .with_context("dataset", DATASET_FAMILY_MEMBERS)
        })?;
        count += 1;
    }

    writer.flush().map_err(|err| {
        AppError::from(err)
            .with_context("operation", "export_family_members_flush")
            .with_context("dataset", DATASET_FAMILY_MEMBERS)
    })?;

    Ok(count)
}

#[derive(Debug, sqlx::FromRow)]
struct AttachmentRow {
    id: String,
    household_id: String,
    member_id: String,
    title: Option<String>,
    root_key: String,
    relative_path: String,
    mime_hint: Option<String>,
    added_at: i64,
}

#[derive(Serialize)]
struct AttachmentExport {
    id: String,
    household_id: String,
    member_id: String,
    title: Option<String>,
    root_key: String,
    relative_path: String,
    mime_hint: Option<String>,
    added_at: i64,
}

async fn export_member_attachments(
    pool: &SqlitePool,
    household_id: &str,
    path: &Path,
) -> AppResult<u64> {
    let file = File::create(path).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "export_member_attachments_create")
            .with_context("path", path.display().to_string())
    })?;
    let mut writer = BufWriter::new(file);

    let mut stream = sqlx::query_as::<_, AttachmentRow>(
        r#"
            SELECT a.id, a.household_id, a.member_id, a.title, a.root_key,
                   a.relative_path, a.mime_hint, a.added_at
            FROM member_attachments a
            JOIN family_members m ON m.id = a.member_id
            WHERE a.household_id = ?1 AND m.household_id = ?1 AND m.deleted_at IS NULL
            ORDER BY a.added_at ASC, a.id ASC
        "#,
    )
    .bind(household_id)
    .fetch(pool);

    let mut count = 0u64;
    while let Some(row) = stream
        .try_next()
        .await
        .map_err(|err| AppError::from(err).with_context("dataset", DATASET_ATTACHMENTS))?
    {
        let export_row = AttachmentExport {
            id: row.id,
            household_id: row.household_id,
            member_id: row.member_id,
            title: row.title,
            root_key: row.root_key,
            relative_path: row.relative_path,
            mime_hint: row.mime_hint,
            added_at: row.added_at,
        };
        let line = serde_json::to_vec(&export_row).map_err(|err| {
            AppError::from(err)
                .with_context("operation", "export_member_attachments_encode")
                .with_context("dataset", DATASET_ATTACHMENTS)
        })?;
        writer.write_all(&line).map_err(|err| {
            AppError::from(err)
                .with_context("operation", "export_member_attachments_write")
                .with_context("dataset", DATASET_ATTACHMENTS)
        })?;
        writer.write_all(b"\n").map_err(|err| {
            AppError::from(err)
                .with_context("operation", "export_member_attachments_write")
                .with_context("dataset", DATASET_ATTACHMENTS)
        })?;
        count += 1;
    }

    writer.flush().map_err(|err| {
        AppError::from(err)
            .with_context("operation", "export_member_attachments_flush")
            .with_context("dataset", DATASET_ATTACHMENTS)
    })?;

    Ok(count)
}

#[derive(Debug, sqlx::FromRow)]
struct RenewalRow {
    id: String,
    household_id: String,
    member_id: String,
    kind: String,
    label: Option<String>,
    expires_at: i64,
    remind_on_expiry: i64,
    remind_offset_days: i64,
    created_at: i64,
    updated_at: i64,
}

#[derive(Serialize)]
struct RenewalExport {
    id: String,
    household_id: String,
    member_id: String,
    kind: String,
    label: Option<String>,
    expires_at: i64,
    remind_on_expiry: bool,
    remind_offset_days: i64,
    created_at: i64,
    updated_at: i64,
}

async fn export_member_renewals(
    pool: &SqlitePool,
    household_id: &str,
    path: &Path,
) -> AppResult<u64> {
    let file = File::create(path).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "export_member_renewals_create")
            .with_context("path", path.display().to_string())
    })?;
    let mut writer = BufWriter::new(file);

    let mut stream = sqlx::query_as::<_, RenewalRow>(
        r#"
            SELECT r.id, r.household_id, r.member_id, r.kind, r.label,
                   r.expires_at, r.remind_on_expiry, r.remind_offset_days,
                   r.created_at, r.updated_at
            FROM member_renewals r
            JOIN family_members m ON m.id = r.member_id
            WHERE r.household_id = ?1 AND m.household_id = ?1 AND m.deleted_at IS NULL
            ORDER BY r.created_at ASC, r.id ASC
        "#,
    )
    .bind(household_id)
    .fetch(pool);

    let mut count = 0u64;
    while let Some(row) = stream
        .try_next()
        .await
        .map_err(|err| AppError::from(err).with_context("dataset", DATASET_RENEWALS))?
    {
        let export_row = RenewalExport {
            id: row.id,
            household_id: row.household_id,
            member_id: row.member_id,
            kind: row.kind,
            label: row.label,
            expires_at: row.expires_at,
            remind_on_expiry: row.remind_on_expiry != 0,
            remind_offset_days: row.remind_offset_days,
            created_at: row.created_at,
            updated_at: row.updated_at,
        };
        let line = serde_json::to_vec(&export_row).map_err(|err| {
            AppError::from(err)
                .with_context("operation", "export_member_renewals_encode")
                .with_context("dataset", DATASET_RENEWALS)
        })?;
        writer.write_all(&line).map_err(|err| {
            AppError::from(err)
                .with_context("operation", "export_member_renewals_write")
                .with_context("dataset", DATASET_RENEWALS)
        })?;
        writer.write_all(b"\n").map_err(|err| {
            AppError::from(err)
                .with_context("operation", "export_member_renewals_write")
                .with_context("dataset", DATASET_RENEWALS)
        })?;
        count += 1;
    }

    writer.flush().map_err(|err| {
        AppError::from(err)
            .with_context("operation", "export_member_renewals_flush")
            .with_context("dataset", DATASET_RENEWALS)
    })?;

    Ok(count)
}

#[derive(Debug, sqlx::FromRow)]
struct NoteRow {
    id: String,
    household_id: String,
    category_id: Option<String>,
    position: i64,
    created_at: i64,
    updated_at: i64,
    deleted_at: Option<i64>,
    z: Option<i64>,
    text: String,
    color: String,
    x: f64,
    y: f64,
    deadline: Option<i64>,
    deadline_tz: Option<String>,
    member_id: Option<String>,
}

#[derive(Serialize)]
struct NoteExport {
    id: String,
    household_id: String,
    category_id: Option<String>,
    position: i64,
    created_at: i64,
    updated_at: i64,
    deleted_at: Option<i64>,
    z: Option<i64>,
    text: String,
    color: String,
    x: f64,
    y: f64,
    deadline: Option<i64>,
    deadline_tz: Option<String>,
    member_id: Option<String>,
}

async fn export_notes(pool: &SqlitePool, household_id: &str, path: &Path) -> AppResult<u64> {
    let file = File::create(path).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "export_notes_create")
            .with_context("path", path.display().to_string())
    })?;
    let mut writer = BufWriter::new(file);

    let mut stream = sqlx::query_as::<_, NoteRow>(
        r#"
            SELECT n.id, n.household_id, n.category_id, n.position, n.created_at, n.updated_at,
                   n.deleted_at, n.z, n.text, n.color, n.x, n.y, n.deadline, n.deadline_tz,
                   n.member_id
            FROM notes n
            LEFT JOIN family_members m ON m.id = n.member_id
            WHERE n.household_id = ?1
              AND n.deleted_at IS NULL
              AND (n.member_id IS NULL OR (m.household_id = ?1 AND m.deleted_at IS NULL))
            ORDER BY n.created_at ASC, n.id ASC
        "#,
    )
    .bind(household_id)
    .fetch(pool);

    let mut count = 0u64;
    while let Some(row) = stream
        .try_next()
        .await
        .map_err(|err| AppError::from(err).with_context("dataset", DATASET_NOTES))?
    {
        let export_row = NoteExport {
            id: row.id,
            household_id: row.household_id,
            category_id: row.category_id,
            position: row.position,
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
            z: row.z,
            text: row.text,
            color: row.color,
            x: row.x,
            y: row.y,
            deadline: row.deadline,
            deadline_tz: row.deadline_tz,
            member_id: row.member_id,
        };
        let line = serde_json::to_vec(&export_row).map_err(|err| {
            AppError::from(err)
                .with_context("operation", "export_notes_encode")
                .with_context("dataset", DATASET_NOTES)
        })?;
        writer.write_all(&line).map_err(|err| {
            AppError::from(err)
                .with_context("operation", "export_notes_write")
                .with_context("dataset", DATASET_NOTES)
        })?;
        writer.write_all(b"\n").map_err(|err| {
            AppError::from(err)
                .with_context("operation", "export_notes_write")
                .with_context("dataset", DATASET_NOTES)
        })?;
        count += 1;
    }

    writer.flush().map_err(|err| {
        AppError::from(err)
            .with_context("operation", "export_notes_flush")
            .with_context("dataset", DATASET_NOTES)
    })?;

    Ok(count)
}

fn parse_json_field(raw: Option<String>) -> Option<Value> {
    raw.map(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            Value::String(String::new())
        } else {
            serde_json::from_str(trimmed).unwrap_or_else(|_| Value::String(value))
        }
    })
}

type MaskFn = fn(&mut Value);

fn parse_masked_json(
    raw: Option<String>,
    dataset: &'static str,
    field: &'static str,
    household_id: &str,
    member_id: &str,
    mask: MaskFn,
) -> Option<Value> {
    raw.map(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return Value::String(String::new());
        }
        match serde_json::from_str::<Value>(trimmed) {
            Ok(mut json) => {
                mask(&mut json);
                json
            }
            Err(err) => {
                warn!(
                    target: "arklowdun",
                    area = "family",
                    event = "mask_json_parse_failed",
                    dataset = dataset,
                    field = field,
                    household_id = household_id,
                    member_id = member_id,
                    error = %err
                );
                Value::String(value)
            }
        }
    })
}

fn mask_bank_accounts(value: &mut Value) {
    match value {
        Value::Array(items) => {
            for item in items {
                mask_bank_accounts(item);
            }
        }
        Value::Object(map) => {
            if let Some(entry) = map.get_mut("account_number") {
                if let Some(raw) = entry.as_str() {
                    *entry = Value::String(mask_tail(raw));
                }
            }
        }
        _ => {}
    }
}

fn mask_pension_details(value: &mut Value) {
    match value {
        Value::Array(items) => {
            for item in items {
                mask_pension_details(item);
            }
        }
        Value::Object(map) => {
            if let Some(entry) = map.get_mut("policy_number") {
                if let Some(raw) = entry.as_str() {
                    *entry = Value::String(mask_tail(raw));
                }
            }
        }
        _ => {}
    }
}

fn mask_tail(value: &str) -> String {
    let trimmed = value.trim();
    let count = trimmed.chars().count();
    if count < 4 {
        format!("***{}", trimmed)
    } else {
        let tail: String = trimmed
            .chars()
            .rev()
            .take(4)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        format!("***{}", tail)
    }
}

fn map_zip_error(err: ZipError, operation: &'static str) -> AppError {
    AppError::new("EXPORT/ZIP", "Failed to write family export archive.")
        .with_context("operation", operation)
        .with_context("error", err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mask_tail_handles_short_values() {
        assert_eq!(mask_tail("12"), "***12");
    }

    #[test]
    fn mask_tail_handles_long_values() {
        assert_eq!(mask_tail("12345678"), "***5678");
    }

    #[test]
    fn mask_tail_preserves_last_alphanumerics() {
        assert_eq!(mask_tail("AB-1234"), "***1234");
    }

    #[test]
    fn mask_bank_accounts_masks_account_number() {
        let mut value = json!([{ "account_number": "12345678", "sort_code": "00-00-00" }]);
        mask_bank_accounts(&mut value);
        assert_eq!(
            value,
            json!([{ "account_number": "***5678", "sort_code": "00-00-00" }])
        );
    }

    #[test]
    fn mask_pension_details_masks_policy_number() {
        let mut value = json!([{ "policy_number": "ABC12345", "provider": "Test" }]);
        mask_pension_details(&mut value);
        assert_eq!(
            value,
            json!([{ "policy_number": "***2345", "provider": "Test" }])
        );
    }

    #[test]
    fn parse_masked_json_falls_back_on_invalid_input() {
        let result = parse_masked_json(
            Some("not-json".to_string()),
            DATASET_FAMILY_MEMBERS,
            "bank_accounts_json",
            "hh",
            "member",
            mask_bank_accounts,
        );
        assert_eq!(result, Some(Value::String("not-json".to_string())));
    }
}
