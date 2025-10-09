export interface AuditData {
  createdAt: number | null;
  updatedAt: number | null;
  lastVerified: number | null;
  verifiedBy: string | null;
}

export interface TabAuditInstance {
  element: HTMLElement;
  setData(data: AuditData): void;
  getData(): AuditData;
  setMarkVerifiedHandler(handler: (() => Promise<void> | void) | null): void;
  applyVerification(patch: { lastVerified: number; verifiedBy: string }): void;
}

function formatDate(value: number | null): string {
  if (value === null || value === undefined) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function createAuditTab(): TabAuditInstance {
  const element = document.createElement("div");
  element.className = "family-drawer__panel";
  element.id = "family-drawer-panel-audit";

  const list = document.createElement("dl");
  list.className = "family-drawer__audit-list";
  element.appendChild(list);

  const createRow = (label: string, id: string) => {
    const dt = document.createElement("dt");
    dt.className = "family-drawer__audit-term";
    dt.textContent = label;
    dt.id = id;
    const dd = document.createElement("dd");
    dd.className = "family-drawer__audit-value";
    dd.setAttribute("aria-labelledby", id);
    list.append(dt, dd);
    return dd;
  };

  const createdValue = createRow("Created", "family-drawer-audit-created");
  const updatedValue = createRow("Last updated", "family-drawer-audit-updated");
  const verifiedValue = createRow("Last verified", "family-drawer-audit-verified");
  const verifiedByValue = createRow("Verified by", "family-drawer-audit-verified-by");

  const controls = document.createElement("div");
  controls.className = "family-drawer__audit-actions";
  element.appendChild(controls);

  const markButton = document.createElement("button");
  markButton.type = "button";
  markButton.className = "family-drawer__primary";
  markButton.textContent = "Mark verified";
  markButton.setAttribute("aria-label", "Mark member as verified");
  controls.appendChild(markButton);

  let currentData: AuditData = { createdAt: null, updatedAt: null, lastVerified: null, verifiedBy: null };
  let handler: (() => Promise<void> | void) | null = null;
  let busy = false;

  const setBusy = (value: boolean) => {
    busy = value;
    markButton.disabled = !handler || busy;
  };

  const render = () => {
    createdValue.textContent = formatDate(currentData.createdAt);
    updatedValue.textContent = formatDate(currentData.updatedAt);
    verifiedValue.textContent = currentData.lastVerified ? formatDate(currentData.lastVerified) : "Never";
    verifiedByValue.textContent = currentData.verifiedBy && currentData.verifiedBy.length > 0 ? currentData.verifiedBy : "—";
  };

  markButton.addEventListener("click", async (event) => {
    event.preventDefault();
    if (!handler || busy) return;
    setBusy(true);
    try {
      await handler();
    } finally {
      setBusy(false);
    }
  });

  render();

  return {
    element,
    setData(data) {
      currentData = { ...data };
      render();
    },
    getData() {
      return { ...currentData };
    },
    setMarkVerifiedHandler(next) {
      handler = next;
      setBusy(false);
    },
    applyVerification(patch) {
      currentData.lastVerified = patch.lastVerified;
      currentData.verifiedBy = patch.verifiedBy;
      render();
    },
  };
}
