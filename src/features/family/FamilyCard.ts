import type { FamilyMember } from "./family.types";
import { canonicalizeAndVerify } from "@files/path";
import { convertFileSrc } from "@lib/ipc/core";

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

  const avatarWrap = document.createElement("div");
  avatarWrap.className = "family-card__avatar-wrap";
  const avatarImg = document.createElement("img");
  avatarImg.className = "family-card__avatar";
  avatarImg.alt = "";
  avatarImg.hidden = true;
  const avatarFallback = document.createElement("div");
  avatarFallback.className = "family-card__avatar-fallback";
  const initials = (formatDisplayName(member).match(/\b\w/g) || []).slice(0, 2).join("").toUpperCase();
  avatarFallback.textContent = initials || "?";
  avatarWrap.append(avatarImg, avatarFallback);

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

  const titleWrap = document.createElement("div");
  titleWrap.className = "family-card__title";
  titleWrap.append(avatarWrap, name);

  header.append(titleWrap, birthday);

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

  // Attempt to show avatar if we have a photoPath
  const isTauri =
    (typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__) ||
    (typeof (import.meta as any).env?.TAURI !== 'undefined' && (import.meta as any).env?.TAURI != null);
  if (member.photoPath && member.householdId && isTauri) {
    const rel = `attachments/${member.householdId}/misc/${member.photoPath}`;
    void (async () => {
      try {
        const { realPath } = await canonicalizeAndVerify(rel, "appData");
        let loaded = false;
        const trySet = (src: string) =>
          new Promise<void>((resolve) => {
            const onOk = () => {
              loaded = true;
              avatarImg.removeEventListener('error', onErr);
              resolve();
            };
            const onErr = () => {
              avatarImg.removeEventListener('load', onOk);
              resolve();
            };
            avatarImg.addEventListener('load', onOk, { once: true });
            avatarImg.addEventListener('error', onErr, { once: true });
            avatarImg.src = src;
          });

        await trySet(convertFileSrc(realPath));
        if (!loaded) {
          try {
            const mod = await import('@tauri-apps/plugin-fs');
            const bytes = await mod.readFile(realPath);
            const blob = new Blob([bytes], { type: 'image/*' });
            const url = URL.createObjectURL(blob);
            await trySet(url);
          } catch {
            // ignore
          }
        }

        if (loaded) {
          avatarImg.hidden = false;
          avatarFallback.style.display = "none";
        }
      } catch {
        // Ignore failures; fallback remains visible
      }
    })();
  }

  return button;
}
