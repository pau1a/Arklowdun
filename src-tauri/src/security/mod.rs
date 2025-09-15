pub mod error_map;
pub mod fs_policy;

use sha2::{Digest, Sha256};
use std::path::Path;

pub fn hash_path(p: &Path) -> String {
    let mut h = Sha256::new();
    h.update(p.as_os_str().to_string_lossy().as_bytes());
    format!("{:x}", h.finalize())
}

#[cfg(test)]
mod fs_policy_tests;
