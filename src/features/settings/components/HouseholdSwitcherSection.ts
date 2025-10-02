import {
  listHouseholds,
  type HouseholdRecord,
  type SetActiveHouseholdErrorCode,
} from "../../../api/households";
import {
  ensureActiveHousehold,
  forceSetActiveHousehold,
  currentActiveHousehold,
} from "../../../state/householdStore";
import { selectors, subscribe, type DbHealthState } from "@store/index";
import { on } from "@store/events";
import createSelect from "@ui/Select";
import createButton from "@ui/Button";
import { toast } from "@ui/Toast";
import { showError } from "@ui/errors";
import { DB_UNHEALTHY_WRITE_BLOCKED } from "@lib/ipc/call";

export interface HouseholdSwitcherSection {
  element: HTMLElement;
  destroy: () => void;
}

function describeError(code: SetActiveHouseholdErrorCode): string {
  switch (code) {
    case "HOUSEHOLD_NOT_FOUND":
      return "The selected household could not be found. Refresh the list and try again.";
    case "HOUSEHOLD_DELETED":
      return "The selected household has been archived. Restore it before switching.";
    default:
      return "Unable to change the active household.";
  }
}

type HealthGate = { disabled: boolean; message: string | null };

function assessHealth(health: DbHealthState | null): HealthGate {
  if (!health) {
    return { disabled: false, message: null };
  }
  if (health.phase === "pending") {
    return {
      disabled: true,
      message: "Checking database health… Switching households is temporarily disabled.",
    };
  }
  if (health.error?.code === DB_UNHEALTHY_WRITE_BLOCKED) {
    return {
      disabled: true,
      message: health.error.message ?? "Resolve database health issues before switching households.",
    };
  }
  if (health.report?.status === "error") {
    return {
      disabled: true,
      message: "Resolve database health issues before switching households.",
    };
  }
  return { disabled: false, message: null };
}

function formatLabel(household: HouseholdRecord, activeId: string | null): string {
  const parts = [household.name];
  if (household.isDefault) {
    parts.push("Default");
  }
  if (household.id === activeId) {
    parts.push("Active");
  }
  return parts.join(" • ");
}

