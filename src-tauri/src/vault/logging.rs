use std::path::Path;

use crate::security::hash_path;

pub fn hash_for_logging<P>(path: P) -> String
where
    P: AsRef<Path>,
{
    hash_path(path.as_ref())
}

#[macro_export]
macro_rules! vault_log {
    (
        level: $level:ident,
        event: $event:expr,
        outcome: $outcome:expr,
        household_id = $household:expr,
        category = $category:expr,
        path = $path:expr
        $(, duration_ms = $duration:expr)?
        $(, $field:ident = $value:expr)*
        $(,)?
    ) => {{
        let hashed_path = $crate::vault::logging::hash_for_logging($path);
        tracing::$level!(
            target: "arklowdun",
            event = $event,
            outcome = $outcome,
            household_id = $household,
            category = $category,
            path_hash = %hashed_path,
            $(duration_ms = $duration,)?
            $($field = $value,)*
        );
    }};
}
