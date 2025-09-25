use std::collections::BTreeMap;

use anyhow::{bail, Result};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct EventRow {
    pub id: String,
    pub title: String,
    pub reminder: Option<i64>,
    #[serde(alias = "householdId")]
    pub household_id: String,
    #[serde(alias = "createdAt")]
    pub created_at: i64,
    #[serde(alias = "updatedAt")]
    pub updated_at: i64,
    #[serde(alias = "deletedAt")]
    pub deleted_at: Option<i64>,
    #[serde(alias = "timeZone")]
    pub tz: Option<String>,
    #[serde(alias = "startAtUtc")]
    pub start_at_utc: i64,
    #[serde(alias = "endAtUtc")]
    pub end_at_utc: Option<i64>,
    pub rrule: Option<String>,
    #[serde(alias = "exDates")]
    pub exdates: Option<String>,
    #[serde(flatten)]
    pub extras: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct NoteRow {
    pub id: String,
    #[serde(alias = "householdId")]
    pub household_id: String,
    pub position: i64,
    pub z: i64,
    #[serde(alias = "createdAt")]
    pub created_at: i64,
    #[serde(alias = "updatedAt")]
    pub updated_at: i64,
    #[serde(alias = "deletedAt")]
    pub deleted_at: Option<i64>,
    #[serde(flatten)]
    pub extras: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct HouseholdRow {
    pub id: String,
    pub name: String,
    #[serde(alias = "timeZone")]
    pub tz: String,
    #[serde(alias = "createdAt")]
    pub created_at: i64,
    #[serde(alias = "updatedAt")]
    pub updated_at: i64,
    #[serde(alias = "deletedAt")]
    pub deleted_at: Option<i64>,
    #[serde(flatten)]
    pub extras: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct FileIndexRow {
    pub id: i64,
    #[serde(alias = "householdId")]
    pub household_id: String,
    #[serde(alias = "fileId")]
    pub file_id: String,
    pub filename: String,
    #[serde(alias = "updatedAtUtc")]
    pub updated_at_utc: String,
    pub ordinal: i64,
    #[serde(alias = "scoreHint")]
    pub score_hint: i64,
    #[serde(flatten)]
    pub extras: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct BillRow {
    pub id: String,
    pub amount: i64,
    #[serde(alias = "dueDate")]
    pub due_date: i64,
    pub document: Option<String>,
    pub reminder: Option<i64>,
    #[serde(alias = "householdId")]
    pub household_id: String,
    #[serde(alias = "createdAt")]
    pub created_at: i64,
    #[serde(alias = "updatedAt")]
    pub updated_at: i64,
    #[serde(alias = "deletedAt")]
    pub deleted_at: Option<i64>,
    pub position: i64,
    #[serde(alias = "rootKey")]
    pub root_key: Option<String>,
    #[serde(alias = "relativePath")]
    pub relative_path: Option<String>,
    #[serde(flatten)]
    pub extras: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PolicyRow {
    pub id: String,
    pub amount: i64,
    #[serde(alias = "dueDate")]
    pub due_date: i64,
    pub document: Option<String>,
    pub reminder: Option<i64>,
    #[serde(alias = "householdId")]
    pub household_id: String,
    #[serde(alias = "createdAt")]
    pub created_at: i64,
    #[serde(alias = "updatedAt")]
    pub updated_at: i64,
    #[serde(alias = "deletedAt")]
    pub deleted_at: Option<i64>,
    pub position: i64,
    #[serde(alias = "rootKey")]
    pub root_key: Option<String>,
    #[serde(alias = "relativePath")]
    pub relative_path: Option<String>,
    #[serde(flatten)]
    pub extras: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PropertyDocumentRow {
    pub id: String,
    pub description: String,
    #[serde(alias = "renewalDate")]
    pub renewal_date: i64,
    pub document: Option<String>,
    pub reminder: Option<i64>,
    #[serde(alias = "householdId")]
    pub household_id: String,
    #[serde(alias = "createdAt")]
    pub created_at: i64,
    #[serde(alias = "updatedAt")]
    pub updated_at: i64,
    #[serde(alias = "deletedAt")]
    pub deleted_at: Option<i64>,
    pub position: i64,
    #[serde(alias = "rootKey")]
    pub root_key: Option<String>,
    #[serde(alias = "relativePath")]
    pub relative_path: Option<String>,
    #[serde(flatten)]
    pub extras: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct InventoryItemRow {
    pub id: String,
    pub name: String,
    #[serde(alias = "purchaseDate")]
    pub purchase_date: Option<i64>,
    #[serde(alias = "warrantyExpiry")]
    pub warranty_expiry: Option<i64>,
    pub document: Option<String>,
    pub reminder: Option<i64>,
    #[serde(alias = "householdId")]
    pub household_id: String,
    #[serde(alias = "createdAt")]
    pub created_at: i64,
    #[serde(alias = "updatedAt")]
    pub updated_at: i64,
    #[serde(alias = "deletedAt")]
    pub deleted_at: Option<i64>,
    pub position: i64,
    #[serde(alias = "rootKey")]
    pub root_key: Option<String>,
    #[serde(alias = "relativePath")]
    pub relative_path: Option<String>,
    #[serde(flatten)]
    pub extras: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct VehicleMaintenanceRow {
    pub id: String,
    #[serde(alias = "vehicleId")]
    pub vehicle_id: String,
    pub date: i64,
    #[serde(rename = "type")]
    pub kind: String,
    pub cost: Option<i64>,
    pub document: Option<String>,
    #[serde(alias = "householdId")]
    pub household_id: String,
    #[serde(alias = "createdAt")]
    pub created_at: i64,
    #[serde(alias = "updatedAt")]
    pub updated_at: i64,
    #[serde(alias = "deletedAt")]
    pub deleted_at: Option<i64>,
    #[serde(alias = "rootKey")]
    pub root_key: Option<String>,
    #[serde(alias = "relativePath")]
    pub relative_path: Option<String>,
    #[serde(flatten)]
    pub extras: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PetMedicalRow {
    pub id: String,
    #[serde(alias = "petId")]
    pub pet_id: String,
    pub date: i64,
    pub description: String,
    pub document: Option<String>,
    pub reminder: Option<i64>,
    #[serde(alias = "householdId")]
    pub household_id: String,
    #[serde(alias = "createdAt")]
    pub created_at: i64,
    #[serde(alias = "updatedAt")]
    pub updated_at: i64,
    #[serde(alias = "deletedAt")]
    pub deleted_at: Option<i64>,
    #[serde(alias = "rootKey")]
    pub root_key: Option<String>,
    #[serde(alias = "relativePath")]
    pub relative_path: Option<String>,
    #[serde(flatten)]
    pub extras: BTreeMap<String, Value>,
}

fn canonicalize_table_row<T, F>(value: Value, validate: F) -> Result<Value>
where
    T: DeserializeOwned + Serialize,
    F: FnOnce(&T) -> Result<()>,
{
    let row: T = serde_json::from_value(value)?;
    validate(&row)?;
    Ok(serde_json::to_value(row)?)
}

fn ensure_non_empty(value: &str, message: &str) -> Result<()> {
    if value.trim().is_empty() {
        bail!(message.to_string());
    }
    Ok(())
}

pub fn canonicalize_row(logical_table: &str, value: Value) -> Result<Value> {
    match logical_table {
        "events" => canonicalize_table_row::<EventRow, _>(value, |row| {
            ensure_non_empty(
                &row.household_id,
                &format!(
                    "import: events[{}] missing household_id (did you supply camelCase without aliasing?)",
                    row.id
                ),
            )
        }),
        "notes" => canonicalize_table_row::<NoteRow, _>(value, |row| {
            ensure_non_empty(
                &row.household_id,
                &format!(
                    "import: notes[{}] missing household_id (did you supply camelCase without aliasing?)",
                    row.id
                ),
            )
        }),
        "household" | "households" => {
            canonicalize_table_row::<HouseholdRow, _>(value, |_row| Ok(()))
        }
        "files" | "files_index" => canonicalize_table_row::<FileIndexRow, _>(value, |row| {
            ensure_non_empty(
                &row.household_id,
                &format!(
                    "import: files_index[{}] missing household_id (did you supply camelCase without aliasing?)",
                    row.id
                ),
            )?;
            ensure_non_empty(
                &row.file_id,
                &format!(
                    "import: files_index[{}] missing file_id (did you supply camelCase without aliasing?)",
                    row.id
                ),
            )
        }),
        "bills" => canonicalize_table_row::<BillRow, _>(value, |row| {
            ensure_non_empty(
                &row.household_id,
                &format!(
                    "import: bills[{}] missing household_id (did you supply camelCase without aliasing?)",
                    row.id
                ),
            )
        }),
        "policies" => canonicalize_table_row::<PolicyRow, _>(value, |row| {
            ensure_non_empty(
                &row.household_id,
                &format!(
                    "import: policies[{}] missing household_id (did you supply camelCase without aliasing?)",
                    row.id
                ),
            )
        }),
        "property_documents" => canonicalize_table_row::<PropertyDocumentRow, _>(value, |row| {
            ensure_non_empty(
                &row.household_id,
                &format!(
                    "import: property_documents[{}] missing household_id (did you supply camelCase without aliasing?)",
                    row.id
                ),
            )
        }),
        "inventory_items" => canonicalize_table_row::<InventoryItemRow, _>(value, |row| {
            ensure_non_empty(
                &row.household_id,
                &format!(
                    "import: inventory_items[{}] missing household_id (did you supply camelCase without aliasing?)",
                    row.id
                ),
            )
        }),
        "vehicle_maintenance" => canonicalize_table_row::<VehicleMaintenanceRow, _>(value, |row| {
            ensure_non_empty(
                &row.household_id,
                &format!(
                    "import: vehicle_maintenance[{}] missing household_id (did you supply camelCase without aliasing?)",
                    row.id
                ),
            )?;
            ensure_non_empty(
                &row.vehicle_id,
                &format!(
                    "import: vehicle_maintenance[{}] missing vehicle_id (did you supply camelCase without aliasing?)",
                    row.id
                ),
            )
        }),
        "pet_medical" => canonicalize_table_row::<PetMedicalRow, _>(value, |row| {
            ensure_non_empty(
                &row.household_id,
                &format!(
                    "import: pet_medical[{}] missing household_id (did you supply camelCase without aliasing?)",
                    row.id
                ),
            )?;
            ensure_non_empty(
                &row.pet_id,
                &format!(
                    "import: pet_medical[{}] missing pet_id (did you supply camelCase without aliasing?)",
                    row.id
                ),
            )
        }),
        _ => Ok(value),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn load_value(json: &str) -> Value {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn events_accept_both_key_styles() {
        let snake = load_value(
            r#"{"id":"evt1","title":"Test","household_id":"hh1","created_at":1,"updated_at":2,"start_at_utc":3,"end_at_utc":4}"#,
        );
        let camel = load_value(
            r#"{"id":"evt1","title":"Test","householdId":"hh1","createdAt":1,"updatedAt":2,"startAtUtc":3,"endAtUtc":4}"#,
        );

        let snake_norm = canonicalize_row("events", snake).unwrap();
        let camel_norm = canonicalize_row("events", camel).unwrap();

        assert_eq!(snake_norm, camel_norm);
    }

    #[test]
    fn notes_accept_both_key_styles() {
        let snake = load_value(
            r#"{"id":"note1","household_id":"hh1","position":1,"z":2,"created_at":3,"updated_at":4}"#,
        );
        let camel = load_value(
            r#"{"id":"note1","householdId":"hh1","position":1,"z":2,"createdAt":3,"updatedAt":4}"#,
        );

        let snake_norm = canonicalize_row("notes", snake).unwrap();
        let camel_norm = canonicalize_row("notes", camel).unwrap();

        assert_eq!(snake_norm, camel_norm);
    }

    #[test]
    fn households_accept_both_key_styles() {
        let snake =
            load_value(r#"{"id":"hh1","name":"Home","tz":"UTC","created_at":1,"updated_at":2}"#);
        let camel = load_value(
            r#"{"id":"hh1","name":"Home","timeZone":"UTC","createdAt":1,"updatedAt":2}"#,
        );

        let snake_norm = canonicalize_row("household", snake).unwrap();
        let camel_norm = canonicalize_row("household", camel).unwrap();

        assert_eq!(snake_norm, camel_norm);
    }

    #[test]
    fn bills_accept_both_key_styles() {
        let snake = load_value(
            r#"{"id":"bill1","amount":100,"due_date":1,"household_id":"hh1","created_at":2,"updated_at":3,"deleted_at":null,"root_key":"attachments","relative_path":"docs/a.txt"}"#,
        );
        let camel = load_value(
            r#"{"id":"bill1","amount":100,"dueDate":1,"householdId":"hh1","createdAt":2,"updatedAt":3,"deletedAt":null,"rootKey":"attachments","relativePath":"docs/a.txt"}"#,
        );

        let snake_norm = canonicalize_row("bills", snake).unwrap();
        let camel_norm = canonicalize_row("bills", camel).unwrap();

        assert_eq!(snake_norm, camel_norm);
    }

    #[test]
    fn files_index_accepts_both_key_styles() {
        let snake = load_value(
            r#"{"id":1,"household_id":"hh1","file_id":"f1","filename":"File","updated_at_utc":"2024","ordinal":0,"score_hint":1}"#,
        );
        let camel = load_value(
            r#"{"id":1,"householdId":"hh1","fileId":"f1","filename":"File","updatedAtUtc":"2024","ordinal":0,"scoreHint":1}"#,
        );

        let snake_norm = canonicalize_row("files_index", snake).unwrap();
        let camel_norm = canonicalize_row("files_index", camel).unwrap();

        assert_eq!(snake_norm, camel_norm);
    }
}
