import type { FamilyMember } from "./family.types";

const MS_PER_DAY = 86_400_000;

export const UPCOMING_BIRTHDAY_WINDOW_DAYS = 60;

export interface UpcomingBirthdayEntry {
  member: FamilyMember;
  occursOn: Date;
  daysUntil: number;
  adjustedForLeapDay: boolean;
}

function toUtcDate(year: number, month: number, day: number): number {
  return Date.UTC(year, month, day);
}

function computeNextOccurrence(
  member: FamilyMember,
  referenceDate: Date,
): UpcomingBirthdayEntry | null {
  if (!member.birthday) return null;
  const birthDate = new Date(member.birthday);
  const month = birthDate.getUTCMonth();
  const day = birthDate.getUTCDate();
  const referenceUtc = toUtcDate(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    referenceDate.getUTCDate(),
  );

  let targetYear = referenceDate.getUTCFullYear();
  let occurrenceUtc = toUtcDate(targetYear, month, day);
  if (occurrenceUtc < referenceUtc) {
    targetYear += 1;
    occurrenceUtc = toUtcDate(targetYear, month, day);
  }

  const occurrence = new Date(occurrenceUtc);
  const adjustedForLeapDay = occurrence.getUTCMonth() !== month || occurrence.getUTCDate() !== day;
  const normalizedOccurrenceUtc = toUtcDate(
    occurrence.getUTCFullYear(),
    occurrence.getUTCMonth(),
    occurrence.getUTCDate(),
  );
  const diffDays = Math.max(
    0,
    Math.round((normalizedOccurrenceUtc - referenceUtc) / MS_PER_DAY),
  );

  return {
    member,
    occursOn: occurrence,
    daysUntil: diffDays,
    adjustedForLeapDay,
  };
}

function collectBirthdayEntries(
  members: FamilyMember[],
  referenceDate: Date,
): UpcomingBirthdayEntry[] {
  const entries: UpcomingBirthdayEntry[] = [];
  for (const member of members) {
    const entry = computeNextOccurrence(member, referenceDate);
    if (entry) {
      entries.push(entry);
    }
  }
  entries.sort((a, b) => {
    if (a.daysUntil !== b.daysUntil) return a.daysUntil - b.daysUntil;
    const nameA = (a.member.nickname ?? a.member.name ?? "").toLocaleLowerCase();
    const nameB = (b.member.nickname ?? b.member.name ?? "").toLocaleLowerCase();
    if (nameA && nameB) {
      const comparison = nameA.localeCompare(nameB, undefined, { sensitivity: "base" });
      if (comparison !== 0) return comparison;
    }
    const fallbackA = a.member.nickname ?? a.member.name;
    const fallbackB = b.member.nickname ?? b.member.name;
    if (fallbackA && fallbackB) {
      const comparison = fallbackA.localeCompare(fallbackB, undefined, { sensitivity: "base" });
      if (comparison !== 0) return comparison;
    }
    return a.member.id.localeCompare(b.member.id);
  });
  return entries;
}

export function getUpcomingBirthdays(
  members: FamilyMember[],
  windowDays = UPCOMING_BIRTHDAY_WINDOW_DAYS,
  referenceDate: Date = new Date(),
): UpcomingBirthdayEntry[] {
  if (windowDays < 0) return [];
  const entries = collectBirthdayEntries(members, referenceDate);
  return entries.filter((entry) => entry.daysUntil <= windowDays).slice(0, 3);
}

export function getNextBirthday(
  members: FamilyMember[],
  referenceDate: Date = new Date(),
): UpcomingBirthdayEntry | null {
  const entries = collectBirthdayEntries(members, referenceDate);
  return entries.length > 0 ? entries[0] : null;
}
