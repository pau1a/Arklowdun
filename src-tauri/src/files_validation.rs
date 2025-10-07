use unicode_normalization::UnicodeNormalization;

const RESERVED_WINDOWS_NAMES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

const FORBIDDEN_CHARS: [char; 9] = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

const MAX_COMPONENT_BYTES: usize = 255;
const MAX_PATH_BYTES: usize = 4096;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FilenameError {
    Empty,
    RelativeSegment,
    ReservedName,
    TrailingDotOrSpace,
    ForbiddenCharacter,
    ComponentTooLong,
    PathTooLong,
}

impl FilenameError {
    pub fn code(&self) -> &'static str {
        match self {
            FilenameError::Empty => "empty",
            FilenameError::RelativeSegment => "relative-segment",
            FilenameError::ReservedName => "reserved-name",
            FilenameError::TrailingDotOrSpace => "trailing-dot-or-space",
            FilenameError::ForbiddenCharacter => "forbidden-character",
            FilenameError::ComponentTooLong => "component-too-long",
            FilenameError::PathTooLong => "path-too-long",
        }
    }
}

fn has_forbidden_characters(value: &str) -> bool {
    value.chars().any(|c| c.is_control() || FORBIDDEN_CHARS.contains(&c))
}

fn is_reserved_name(value: &str) -> bool {
    let stem = value
        .split_once('.')
        .map(|(stem, _)| stem)
        .unwrap_or(value);

    RESERVED_WINDOWS_NAMES
        .iter()
        .any(|candidate| stem.eq_ignore_ascii_case(candidate))
}

fn has_trailing_dot_or_space(value: &str) -> bool {
    value.trim_end_matches([' ', '.']).len() != value.len()
}

fn compute_path_bytes(parent: Option<&str>, name: &str) -> usize {
    let mut total = name.as_bytes().len();
    if let Some(parent_str) = parent {
        if parent_str != "." {
            for segment in parent_str.replace('\\', "/").split('/') {
                if segment.is_empty() {
                    continue;
                }
                total += segment.as_bytes().len();
            }
        }
    }
    total
}

pub fn sanitize_filename(name: &str, parent: Option<&str>) -> Result<String, FilenameError> {
    if name.is_empty() {
        return Err(FilenameError::Empty);
    }

    if name == "." || name == ".." {
        return Err(FilenameError::RelativeSegment);
    }

    let normalized: String = name.nfc().collect();

    if is_reserved_name(&normalized) {
        return Err(FilenameError::ReservedName);
    }

    if has_trailing_dot_or_space(&normalized) {
        return Err(FilenameError::TrailingDotOrSpace);
    }

    if has_forbidden_characters(&normalized) {
        return Err(FilenameError::ForbiddenCharacter);
    }

    if normalized.as_bytes().len() > MAX_COMPONENT_BYTES {
        return Err(FilenameError::ComponentTooLong);
    }

    if compute_path_bytes(parent, &normalized) > MAX_PATH_BYTES {
        return Err(FilenameError::PathTooLong);
    }

    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct Case {
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        name_repeat: Option<(String, usize)>,
        #[serde(default)]
        parent: Option<String>,
        #[serde(default)]
        parent_repeat: Option<(String, usize)>,
        #[serde(default)]
        parent_segments_repeat: Option<(String, usize)>,
        valid: bool,
        code: Option<String>,
        normalized: Option<String>,
    }

    fn expand(pattern: &str, count: usize) -> String {
        pattern.repeat(count)
    }

    fn resolve_name(case: &Case) -> String {
        if let Some(name) = &case.name {
            return name.clone();
        }
        if let Some((pattern, count)) = &case.name_repeat {
            return expand(pattern, *count);
        }
        String::new()
    }

    fn resolve_parent(case: &Case) -> Option<String> {
        if let Some(parent) = &case.parent {
            return Some(parent.clone());
        }
        if let Some((pattern, count)) = &case.parent_repeat {
            return Some(expand(pattern, *count));
        }
        if let Some((segment, count)) = &case.parent_segments_repeat {
            if *count == 0 {
                return Some(String::new());
            }
            return Some(std::iter::repeat(segment).take(*count).collect::<Vec<_>>().join("/"));
        }
        Some(String::from("."))
    }

    #[test]
    fn parity_with_fixtures() {
        let data = include_str!("../tests/fixtures/filename-validation.json");
        let cases: Vec<Case> = serde_json::from_str(data).expect("fixture parse");
        for case in cases {
            let name = resolve_name(&case);
            let parent = resolve_parent(&case);
            let result = sanitize_filename(&name, parent.as_deref());
            if case.valid {
                let normalized = result.expect("expected valid name");
                if let Some(expected) = case.normalized {
                    assert_eq!(normalized, expected);
                }
            } else {
                let err = result.expect_err("expected validation failure");
                assert_eq!(err.code(), case.code.as_deref().unwrap_or(""));
            }
        }
    }
}

