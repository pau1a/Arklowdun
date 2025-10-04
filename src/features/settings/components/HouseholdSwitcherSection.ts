import {
  HOUSEHOLD_ERROR_MESSAGES,
  resolveHouseholdErrorMessage,
  type HouseholdRecord,
  type SetActiveHouseholdErrorCode,
} from "../../../api/households";
import {
  ensureActiveHousehold,
  forceSetActiveHousehold,
  refreshHouseholds,
  createHousehold,
  updateHousehold,
  deleteHousehold,
  restoreHousehold,
  subscribe as subscribeToHouseholdStore,
  selectors as householdSelectors,
  setShowDeleted,
} from "../../../state/householdStore";
import { selectors, subscribe, type DbHealthState } from "@store/index";
import createButton from "@ui/Button";
import createInput from "@ui/Input";
import { createSwitch, type SwitchElement } from "@ui/Switch";
import { toast } from "@ui/Toast";
import { showError } from "@ui/errors";
import { isHexColor, readableOn, MIN_CONTRAST_AA } from "@utils/color";

const COLOR_SWATCHES = [
  "#2563EB",
  "#0EA5E9",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#EC4899",
  "#8B5CF6",
  "#14B8A6",
] as const;

const CHIP_FOREGROUND: Record<"black" | "white", string> = {
  black: "rgba(15, 23, 42, 0.94)",
  white: "rgba(255, 255, 255, 0.94)",
};

type HealthGate = { disabled: boolean; message: string | null };

function assessHealth(health: DbHealthState | null): HealthGate {
  if (!health) {
    return { disabled: false, message: null };
  }
  if (health.phase === "pending") {
    return {
      disabled: true,
      message:
        "Checking database health… Household changes are temporarily disabled.",
    };
  }
  if (health.error?.code === "DB_UNHEALTHY_WRITE_BLOCKED") {
    return {
      disabled: true,
      message:
        health.error.message ??
        "Resolve database health issues before changing households.",
    };
  }
  if (health.report?.status === "error") {
    return {
      disabled: true,
      message: "Resolve database health issues before changing households.",
    };
  }
  return { disabled: false, message: null };
}

function describeSetActiveError(code: SetActiveHouseholdErrorCode): string {
  switch (code) {
    case "HOUSEHOLD_NOT_FOUND":
      return HOUSEHOLD_ERROR_MESSAGES.HOUSEHOLD_NOT_FOUND;
    case "HOUSEHOLD_DELETED":
      return HOUSEHOLD_ERROR_MESSAGES.HOUSEHOLD_DELETED;
    case "HOUSEHOLD_ALREADY_ACTIVE":
      return HOUSEHOLD_ERROR_MESSAGES.HOUSEHOLD_ALREADY_ACTIVE;
    default:
      return "Unable to change the active household.";
  }
}

type ColorPickerControl = {
  element: HTMLDivElement;
  getValue: () => string | null;
  setValue: (value: string | null) => void;
  setDisabled: (disabled: boolean) => void;
};

function createColorPicker(initial: string | null): ColorPickerControl {
  const container = document.createElement("div");
  container.className = "settings__household-color-picker";
  const normalize = (input: string | null | undefined): string | null => {
    if (typeof input !== "string") return null;
    const trimmed = input.trim();
    if (!isHexColor(trimmed)) return null;
    return trimmed.toUpperCase();
  };

  let value: string | null = normalize(initial);
  const swatches: Array<{ value: string | null; button: HTMLButtonElement }> = [];

  const updateSelection = () => {
    for (const { value: swatchValue, button } of swatches) {
      const selected = swatchValue === value;
      button.dataset.selected = selected ? "true" : "false";
      button.setAttribute("aria-pressed", String(selected));
    }
  };

  const select = (next: string | null) => {
    value = normalize(next);
    updateSelection();
  };

  const createSwatch = (swatchValue: string | null, label: string) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "settings__household-color";
    const normalized = normalize(swatchValue);
    if (normalized) {
      button.style.setProperty("--household-color", normalized);
      button.setAttribute("aria-label", `Use colour ${label}`);
      button.title = label;
    } else {
      button.classList.add("settings__household-color--none");
      button.setAttribute("aria-label", "Use no colour");
      button.title = "No colour";
    }
    button.addEventListener("click", (event) => {
      event.preventDefault();
      select(normalized);
    });
    swatches.push({ value: normalized, button });
    return button;
  };

  container.append(createSwatch(null, "none"));
  for (const swatch of COLOR_SWATCHES) {
    container.append(createSwatch(swatch, swatch));
  }

  updateSelection();

  return {
    element: container,
    getValue: () => value,
    setValue(next) {
      value = normalize(next);
      updateSelection();
    },
    setDisabled(disabled) {
      for (const { button } of swatches) {
        button.disabled = disabled;
      }
    },
  };
}
interface RowContext {
  activeId: string | null;
  actionsDisabled: boolean;
  globalLoading: boolean;
}

