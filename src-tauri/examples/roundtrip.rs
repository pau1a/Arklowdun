use std::io::{self, Read};

use arklowdun_lib::Event;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;
    if input.trim().is_empty() {
        let event = Event {
            id: "rust-id".into(),
            household_id: "rust-household".into(),
            title: "from rust".into(),
            start_at: 0,
            end_at: 0,
            reminder: None,
            created_at: 0,
            updated_at: 0,
            deleted_at: None,
        };
        println!("{}", serde_json::to_string(&event)?);
    } else {
        let event: Event = serde_json::from_str(&input)?;
        println!("{}", serde_json::to_string(&event)?);
    }
    Ok(())
}
