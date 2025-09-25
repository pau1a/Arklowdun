const HOUSEHOLD_RANK: u16 = 0;
const FILES_RANK: u16 = 10;
const HOUSEHOLD_CHILD_RANK: u16 = 20;
const EVENTS_RANK: u16 = 30;
const NOTES_RANK: u16 = 40;
const DEFAULT_RANK: u16 = 1000;

pub(crate) fn table_order_key<'a>(logical: &'a str) -> (u16, &'a str) {
    let rank = match logical {
        "household" | "households" => HOUSEHOLD_RANK,
        "files" | "files_index" => FILES_RANK,
        "bills"
        | "policies"
        | "property_documents"
        | "inventory_items"
        | "vehicle_maintenance"
        | "pet_medical" => HOUSEHOLD_CHILD_RANK,
        "events" => EVENTS_RANK,
        "notes" => NOTES_RANK,
        _ => DEFAULT_RANK,
    };

    (rank, logical)
}
