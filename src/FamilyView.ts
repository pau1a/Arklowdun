// src/FamilyView.ts
import { ENABLE_FAMILY_EXPANSION } from "./config/flags";
import { familyStore } from "./features/family/family.store";
import type { FamilyMember } from "./features/family/family.types";
import { createFamilyShell } from "./features/family/FamilyShell";
import { createFamilyGrid, type FamilyGridInstance } from "./features/family/FamilyGrid";
import { createFamilyDrawer, type FamilyDrawerInstance } from "./features/family/FamilyDrawer";
import { mountAddMemberModal, type AddMemberModalInstance } from "./features/family/modal";
import { getNextBirthday, getUpcomingBirthdays } from "./features/family/family.utils";
import { getHouseholdIdForCalls } from "./db/household";
import { logUI } from "@lib/uiLog";
import { runViewCleanups, registerViewCleanup } from "./utils/viewLifecycle";
import {
  subscribe as subscribeHouseholdStore,
  selectors as householdSelectors,
} from "./state/householdStore";
import type { HouseholdRecord } from "./api/households";
import { on } from "./store/events";
import { updatePageBanner } from "./ui/updatePageBanner";

type FamilyViewDeps = {
  getHouseholdId?: () => Promise<string>;
  log?: typeof logUI;
};

export async function FamilyView(container: HTMLElement, deps?: FamilyViewDeps) {
  runViewCleanups(container);

  const shell = createFamilyShell(container);
  try {
    updatePageBanner({ id: "family", display: { label: "Family" } });
  } catch {
    // Router may already manage the banner; ignore failures.
  }
  const section = shell.contentHost;

  const emitLog = deps?.log ?? logUI;
  const resolveHouseholdId = deps?.getHouseholdId ?? getHouseholdIdForCalls;
  const householdId = await resolveHouseholdId();
  await familyStore.load(householdId);

  let members: FamilyMember[] = familyStore.getAll();
  let grid: FamilyGridInstance | null = null;
  let drawer: FamilyDrawerInstance | null = null;
  let gridScrollTop = 0;
  let unsubscribed = false;
  let household: HouseholdRecord | null = null;
  let addMemberModal: AddMemberModalInstance | null = null;
  let removeMemberAddedListener: (() => void) | null = null;

  const updateWidgets = () => {
    const upcoming = getUpcomingBirthdays(members);
    const nextBirthday = getNextBirthday(members);
    shell.header.update({
      householdName: household?.name ?? null,
      memberCount: members.length,
      nextBirthday,
    });
    shell.banner.update(upcoming, { totalMembers: members.length });
  };

  const unsubscribe = familyStore.subscribe((state) => {
    if (unsubscribed) return;
    if (state.hydratedHouseholdId !== householdId) return;
    members = familyStore.getAll();
    if (grid) {
      gridScrollTop = grid.getScrollPosition();
      grid.update(members);
      grid.setScrollPosition(gridScrollTop);
    }
    if (drawer?.isOpen()) {
      drawer.sync();
    }
    updateWidgets();
  });

  const unsubscribeHousehold = subscribeHouseholdStore(
    householdSelectors.activeHousehold,
    (record) => {
      household = record;
      updateWidgets();
    },
  );

  registerViewCleanup(container, () => {
    unsubscribed = true;
    unsubscribe();
    unsubscribeHousehold();
    if (grid) {
      grid.destroy();
      grid = null;
    }
    if (drawer) {
      drawer.destroy();
      drawer = null;
    }
    if (removeMemberAddedListener) {
      removeMemberAddedListener();
      removeMemberAddedListener = null;
    }
    if (addMemberModal) {
      addMemberModal.destroy();
      addMemberModal = null;
    }
    shell.destroy();
  });

  const ensureDrawer = () => {
    if (!drawer) {
      drawer = createFamilyDrawer({
        getMember: (id) => familyStore.get(id),
        saveMember: (patch) => familyStore.upsert(patch),
        resolveVerifierName: async () => household?.name ?? "You",
        onClose: () => {
          grid?.setScrollPosition(gridScrollTop);
        },
      });
    }
    return drawer;
  };

  const mountGrid = () => {
    grid?.destroy();
    grid = createFamilyGrid(section, {
      members,
      householdId,
      onSelect(member, context) {
        gridScrollTop = context.scrollTop;
        emitLog("INFO", "family.ui.grid.select", {
          household_id: householdId,
          member_id: member.id,
        });
        context.restoreScroll();
        if (!ENABLE_FAMILY_EXPANSION) {
          return;
        }
        ensureDrawer().open(member.id);
      },
    });
    grid.setScrollPosition(gridScrollTop);
    updateWidgets();
  };

  if (ENABLE_FAMILY_EXPANSION) {
    addMemberModal = mountAddMemberModal({
      householdId,
      getMemberCount: () => familyStore.getAll().length,
    });
    shell.header.setAddMemberHandler(() => {
      addMemberModal?.open();
    });
    console.log("PR8 wiring", {
      wired: true,
      EXP: ENABLE_FAMILY_EXPANSION,
    });
    removeMemberAddedListener = on("family:memberAdded", (payload) => {
      if (payload.householdId !== householdId) return;
      if (!grid) return;
      const schedule =
        typeof window !== "undefined" && typeof window.setTimeout === "function"
          ? window.setTimeout.bind(window)
          : (fn: () => void, delay: number) => setTimeout(fn, delay);
      let attempts = 0;
      const maxAttempts = 10;
      const focusMember = () => {
        attempts += 1;
        if (!grid) return;
        const focused = grid.focusMember(payload.memberId);
        if (focused || attempts >= maxAttempts) {
          if (focused) {
            gridScrollTop = grid.getScrollPosition();
          }
          return;
        }
        schedule(focusMember, 16);
      };
      if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(focusMember);
      } else {
        focusMember();
      }
    });
  } else {
    shell.header.setAddMemberHandler(null);
  }

  mountGrid();
}