type RowActionHandlers = {
  onSetActive: (record: HouseholdRecord) => Promise<void>;
  onRename: (
    record: HouseholdRecord,
    input: { name: string; color: string | null },
  ) => Promise<void>;
  onDelete: (record: HouseholdRecord) => Promise<void>;
  onRestore: (record: HouseholdRecord) => Promise<void>;
};

interface HouseholdRowInstance {
  element: HTMLDivElement;
  update: (record: HouseholdRecord, context: RowContext) => void;
  destroy: () => void;
}

function createHouseholdRow(
  record: HouseholdRecord,
  actions: RowActionHandlers,
): HouseholdRowInstance {
  let current = record;
  let editing = false;
  let pending = false;

  const row = document.createElement("div");
  row.className = "settings__household-row";
  row.dataset.householdId = record.id;

  const primary = document.createElement("div");
  primary.className = "settings__household-primary";

  const colorChip = document.createElement("span");
  colorChip.className = "settings__household-chip";

  const nameEl = document.createElement("span");
  nameEl.className = "settings__household-name";

  const badges = document.createElement("div");
  badges.className = "settings__household-badges";

  primary.append(colorChip, nameEl, badges);

  const controls = document.createElement("div");
  controls.className = "settings__household-controls";

  const actionButtons = document.createElement("div");
  actionButtons.className = "settings__household-actions";

  const activateButton = createButton({
    label: "Set active",
    size: "sm",
    variant: "primary",
  });

  const renameButton = createButton({
    label: "Rename",
    size: "sm",
  });

  const deleteButton = createButton({
    label: "Delete",
    size: "sm",
    variant: "danger",
  });

  const restoreButton = createButton({
    label: "Restore",
    size: "sm",
    variant: "primary",
  });

  actionButtons.append(activateButton, renameButton, deleteButton, restoreButton);

  const editForm = document.createElement("form");
  editForm.className = "settings__household-edit";
  editForm.hidden = true;

  const nameField = document.createElement("label");
  nameField.className = "settings__household-field";
  nameField.textContent = "Name";

  const nameInput = createInput({
    value: record.name,
    required: true,
    className: "settings__household-input",
  });
  nameField.append(nameInput);

  const colorField = document.createElement("div");
  colorField.className = "settings__household-field";
  const colorLabel = document.createElement("span");
  colorLabel.className = "settings__household-field-label";
  colorLabel.textContent = "Colour";
  const colorPicker = createColorPicker(record.color);
  const colorError = document.createElement("p");
  colorError.className = "settings__household-error";
  colorError.hidden = true;
  const colorErrorId = `household-${record.id}-color-error`;
  colorError.id = colorErrorId;
  const showColorError = (message: string | null) => {
    if (message && message.trim().length > 0) {
      colorError.textContent = message;
      colorError.hidden = false;
      colorError.setAttribute("role", "alert");
      colorPicker.element.setAttribute("aria-describedby", colorErrorId);
      colorPicker.element.dataset.invalid = "true";
    } else {
      colorError.textContent = "";
      colorError.hidden = true;
      colorError.removeAttribute("role");
      colorPicker.element.removeAttribute("aria-describedby");
      delete colorPicker.element.dataset.invalid;
    }
  };
  colorField.append(colorLabel, colorPicker.element, colorError);

  const editActions = document.createElement("div");
  editActions.className = "settings__household-edit-actions";

  const saveButton = createButton({
    label: "Save",
    size: "sm",
    variant: "primary",
    type: "submit",
  });

  const cancelButton = createButton({
    label: "Cancel",
    size: "sm",
    type: "button",
  });

  editActions.append(saveButton, cancelButton);
  editForm.append(nameField, colorField, editActions);

  controls.append(actionButtons, editForm);

  row.append(primary, controls);

  const renderBadges = (context: RowContext) => {
    badges.textContent = "";
    const descriptors: Array<{ text: string; modifier: string }> = [];
    if (current.isDefault) descriptors.push({ text: "Default", modifier: "default" });
    if (current.id === context.activeId)
      descriptors.push({ text: "Active", modifier: "active" });
    if (current.deletedAt !== null)
      descriptors.push({ text: "Deleted", modifier: "deleted" });
    for (const descriptor of descriptors) {
      const badge = document.createElement("span");
      badge.className = `settings__household-badge settings__household-badge--${descriptor.modifier}`;
      badge.textContent = descriptor.text;
      badges.append(badge);
    }
  };

  const applyColor = () => {
    colorChip.classList.remove(
      "settings__household-chip--low-contrast",
      "settings__household-chip--empty",
    );
    colorChip.removeAttribute("data-contrast");
    colorChip.removeAttribute("data-contrast-warning");
    if (current.color && isHexColor(current.color)) {
      const { foreground, contrast } = readableOn(current.color);
      colorChip.style.setProperty("--household-color", current.color);
      colorChip.style.setProperty(
        "--household-chip-foreground",
        CHIP_FOREGROUND[foreground],
      );
      colorChip.setAttribute("data-contrast", contrast.toFixed(2));
      colorChip.title = `Colour ${current.color}`;
      if (contrast < MIN_CONTRAST_AA) {
        colorChip.classList.add("settings__household-chip--low-contrast");
        colorChip.setAttribute("data-contrast-warning", "true");
      }
    } else {
      colorChip.style.removeProperty("--household-color");
      colorChip.style.removeProperty("--household-chip-foreground");
      colorChip.classList.add("settings__household-chip--empty");
      colorChip.removeAttribute("title");
    }
  };

  let lastContext: RowContext = {
    activeId: null,
    actionsDisabled: false,
    globalLoading: false,
  };

  const syncDeleteAffordance = (disabled: boolean) => {
    const lockedDefault = current.isDefault;
    deleteButton.disabled = disabled || lockedDefault;
    deleteButton.classList.toggle("is-disabled", lockedDefault);
    if (lockedDefault) {
      deleteButton.setAttribute("aria-disabled", "true");
      deleteButton.title = "Default household cannot be deleted.";
    } else {
      deleteButton.removeAttribute("aria-disabled");
      deleteButton.removeAttribute("title");
    }
  };

  const setPending = (value: boolean, context: RowContext) => {
    pending = value;
    const disabled = pending || context.actionsDisabled || context.globalLoading;
    activateButton.disabled = disabled;
    renameButton.disabled = disabled || current.deletedAt !== null;
    restoreButton.disabled = disabled || current.deletedAt === null;
    syncDeleteAffordance(disabled || current.deletedAt !== null);
    nameInput.disabled = pending;
    colorPicker.setDisabled(pending);
    saveButton.disabled = pending;
    cancelButton.disabled = pending;
  };

  const toggleEditing = (value: boolean, context: RowContext) => {
    editing = value;
    showColorError(null);
    if (editing) {
      nameInput.update({ value: current.name });
      colorPicker.setValue(current.color);
      nameInput.focus();
    }
    editForm.hidden = !editing;
    actionButtons.hidden = editing;
    row.classList.toggle("settings__household-row--editing", editing);
    setPending(false, context);
  };

  activateButton.addEventListener("click", (event) => {
    event.preventDefault();
    if (pending) return;
    void (async () => {
      setPending(true, lastContext);
      try {
        await actions.onSetActive(current);
      } catch {
        // handled upstream
      } finally {
        setPending(false, lastContext);
      }
    })();
  });

  renameButton.addEventListener("click", (event) => {
    event.preventDefault();
    if (pending) return;
    toggleEditing(true, lastContext);
  });

  cancelButton.addEventListener("click", (event) => {
    event.preventDefault();
    if (pending) return;
    toggleEditing(false, lastContext);
  });

  editForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (pending) return;
    const nameValue = nameInput.value.trim();
    if (!nameValue) {
      nameInput.reportValidity();
      return;
    }
    const colorValue = colorPicker.getValue();
    void (async () => {
      setPending(true, lastContext);
      try {
        showColorError(null);
        await actions.onRename(current, { name: nameValue, color: colorValue });
        toggleEditing(false, lastContext);
      } catch (error) {
        const message = resolveHouseholdErrorMessage(
          error,
          "Unable to update household.",
        );
        if (message === HOUSEHOLD_ERROR_MESSAGES.INVALID_COLOR) {
          showColorError(message);
          toast.show({ kind: "error", message });
          const selectedSwatch = colorPicker.element.querySelector<HTMLElement>(
            '[data-selected="true"]',
          );
          selectedSwatch?.focus();
        } else {
          showColorError(null);
          showError(error);
        }
      } finally {
        setPending(false, lastContext);
      }
    })();
  });

  deleteButton.addEventListener("click", (event) => {
    event.preventDefault();
    if (pending) return;
    const confirmed = window.confirm(
      `Delete ${current.name}? You can restore it later.`,
    );
    if (!confirmed) return;
    void (async () => {
      setPending(true, lastContext);
      try {
        await actions.onDelete(current);
      } catch {
        // handled upstream
      } finally {
        setPending(false, lastContext);
      }
    })();
  });

  restoreButton.addEventListener("click", (event) => {
    event.preventDefault();
    if (pending) return;
    void (async () => {
      setPending(true, lastContext);
      try {
        await actions.onRestore(current);
      } catch {
        // handled upstream
      } finally {
        setPending(false, lastContext);
      }
    })();
  });

  const update = (nextRecord: HouseholdRecord, context: RowContext) => {
    current = nextRecord;
    lastContext = context;
    row.dataset.householdId = nextRecord.id;
    nameEl.textContent = nextRecord.name;
    applyColor();
    renderBadges(context);
    row.classList.toggle(
      "settings__household-row--deleted",
      nextRecord.deletedAt !== null,
    );
    toggleEditing(editing && nextRecord.deletedAt === null, context);
    activateButton.hidden =
      nextRecord.deletedAt !== null || nextRecord.id === context.activeId;
    renameButton.hidden = nextRecord.deletedAt !== null;
    deleteButton.hidden = nextRecord.deletedAt !== null;
    restoreButton.hidden = nextRecord.deletedAt === null;
    setPending(pending, context);
  };

  applyColor();
  renderBadges(lastContext);

  return {
    element: row,
    update,
    destroy: () => {
      row.remove();
    },
  };
}
interface HouseholdViewState {
  households: HouseholdRecord[];
  deleted: HouseholdRecord[];
  activeId: string | null;
  showDeleted: boolean;
  loading: boolean;
  error: string | null;
}

