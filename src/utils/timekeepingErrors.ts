import type { AppError } from "@bindings/AppError";
import { normalizeError } from "../api/call";

export interface TimekeepingErrorDisplay {
  error: AppError;
  message: string;
  detail?: string;
}

type CopyEntry = {
  message: string;
};

const TIME_ERROR_COPY: Record<string, CopyEntry> = {
  E_EXDATE_INVALID_FORMAT: {
    message: "One or more excluded dates are invalid. Please check format (YYYY-MM-DD).",
  },
  E_EXDATE_OUT_OF_RANGE: {
    message: "One or more excluded dates fall outside the event's schedule. Please adjust or remove them.",
  },
  E_RRULE_UNSUPPORTED_FIELD: {
    message: "This repeat pattern is not yet supported.",
  },
  E_TZ_UNKNOWN: {
    message: "This event has an unrecognised timezone. Please edit and select a valid timezone.",
  },
  E_TZ_DRIFT_DETECTED: {
    message: "Some events no longer align with their saved timezone. Review the affected items before continuing.",
  },
};

const formatContext = (context: Record<string, string> | undefined): string | undefined => {
  if (!context) return undefined;
  const entries = Object.entries(context);
  if (!entries.length) return undefined;
  return entries.map(([key, value]) => `${key}: ${value}`).join("\n");
};

export function describeTimekeepingError(errorLike: unknown): TimekeepingErrorDisplay {
  const error = normalizeError(errorLike);
  const copy = TIME_ERROR_COPY[error.code];
  const detailParts: string[] = [];
  if (!copy || copy.message !== error.message) {
    detailParts.push(error.message);
  }
  const contextDetail = formatContext(error.context);
  if (contextDetail) detailParts.push(contextDetail);
  return {
    error,
    message: copy?.message ?? error.message,
    detail: detailParts.length ? detailParts.join("\n") : undefined,
  };
}
