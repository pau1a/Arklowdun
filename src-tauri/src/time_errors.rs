use crate::AppError;

/// Stable taxonomy of timekeeping error codes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimeErrorCode {
    /// EXDATE input failed to parse as ISO-8601 UTC.
    ExdateInvalidFormat,
    /// EXDATE token falls outside the recurrence window.
    ExdateOutOfRange,
    /// RRULE string failed to parse.
    RruleParse,
    /// RRULE contains fields or combinations that are not supported yet.
    RruleUnsupportedField,
    /// Event timezone string could not be resolved to a known IANA timezone.
    TimezoneUnknown,
    /// Stored event timestamps no longer line up with the recorded timezone offsets.
    TimezoneDriftDetected,
    /// Requested range window has an invalid ordering.
    RangeInvalid,
}

impl TimeErrorCode {
    /// Returns the stable machine-readable code string.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            TimeErrorCode::ExdateInvalidFormat => "E_EXDATE_INVALID_FORMAT",
            TimeErrorCode::ExdateOutOfRange => "E_EXDATE_OUT_OF_RANGE",
            TimeErrorCode::RruleParse => "E_RRULE_PARSE",
            TimeErrorCode::RruleUnsupportedField => "E_RRULE_UNSUPPORTED_FIELD",
            TimeErrorCode::TimezoneUnknown => "E_TZ_UNKNOWN",
            TimeErrorCode::TimezoneDriftDetected => "E_TZ_DRIFT_DETECTED",
            TimeErrorCode::RangeInvalid => "E_RANGE_INVALID",
        }
    }

    /// Returns the canonical developer-facing message associated with the code.
    #[must_use]
    pub fn developer_message(self) -> &'static str {
        match self {
            TimeErrorCode::ExdateInvalidFormat => {
                "Excluded dates must use ISO-8601 UTC format (YYYY-MM-DDTHH:MM:SSZ)."
            }
            TimeErrorCode::ExdateOutOfRange => {
                "Excluded dates must fall within the recurrence window."
            }
            TimeErrorCode::RruleParse => {
                "Recurrence rule could not be parsed. Please check the syntax."
            }
            TimeErrorCode::RruleUnsupportedField => {
                "Recurrence rule contains fields that are not supported."
            }
            TimeErrorCode::TimezoneUnknown => {
                "Timezone identifier could not be resolved to a known location."
            }
            TimeErrorCode::TimezoneDriftDetected => {
                "Stored event timestamps drifted away from their timezone offsets."
            }
            TimeErrorCode::RangeInvalid => {
                "The requested time range is invalid. Start must be before end."
            }
        }
    }

    /// Convenience helper to create an [`AppError`] with this taxonomy entry.
    #[must_use]
    pub fn into_error(self) -> AppError {
        AppError::new(self.as_str(), self.developer_message())
    }
}

/// Public helper returning all taxonomy entries.
#[must_use]
pub fn all_time_error_specs() -> &'static [(TimeErrorCode, &'static str)] {
    &[
        (
            TimeErrorCode::ExdateInvalidFormat,
            "One or more excluded dates are invalid. Please check format (YYYY-MM-DD).",
        ),
        (
            TimeErrorCode::ExdateOutOfRange,
            "Excluded dates must fall within the recurrence window.",
        ),
        (
            TimeErrorCode::RruleParse,
            "We couldn't read that repeat pattern. Please check the format.",
        ),
        (
            TimeErrorCode::RruleUnsupportedField,
            "This repeat pattern is not yet supported.",
        ),
        (
            TimeErrorCode::TimezoneUnknown,
            "This event has an unrecognised timezone. Please edit and select a valid timezone.",
        ),
        (
            TimeErrorCode::TimezoneDriftDetected,
            "Event timestamps no longer align with their expected timezone offsets.",
        ),
        (
            TimeErrorCode::RangeInvalid,
            "Calendar queries need the start to come before the end.",
        ),
    ]
}