function describeStatus(state: HouseholdViewState, health: HealthGate): string {
  if (state.loading) {
    return "Loading households…";
  }
  if (state.error) {
    return state.error;
  }
  if (health.disabled && health.message) {
    return health.message;
  }
  if (state.households.length === 0) {
    return "No households available.";
  }
  const active = state.households.find((item) => item.id === state.activeId);
  if (!active) {
    return "No active household is selected.";
  }
  const suffix: string[] = [];
  if (active.isDefault) suffix.push("Default");
  if (active.deletedAt) suffix.push("Deleted");
  const decorated = suffix.length > 0 ? ` (${suffix.join(", ")})` : "";
  return `Active household: ${active.name}${decorated}`;
}

export interface HouseholdSwitcherSection {
  element: HTMLElement;
  destroy: () => void;
}

export function createHouseholdSwitcherSection(): HouseholdSwitcherSection {
  const section = document.createElement("section");
  section.className = "card settings__section settings__section--household";
  section.setAttribute("aria-labelledby", "settings-household");

  const heading = document.createElement("h3");
  heading.id = "settings-household";
  heading.textContent = "Households";

  const body = document.createElement("div");
  body.className = "settings__body settings__households";

  const helper = document.createElement("p");
  helper.className = "settings__helper";
  helper.textContent =
    "Create, rename, delete, and restore households. The active household scopes data across the app.";

  const createBlock = document.createElement("div");
  createBlock.className = "settings__household-create";

  const createTrigger = createButton({
    label: "Create household",
    variant: "primary",
    className: "settings__household-create-trigger",
  });

  const createForm = document.createElement("form");
  createForm.className = "settings__household-create-form";
  createForm.hidden = true;

  const createNameLabel = document.createElement("label");
  createNameLabel.className = "settings__household-field";
  createNameLabel.textContent = "Name";

  const createNameInput = createInput({
    placeholder: "Household name",
    required: true,
    className: "settings__household-input",
  });
  createNameLabel.append(createNameInput);

  const createColorField = document.createElement("div");
  createColorField.className = "settings__household-field";
  const createColorLabel = document.createElement("span");
  createColorLabel.className = "settings__household-field-label";
  createColorLabel.textContent = "Colour";
  const createColorControl = createColorPicker(null);
  createColorField.append(createColorLabel, createColorControl.element);

  const createActions = document.createElement("div");
  createActions.className = "settings__household-create-actions";

  const createSubmit = createButton({
    label: "Create",
    variant: "primary",
    size: "sm",
    type: "submit",
  });

  const createCancel = createButton({
    label: "Cancel",
    size: "sm",
    type: "button",
  });

  createActions.append(createSubmit, createCancel);
  createForm.append(createNameLabel, createColorField, createActions);
  createBlock.append(createTrigger, createForm);

  const toggleRow = document.createElement("div");
  toggleRow.className = "settings__household-toggle";
  const toggleLabel = document.createElement("span");
  toggleLabel.textContent = "Show deleted households";
  const showDeletedToggle: SwitchElement = createSwitch({
    checked: false,
    ariaLabel: "Show deleted households",
    onChange: (_event, checked) => {
      if (toggleGuard) return;
      setShowDeleted(checked);
    },
  });
  toggleRow.append(toggleLabel, showDeletedToggle);

  const status = document.createElement("p");
  status.className = "settings__household-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const activeList = document.createElement("div");
  activeList.className = "settings__household-list";

  const deletedSection = document.createElement("div");
  deletedSection.className = "settings__household-deleted";
  deletedSection.hidden = true;
  const deletedHeading = document.createElement("h4");
  deletedHeading.textContent = "Deleted households";
  const deletedList = document.createElement("div");
  deletedList.className = "settings__household-list settings__household-list--deleted";
  deletedSection.append(deletedHeading, deletedList);

  body.append(helper, createBlock, toggleRow, status, activeList, deletedSection);
  section.append(heading, body);

  let destroyed = false;
  let creating = false;
  let healthState: DbHealthState | null = null;
  const rowMap = new Map<string, HouseholdRowInstance>();
  let toggleGuard = false;
  const actions: RowActionHandlers = {
    onSetActive: async (record) => {
      try {
        const result = await forceSetActiveHousehold(record.id);
        if (!result.ok) {
          toast.show({
            kind: "error",
            message: describeSetActiveError(result.code),
          });
          return;
        }
        toast.show({ kind: "success", message: "Active household updated." });
      } catch (error) {
        showError(error);
        throw error;
      }
    },
    onRename: async (record, input) => {
      await updateHousehold(record.id, {
        name: input.name,
        color: input.color,
      });
      toast.show({ kind: "success", message: "Household updated." });
    },
    onDelete: async (record) => {
      const fallback = "Unable to delete household.";
      try {
        await deleteHousehold(record.id);
        toast.show({ kind: "success", message: "Household deleted." });
      } catch (error) {
        const friendly = resolveHouseholdErrorMessage(error, fallback);
        if (friendly === fallback) {
          showError(error);
        } else {
          toast.show({ kind: "error", message: friendly });
        }
        throw error;
      }
    },
    onRestore: async (record) => {
      try {
        await restoreHousehold(record.id);
        toast.show({ kind: "success", message: "Household restored." });
      } catch (error) {
        showError(error);
        throw error;
      }
    },
  };

  const rowMapHelper = (record: HouseholdRecord): HouseholdRowInstance => {
    let instance = rowMap.get(record.id);
    if (!instance) {
      instance = createHouseholdRow(record, actions);
      rowMap.set(record.id, instance);
    }
    return instance;
  };

  const cleanupRows = (keep: Set<string>) => {
    for (const [id, row] of rowMap) {
      if (!keep.has(id)) {
        row.destroy();
        rowMap.delete(id);
      }
    }
  };
  const render = (view: HouseholdViewState) => {
    if (destroyed) return;
    const health = assessHealth(healthState);
    const actionsDisabled = health.disabled || creating;

    createTrigger.disabled = actionsDisabled || view.loading;
    createSubmit.disabled = creating;
    createCancel.disabled = creating;
    createNameInput.disabled = creating;
    createColorControl.setDisabled(creating);

    toggleGuard = true;
    showDeletedToggle.update({
      checked: view.showDeleted,
      disabled: view.loading,
    });
    toggleGuard = false;

    const statusMessage = describeStatus(view, health);
    status.textContent = statusMessage;
    status.hidden = statusMessage.trim().length === 0;

    const activeItems = view.households.filter((item) => item.deletedAt === null);
    const deletedItems = view.deleted;

    const activeFragment = document.createDocumentFragment();
    const seen = new Set<string>();

    for (const household of activeItems) {
      const row = rowMapHelper(household);
      row.update(household, {
        activeId: view.activeId,
        actionsDisabled,
        globalLoading: view.loading,
      });
      activeFragment.append(row.element);
      seen.add(household.id);
    }

    activeList.replaceChildren(activeFragment);

    if (view.showDeleted && deletedItems.length > 0) {
      const deletedFragment = document.createDocumentFragment();
      for (const household of deletedItems) {
        const row = rowMapHelper(household);
        row.update(household, {
          activeId: view.activeId,
          actionsDisabled,
          globalLoading: view.loading,
        });
        deletedFragment.append(row.element);
        seen.add(household.id);
      }
      deletedList.replaceChildren(deletedFragment);
      deletedSection.hidden = false;
    } else {
      deletedSection.hidden = true;
      deletedList.replaceChildren();
    }

    cleanupRows(seen);
  };
  let currentState: HouseholdViewState = {
    households: [],
    deleted: [],
    activeId: null,
    showDeleted: false,
    loading: false,
    error: null,
  };

  createTrigger.addEventListener("click", (event) => {
    event.preventDefault();
    if (creating) return;
    createForm.hidden = false;
    createTrigger.hidden = true;
    createNameInput.update({ value: "" });
    createColorControl.setValue(null);
    createNameInput.focus();
  });

  const resetCreateForm = () => {
    createForm.hidden = true;
    createTrigger.hidden = false;
    creating = false;
    createNameInput.update({ value: "" });
    createColorControl.setValue(null);
  };

  createCancel.addEventListener("click", (event) => {
    event.preventDefault();
    if (creating) return;
    resetCreateForm();
  });

  createForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (creating) return;
    const nameValue = createNameInput.value.trim();
    if (!nameValue) {
      createNameInput.reportValidity();
      return;
    }
    const colorValue = createColorControl.getValue();
    creating = true;
    render(currentState);
    void (async () => {
      try {
        await createHousehold(nameValue, colorValue);
        toast.show({ kind: "success", message: "Household created." });
        resetCreateForm();
      } catch (error) {
        showError(error);
      } finally {
        creating = false;
        render(currentState);
      }
    })();
  });

  const unsubscribeStore = subscribeToHouseholdStore(
    (state) => ({
      households: householdSelectors.allHouseholds(state),
      deleted: householdSelectors.deletedHouseholds(state),
      activeId: state.activeId,
      showDeleted: state.showDeleted,
      loading: state.loading,
      error: state.error,
    }),
    (view) => {
      currentState = view;
      render(view);
    },
  );

  const unsubscribeHealth = subscribe(selectors.db.health, (health) => {
    if (destroyed) return;
    healthState = health;
    render(currentState);
  });

  void ensureActiveHousehold().catch(showError);
  void refreshHouseholds().catch(showError);

  return {
    element: section,
    destroy: () => {
      destroyed = true;
      unsubscribeStore();
      unsubscribeHealth();
      rowMap.forEach((row) => row.destroy());
      rowMap.clear();
    },
  };
}
