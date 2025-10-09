import { logUI } from "@lib/uiLog";
import type { FamilyMember } from "./family.types";
import { createFamilyCard } from "./FamilyCard";

export interface FamilyGridSelectContext {
  scrollTop: number;
  restoreScroll(): void;
}

export interface FamilyGridOptions {
  members: FamilyMember[];
  onSelect?: (member: FamilyMember, context: FamilyGridSelectContext) => void;
  householdId?: string;
}

export interface FamilyGridInstance {
  element: HTMLElement;
  update(members: FamilyMember[]): void;
  getScrollPosition(): number;
  setScrollPosition(position: number): void;
  focusMember(memberId: string): boolean;
  destroy(): void;
}

function createEmptyState(): HTMLElement {
  const empty = document.createElement("p");
  empty.className = "family-grid__empty";
  empty.textContent = "No family members yet.";
  empty.setAttribute("role", "note");
  return empty;
}

function scheduleScrollRestore(target: HTMLElement, value: number): void {
  const apply = () => {
    target.scrollTop = value;
  };

  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(apply);
    return;
  }

  setTimeout(apply, 0);
}

export function createFamilyGrid(
  host: HTMLElement,
  options: FamilyGridOptions,
): FamilyGridInstance {
  const element = document.createElement("div");
  element.className = "family-grid";
  element.dataset.widget = "family-grid";
  element.setAttribute("role", "list");
  element.setAttribute("aria-label", "Family members");

  host.innerHTML = "";
  host.appendChild(element);

  let currentMembers: FamilyMember[] = [];
  let memberLookup = new Map<string, FamilyMember>();

  const activateMember = (member: FamilyMember) => {
    if (!options.onSelect) return;
    const scrollTop = element.scrollTop;
    const context: FamilyGridSelectContext = {
      scrollTop,
      restoreScroll() {
        scheduleScrollRestore(element, scrollTop);
      },
    };
    options.onSelect(member, context);
  };

  const render = () => {
    const activeElement = document.activeElement;
    const focusedMemberId =
      activeElement instanceof HTMLElement && element.contains(activeElement)
        ? activeElement.closest<HTMLElement>("[data-member-id]")?.dataset.memberId ?? null
        : null;

    element.replaceChildren();

    if (currentMembers.length === 0) {
      element.appendChild(createEmptyState());
    } else {
      const fragment = document.createDocumentFragment();
      for (const member of currentMembers) {
        const card = createFamilyCard(member);

        const listItem = document.createElement("div");
        listItem.className = "family-grid__item";
        listItem.setAttribute("role", "listitem");
        listItem.appendChild(card);

        fragment.appendChild(listItem);
      }
      element.appendChild(fragment);
    }

    const logPayload: Record<string, unknown> = { count: currentMembers.length };
    if (options.householdId) {
      logPayload.household_id = options.householdId;
    }
    logUI("INFO", "ui.family.grid.render", logPayload);
    console.debug("FamilyGrid:render", { count: currentMembers.length });

    if (focusedMemberId) {
      const nextFocusedCard = element.querySelector<HTMLButtonElement>(
        `.family-card[data-member-id="${focusedMemberId}"]`,
      );
      if (nextFocusedCard) {
        const restoreFocus = () => {
          nextFocusedCard.focus();
        };
        if (
          typeof window !== "undefined" &&
          typeof window.requestAnimationFrame === "function"
        ) {
          window.requestAnimationFrame(restoreFocus);
        } else {
          setTimeout(restoreFocus, 0);
        }
      }
    }
  };

  const setMembers = (members: FamilyMember[]) => {
    currentMembers = [...members];
    memberLookup = new Map(currentMembers.map((member) => [member.id, member]));
    render();
  };

  setMembers(options.members);

  const resolveMemberFromEvent = (target: EventTarget | null): FamilyMember | null => {
    if (!(target instanceof HTMLElement)) return null;
    const button = target.closest<HTMLButtonElement>(".family-card");
    if (!button) return null;
    const memberId = button.dataset.memberId;
    if (!memberId) return null;
    return memberLookup.get(memberId) ?? null;
  };

  const handleClick = (event: Event) => {
    const member = resolveMemberFromEvent(event.target);
    if (!member) return;
    activateMember(member);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    const member = resolveMemberFromEvent(event.target);
    if (!member) return;
    event.preventDefault();
    activateMember(member);
  };

  element.addEventListener("click", handleClick);
  element.addEventListener("keydown", handleKeyDown, true);

  return {
    element,
    update(members: FamilyMember[]) {
      setMembers(members);
    },
    getScrollPosition() {
      return element.scrollTop;
    },
    setScrollPosition(position: number) {
      element.scrollTop = Math.max(0, position);
    },
    focusMember(memberId: string) {
      const card = element.querySelector<HTMLButtonElement>(
        `.family-card[data-member-id="${memberId}"]`,
      );
      if (!card) return false;
      if (typeof card.scrollIntoView === "function") {
        card.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
      if (typeof card.focus === "function") {
        try {
          card.focus({ preventScroll: true });
        } catch {
          card.focus();
        }
      }
      return true;
    },
    destroy() {
      element.removeEventListener("click", handleClick);
      element.removeEventListener("keydown", handleKeyDown, true);
      element.replaceChildren();
      element.remove();
    },
  };
}

