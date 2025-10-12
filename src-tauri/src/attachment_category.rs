use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;
use thiserror::Error;
use ts_rs::TS;

/// Canonical attachment category shared across backend and frontend.
///
/// The list is intentionally finite and comprised of filesystem safe
/// identifiers.  The generated TypeScript binding is treated as the
/// source of truth for the UI layer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../src/bindings/", rename_all = "snake_case")]
pub enum AttachmentCategory {
    Bills,
    Policies,
    PropertyDocuments,
    InventoryItems,
    PetMedical,
    PetImage,
    Vehicles,
    VehicleMaintenance,
    Notes,
    Misc,
}

impl AttachmentCategory {
    pub const ALL: [AttachmentCategory; 10] = [
        AttachmentCategory::Bills,
        AttachmentCategory::Policies,
        AttachmentCategory::PropertyDocuments,
        AttachmentCategory::InventoryItems,
        AttachmentCategory::PetMedical,
        AttachmentCategory::PetImage,
        AttachmentCategory::Vehicles,
        AttachmentCategory::VehicleMaintenance,
        AttachmentCategory::Notes,
        AttachmentCategory::Misc,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            AttachmentCategory::Bills => "bills",
            AttachmentCategory::Policies => "policies",
            AttachmentCategory::PropertyDocuments => "property_documents",
            AttachmentCategory::InventoryItems => "inventory_items",
            AttachmentCategory::PetMedical => "pet_medical",
            AttachmentCategory::PetImage => "pet_image",
            AttachmentCategory::Vehicles => "vehicles",
            AttachmentCategory::VehicleMaintenance => "vehicle_maintenance",
            AttachmentCategory::Notes => "notes",
            AttachmentCategory::Misc => "misc",
        }
    }

    pub fn iter() -> impl Iterator<Item = AttachmentCategory> {
        Self::ALL.into_iter()
    }

    /// Map a known database table to its canonical attachment category.
    pub fn for_table(table: &str) -> Option<Self> {
        match table {
            "bills" => Some(AttachmentCategory::Bills),
            "policies" => Some(AttachmentCategory::Policies),
            "property_documents" => Some(AttachmentCategory::PropertyDocuments),
            "inventory_items" => Some(AttachmentCategory::InventoryItems),
            "pet_medical" => Some(AttachmentCategory::PetMedical),
            "pets" => Some(AttachmentCategory::PetImage),
            "vehicles" => Some(AttachmentCategory::Vehicles),
            "vehicle_maintenance" => Some(AttachmentCategory::VehicleMaintenance),
            "notes" => Some(AttachmentCategory::Notes),
            "member_attachments" => Some(AttachmentCategory::Misc),
            _ => None,
        }
    }
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
#[error("invalid attachment category: {value}")]
pub struct AttachmentCategoryError {
    value: String,
}

impl AttachmentCategoryError {
    pub fn new(value: impl Into<String>) -> Self {
        Self {
            value: value.into(),
        }
    }

    pub fn value(&self) -> &str {
        &self.value
    }
}

impl FromStr for AttachmentCategory {
    type Err = AttachmentCategoryError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "bills" => Ok(AttachmentCategory::Bills),
            "policies" => Ok(AttachmentCategory::Policies),
            "property_documents" => Ok(AttachmentCategory::PropertyDocuments),
            "inventory_items" => Ok(AttachmentCategory::InventoryItems),
            "pet_medical" => Ok(AttachmentCategory::PetMedical),
            "pet_image" => Ok(AttachmentCategory::PetImage),
            "vehicles" => Ok(AttachmentCategory::Vehicles),
            "vehicle_maintenance" => Ok(AttachmentCategory::VehicleMaintenance),
            "notes" => Ok(AttachmentCategory::Notes),
            "misc" => Ok(AttachmentCategory::Misc),
            other => Err(AttachmentCategoryError::new(other)),
        }
    }
}

impl fmt::Display for AttachmentCategory {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::AttachmentCategory;
    use std::str::FromStr;

    #[test]
    fn round_trips() {
        for variant in AttachmentCategory::iter() {
            let slug = variant.as_str();
            let parsed = AttachmentCategory::from_str(slug).expect("parse");
            assert_eq!(variant, parsed);
            assert_eq!(slug, parsed.to_string());
        }
    }

    #[test]
    fn rejects_unknown() {
        let err = AttachmentCategory::from_str("unknown").unwrap_err();
        assert_eq!(err.value(), "unknown");
    }
}
