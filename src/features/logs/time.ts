import { DateTime } from "luxon";

const LOCAL_ZONE = "Europe/London";
const DISPLAY_FORMAT = "yyyy-MM-dd HH:mm:ss";

function normalizeLabel(label: string, fallback: string): string {
  const upper = label.toUpperCase();
  if (upper === "GMT+1" || upper === "UTC+1") {
    return "BST";
  }
  if (upper === "GMT" || upper === "UTC") {
    return upper;
  }
  if (upper.includes("BRITISH SUMMER TIME")) {
    return "BST";
  }
  if (upper.includes("GREENWICH MEAN TIME")) {
    return "GMT";
  }
  return label || fallback;
}

function getDisplayLabel(dateTime: DateTime, fallback: string): string {
  const label = dateTime.offsetNameShort || dateTime.offsetNameLong || fallback;
  return normalizeLabel(label, fallback);
}

export function formatTimestamp(timestamp: string, toLocal: boolean): string {
  const base = DateTime.fromISO(timestamp, { zone: "utc" });
  if (!base.isValid) {
    return timestamp;
  }

  const zoned = toLocal ? base.setZone(LOCAL_ZONE) : base.setZone("utc");
  const fallbackLabel = toLocal
    ? zoned.offset === 0
      ? "GMT"
      : "BST"
    : "UTC";
  const label = getDisplayLabel(zoned, fallbackLabel);
  return `${zoned.toFormat(DISPLAY_FORMAT)} ${label}`;
}

export function getZoneLabel(toLocal: boolean): string {
  if (!toLocal) {
    return "UTC";
  }
  const now = DateTime.now().setZone(LOCAL_ZONE);
  return getDisplayLabel(now, "GMT");
}
