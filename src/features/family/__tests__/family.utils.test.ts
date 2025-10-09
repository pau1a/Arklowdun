import { describe, expect, it } from "vitest";

import type { FamilyMember } from "../family.types";
import {
  getNextBirthday,
  getUpcomingBirthdays,
  UPCOMING_BIRTHDAY_WINDOW_DAYS,
} from "../family.utils";

function createMember(
  id: string,
  birthdayUtc: number | null,
  overrides: Partial<FamilyMember> = {},
): FamilyMember {
  return {
    id,
    householdId: "hh-1",
    name: `Member ${id}`,
    birthday: birthdayUtc,
    notes: null,
    address: null,
    email: null,
    phone: {},
    ...overrides,
  } as FamilyMember;
}

describe("getUpcomingBirthdays", () => {
  it("returns up to three members within the window sorted by date then name", () => {
    const reference = new Date(Date.UTC(2024, 3, 1));
    const members: FamilyMember[] = [
      createMember("a", Date.UTC(1990, 4, 10), { nickname: "Zoey" }),
      createMember("b", Date.UTC(1988, 4, 1), { nickname: "Alex" }),
      createMember("c", Date.UTC(1985, 3, 30), { nickname: "Chris" }),
      createMember("d", Date.UTC(1992, 4, 1), { nickname: "Bea" }),
      createMember("e", Date.UTC(1991, 9, 12)),
    ];

    const upcoming = getUpcomingBirthdays(
      members,
      UPCOMING_BIRTHDAY_WINDOW_DAYS,
      reference,
    );

    expect(upcoming).toHaveLength(3);
    expect(upcoming.map((entry) => entry.member.id)).toEqual(["c", "b", "d"]);
    expect(upcoming[0].daysUntil).toBe(29);
    expect(upcoming[1].daysUntil).toBe(30);
  });

  it("excludes members outside the window", () => {
    const reference = new Date(Date.UTC(2024, 0, 1));
    const members = [
      createMember("soon", Date.UTC(1980, 0, 2)),
      createMember("later", Date.UTC(1980, 3, 1)),
    ];

    const upcoming = getUpcomingBirthdays(members, 30, reference);
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].member.id).toBe("soon");
  });

  it("adjusts leap-day birthdays on non-leap years", () => {
    const reference = new Date(Date.UTC(2025, 0, 15));
    const members = [createMember("leap", Date.UTC(1992, 1, 29))];

    const upcoming = getUpcomingBirthdays(
      members,
      UPCOMING_BIRTHDAY_WINDOW_DAYS,
      reference,
    );
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].adjustedForLeapDay).toBe(true);
    expect(upcoming[0].occursOn.toISOString().slice(0, 10)).toBe("2025-03-01");
  });
});

describe("getNextBirthday", () => {
  it("returns the next chronological birthday even when wrapping to a new year", () => {
    const reference = new Date(Date.UTC(2024, 10, 20));
    const members = [
      createMember("jan", Date.UTC(1980, 0, 5), { nickname: "Ada" }),
      createMember("dec", Date.UTC(1980, 11, 25), { nickname: "Neil" }),
    ];

    const next = getNextBirthday(members, reference);
    expect(next).not.toBeNull();
    expect(next?.member.id).toBe("dec");
    expect(next?.daysUntil).toBe(35);
  });

  it("returns null when no birthdays are available", () => {
    const reference = new Date(Date.UTC(2024, 0, 1));
    const members = [createMember("no-bday", null)];
    expect(getNextBirthday(members, reference)).toBeNull();
  });
});
