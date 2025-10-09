// src/FamilyView.ts
import { familyStore } from "./features/family/family.store";
import type { FamilyMember } from "./features/family/family.types";
import { createFamilyShell } from "./features/family/FamilyShell";
import { createFamilyGrid, type FamilyGridInstance } from "./features/family/FamilyGrid";
import { getNextBirthday, getUpcomingBirthdays } from "./features/family/family.utils";
import { getHouseholdIdForCalls } from "./db/household";
import { logUI } from "@lib/uiLog";
import { runViewCleanups, registerViewCleanup } from "./utils/viewLifecycle";
import {
  subscribe as subscribeHouseholdStore,
  selectors as householdSelectors,
} from "./state/householdStore";
import type { HouseholdRecord } from "./api/households";

type FamilyViewDeps = {
  getHouseholdId?: () => Promise<string>;
  log?: typeof logUI;
};

export async function FamilyView(container: HTMLElement, deps?: FamilyViewDeps) {
  runViewCleanups(container);

  const shell = createFamilyShell(container);
  const section = shell.contentHost;

  const emitLog = deps?.log ?? logUI;
  const resolveHouseholdId = deps?.getHouseholdId ?? getHouseholdIdForCalls;
  const householdId = await resolveHouseholdId();
  await familyStore.load(householdId);

  let members: FamilyMember[] = familyStore.getAll();
  let grid: FamilyGridInstance | null = null;
  let gridScrollTop = 0;
  let unsubscribed = false;
  let household: HouseholdRecord | null = null;

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
    shell.destroy();
  });

  const mountGrid = () => {
    grid?.destroy();
    grid = createFamilyGrid(section, {
      members,
      householdId,
      onSelect(member, context) {
        gridScrollTop = context.scrollTop;
        emitLog("INFO", "ui.family.grid.select", {
          household_id: householdId,
          member_id: member.id,
        });
        context.restoreScroll();
        // Drawer integration arrives in PR7; stub for now.
        console.info("FamilyGrid:select", { member });
      },
    });
    grid.setScrollPosition(gridScrollTop);
    updateWidgets();
  };

  mountGrid();
}
