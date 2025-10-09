import type { FamilyMember } from "./family.types";

const birthdayFormatter = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
});

function formatDisplayName(member: FamilyMember): string {
  const nickname = member.nickname ?? member.fullName;
  if (typeof nickname === "string" && nickname.trim().length > 0) {
    return nickname.trim();
  }
  return member.name?.trim() ?? "Unnamed member";
}

function formatRelationship(relationship: string | null | undefined): string {
  if (!relationship) return "";
  const trimmed = relationship.trim();
  return trimmed.length > 0 ? trimmed : "";
}

function formatBirthday(birthday: number | null | undefined): string {
  if (typeof birthday !== "number" || !Number.isFinite(birthday)) {
    return "";
  }

  try {
    return birthdayFormatter.format(new Date(birthday));
  } catch (error) {
    console.warn("FamilyCard:failed-format-birthday", error);
    return "";
  }
}

export function createFamilyCard(member: FamilyMember): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "family-card";
  button.dataset.memberId = member.id;
  button.setAttribute(
    "aria-label",
    `Open member profile for ${formatDisplayName(member)}`,
  );

  const header = document.createElement("div");
  header.className = "family-card__header";

  const name = document.createElement("h3");
  name.className = "family-card__name";
  name.textContent = formatDisplayName(member);

  const birthday = document.createElement("span");
  birthday.className = "family-card__birthday-badge";
  const birthdayText = formatBirthday(member.birthday ?? null);
  if (birthdayText) {
    birthday.textContent = birthdayText;
  } else {
    birthday.hidden = true;
    birthday.setAttribute("aria-hidden", "true");
  }

  header.append(name, birthday);

  const relationship = document.createElement("p");
  relationship.className = "family-card__relationship";
  const relationshipText = formatRelationship(member.relationship ?? null);
  if (relationshipText) {
    relationship.textContent = relationshipText;
  } else {
    relationship.textContent = "";
    relationship.hidden = true;
    relationship.setAttribute("aria-hidden", "true");
  }

  button.append(header, relationship);

  return button;
}

