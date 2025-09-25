pub mod bundle;
pub mod execute;
pub mod plan;
pub mod report;
mod rows;
mod table_order;
pub mod validator;

pub use bundle::{AttachmentEntry, DataFileEntry, ImportBundle, ImportBundleError};
pub use execute::{
    execute_plan, AttachmentExecutionSummary, ExecutionContext, ExecutionError, ExecutionReport,
    TableExecutionSummary,
};
pub use plan::{
    build_plan, AttachmentConflict, AttachmentsPlan, ImportMode, ImportPlan, PlanContext,
    PlanError, TableConflict, TablePlan,
};
pub use report::write_import_report;
pub use validator::{validate_bundle, ValidationContext, ValidationError, ValidationReport};

pub const MIN_SUPPORTED_APP_VERSION: &str = "0.1.0";
pub(crate) const ATTACHMENT_TABLES: &[&str] = &[
    "bills",
    "policies",
    "property_documents",
    "inventory_items",
    "vehicle_maintenance",
    "pet_medical",
];
