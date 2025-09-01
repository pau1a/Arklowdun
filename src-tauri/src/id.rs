use uuid::Uuid;

pub fn new_uuid_v7() -> String {
    Uuid::now_v7().to_string()
}
