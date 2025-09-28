import createButton from "@ui/Button";
import {
  getAmbientMode,
  setAmbientMode,
  getRotationMode,
  setRotationMode,
  type AmbientMode,
  type RotationMode,
} from "@lib/store";
import { forceNewBlobUniverse } from "@lib/blobRotation";
import { log } from "@utils/logger";

interface Option<T extends string> {
  value: T;
  label: string;
  description: string;
}

const AMBIENT_OPTIONS: Option<AmbientMode>[] = [
  {
    value: "off",
    label: "Off",
    description: "Render a static frame when opened and pause all motion.",
  },
  {
    value: "eco",
    label: "Eco",
    description: "Low-power SoloBlobEco with one or two soft blobs (recommended).",
  },
  {
    value: "full",
    label: "Full",
    description: "BlobFieldEco with a gentle multi-blob field at higher fps.",
  },
];

const ROTATION_OPTIONS: Option<Exclude<RotationMode, "manual">>[] = [
  {
    value: "off",
    label: "Rotation off",
    description: "Keep the current seed until you refresh manually.",
  },
  {
    value: "weekly",
    label: "Weekly",
    description: "Derive a deterministic seed once per ISO week (Europe/London).",
  },
  {
    value: "monthly",
    label: "Monthly",
    description: "Refresh with a new deterministic seed at the start of each month.",
  },
];

function makeOptionId(group: string, value: string): string {
  return `ambient-${group}-${value}`;
}

function createRadioGroup<T extends string>(
  name: string,
  legendText: string,
  options: Option<T>[],
  onChange: (value: T) => Promise<void>,
): { element: HTMLElement; update(value: T): void } {
  const fieldset = document.createElement("fieldset");
  fieldset.className = "ambient-settings__group";

  const legend = document.createElement("legend");
  legend.className = "ambient-settings__legend";
  legend.textContent = legendText;
  fieldset.appendChild(legend);

  const inputs = new Map<T, HTMLInputElement>();

  options.forEach((option) => {
    const id = makeOptionId(name, option.value);
    const label = document.createElement("label");
    label.className = "ambient-settings__option";
    label.setAttribute("for", id);

    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.id = id;
    input.value = option.value;

    const body = document.createElement("div");
    body.className = "ambient-settings__copy";

    const title = document.createElement("span");
    title.className = "ambient-settings__title";
    title.textContent = option.label;

    const description = document.createElement("span");
    description.className = "ambient-settings__description";
    description.textContent = option.description;

    body.append(title, description);
    label.append(input, body);
    fieldset.appendChild(label);

    inputs.set(option.value, input);

    input.addEventListener("change", () => {
      if (!input.checked) return;
      input.disabled = true;
      void onChange(option.value).catch((error) => {
        log.warn(`ambient:${name}:change`, error);
      }).finally(() => {
        input.disabled = false;
      });
    });
  });

  return {
    element: fieldset,
    update(value: T) {
      const input = inputs.get(value);
      if (!input) return;
      input.checked = true;
    },
  };
}

function describeMode(mode: AmbientMode): string {
  switch (mode) {
    case "off":
      return "Ambient background disabled.";
    case "full":
      return "Full field rendering enabled.";
    default:
      return "Eco renderer active.";
  }
}

export function createAmbientBackgroundSection(): HTMLElement {
  const section = document.createElement("section");
  section.className = "card settings__section settings__section--ambient";
  section.setAttribute("aria-labelledby", "settings-ambient");

  const heading = document.createElement("h3");
  heading.id = "settings-ambient";
  heading.textContent = "Ambient background";

  const body = document.createElement("div");
  body.className = "settings__body ambient-settings";

  const status = document.createElement("p");
  status.className = "ambient-settings__status";
  status.textContent = "Loading ambient preferences…";

  const ambientGroup = createRadioGroup<AmbientMode>(
    "ambient-mode",
    "Animation profile",
    AMBIENT_OPTIONS,
    async (value) => {
      try {
        await setAmbientMode(value);
        status.textContent = describeMode(value);
      } catch (error) {
        status.textContent = "Unable to update ambient mode.";
        log.warn("ambient:mode:update", error);
        throw error;
      }
    },
  );

  const rotationGroup = createRadioGroup<Exclude<RotationMode, "manual">>(
    "ambient-rotation",
    "Rotation cadence",
    ROTATION_OPTIONS,
    async (value) => {
      try {
        await setRotationMode(value);
        status.textContent = value === "off"
          ? "Rotation paused. Use Refresh now to change the seed manually."
          : `Rotation set to ${value}.`;
      } catch (error) {
        status.textContent = "Unable to update rotation cadence.";
        log.warn("ambient:rotation:update", error);
        throw error;
      }
    },
  );

  const refreshButton = createButton({
    label: "Refresh now",
    variant: "ghost",
    className: "settings__button ambient-settings__refresh",
    type: "button",
  });
  refreshButton.addEventListener("click", () => {
    refreshButton.disabled = true;
    status.textContent = "Generating a fresh blob universe…";
    void forceNewBlobUniverse()
      .then(() => {
        status.textContent = "Seed refreshed. Enjoy the new background.";
      })
      .catch((error) => {
        status.textContent = "Unable to refresh background.";
        log.warn("ambient:refresh", error);
      })
      .finally(() => {
        refreshButton.disabled = false;
      });
  });

  body.append(ambientGroup.element, rotationGroup.element, refreshButton, status);
  section.append(heading, body);

  void (async () => {
    try {
      const [ambientMode, rotationMode] = await Promise.all([
        getAmbientMode(),
        getRotationMode(),
      ]);
      ambientGroup.update(ambientMode);
      rotationGroup.update(rotationMode === "manual" ? "off" : rotationMode);
      status.textContent = describeMode(ambientMode);
    } catch (error) {
      status.textContent = "Unable to load ambient settings.";
      log.warn("ambient:load", error);
    }
  })();

  return section;
}

export default createAmbientBackgroundSection;