export function createHouseholdSwitcherSection(): HouseholdSwitcherSection {
  const section = document.createElement("section");
  section.className = "card settings__section settings__section--household";
  section.setAttribute("aria-labelledby", "settings-household");

  const heading = document.createElement("h3");
  heading.id = "settings-household";
  heading.textContent = "Household";

  const body = document.createElement("div");
  body.className = "settings__body";

  const helper = document.createElement("p");
  helper.className = "settings__helper";
  helper.textContent =
    "Switch the active household used by Arklowdun. Changes apply immediately across the app.";

  const selectWrapper = document.createElement("label");
  selectWrapper.className = "settings__household-select";

  const selectLabel = document.createElement("span");
  selectLabel.textContent = "Active household";

  const select = createSelect({
    ariaLabel: "Active household",
    disabled: true,
  });
  select.update({ className: "settings__household-select-input" });

  selectWrapper.append(selectLabel, select);

  const actions = document.createElement("div");
  actions.className = "settings__actions";

  const applyButton = createButton({
    label: "Set active household",
    variant: "primary",
    className: "settings__button",
    type: "button",
    disabled: true,
  });

  actions.append(applyButton);

  const status = document.createElement("p");
  status.className = "settings__household-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  body.append(helper, selectWrapper, actions, status);
  section.append(heading, body);

  let destroyed = false;
  let households: HouseholdRecord[] = [];
  let loading = true;
  let pending = false;
  let loadError: string | null = null;
  let activeId: string | null = currentActiveHousehold();
  let selectedId: string | null = activeId;
  let healthState: DbHealthState | null = null;
  let refreshRequested = false;

  function findHousehold(id: string | null): HouseholdRecord | undefined {
    if (!id) return undefined;
    return households.find((item) => item.id === id);
  }

  function ensureSelection(): void {
    if (households.length === 0) {
      selectedId = null;
      return;
    }
    if (selectedId && households.some((h) => h.id === selectedId)) {
      return;
    }
    if (activeId && households.some((h) => h.id === activeId)) {
      selectedId = activeId;
      return;
    }
    selectedId = households[0].id;
  }

  function describeActive(): string {
    if (!activeId) {
      return "No active household is selected.";
    }
    const active = findHousehold(activeId);
    if (!active) {
      return `Active household: ${activeId}`;
    }
    const suffix = active.isDefault ? " (Default)" : "";
    return `Active household: ${active.name}${suffix}`;
  }

  function describeSelection(): string {
    if (!selectedId || selectedId === activeId) {
      return describeActive();
    }
    const target = findHousehold(selectedId);
    const label = target ? target.name : selectedId;
    return `Switch to ${label} to reload data.`;
  }

  function render(): void {
    ensureSelection();
    const health = assessHealth(healthState);
    const hasHouseholds = households.length > 0;

    const options = households.map((household) => ({
      value: household.id,
      label: formatLabel(household, activeId),
    }));
    select.update({ options, value: selectedId ?? "" });

    const disableSelect = loading || pending || !hasHouseholds || health.disabled;
    select.update({ disabled: disableSelect });

    const disableApply =
      disableSelect || !selectedId || selectedId === activeId || households.length === 0;
    applyButton.disabled = disableApply || pending;

    let message = "";
    if (loading) {
      message = "Loading households…";
    } else if (loadError) {
      message = loadError;
    } else if (!hasHouseholds) {
      message = "No households available.";
    } else if (pending) {
      message = "Updating active household…";
    } else if (health.disabled && health.message) {
      message = health.message;
    } else {
      message = describeSelection();
    }

    status.textContent = message;
    status.hidden = message.trim().length === 0;
  }

  async function reloadHouseholds(): Promise<void> {
    loading = true;
    loadError = null;
    render();
    try {
      const [list, active] = await Promise.all([
        listHouseholds(),
        ensureActiveHousehold(),
      ]);
      if (destroyed) return;
      const previousSelection = selectedId;
      households = list;
      activeId = active;
      if (
        previousSelection &&
        list.some((item: HouseholdRecord) => item.id === previousSelection)
      ) {
        selectedId = previousSelection;
      } else if (active && list.some((item: HouseholdRecord) => item.id === active)) {
        selectedId = active;
      } else {
        selectedId = list.length > 0 ? list[0].id : null;
      }
      loadError = null;
    } catch (error) {
      if (destroyed) return;
      households = [];
      loadError = "Unable to load households.";
      showError(error);
    } finally {
      if (destroyed) return;
      loading = false;
      render();
      if (refreshRequested) {
        refreshRequested = false;
        void reloadHouseholds();
      }
    }
  }

  select.addEventListener("change", () => {
    selectedId = select.value || null;
    render();
  });

  applyButton.addEventListener("click", (event) => {
    event.preventDefault();
    if (!selectedId || selectedId === activeId || pending) {
      return;
    }
    pending = true;
    render();
    void (async () => {
      try {
        const result = await forceSetActiveHousehold(selectedId!);
        if (!result.ok) {
          selectedId = activeId;
          toast.show({ kind: "error", message: describeError(result.code) });
          return;
        }
        activeId = selectedId;
        toast.show({ kind: "success", message: "Active household updated." });
      } catch (error) {
        selectedId = activeId;
        showError(error);
      } finally {
        if (destroyed) return;
        pending = false;
        render();
      }
    })();
  });

  const unsubscribeHealth = subscribe(selectors.db.health, (state) => {
    if (destroyed) return;
    healthState = state;
    render();
  });

  const stopHousehold = on("household:changed", ({ householdId }) => {
    if (destroyed) return;
    activeId = householdId;
    if (!households.some((h) => h.id === householdId)) {
      if (loading) {
        refreshRequested = true;
      } else {
        void reloadHouseholds();
      }
      return;
    }
    selectedId = householdId;
    render();
  });

  render();
  void reloadHouseholds();

  return {
    element: section,
    destroy: () => {
      destroyed = true;
      unsubscribeHealth();
      stopHousehold();
    },
  };
}
