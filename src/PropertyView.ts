// src/PropertyView.ts
import { open as openDialog } from "@lib/ipc/dialog";
import { sanitizeRelativePath } from "./files/path";

const PROPERTY_DOCUMENTS_CATEGORY = "property_documents" as const;
import { isPermissionGranted, requestPermission, sendNotification } from "./notification";
import type { PropertyDocument } from "./models";
import { propertyDocsRepo } from "./repos";
import { getHouseholdIdForCalls } from "./db/household";
import { nowMs, toDate } from "./db/time";
import { STR } from "./ui/strings";
import { openAttachment, revealAttachment, revealLabel } from "./ui/attachments";

const MAX_TIMEOUT = 2_147_483_647; // ~24.8 days
function scheduleAt(ts: number, cb: () => void) {
  const delay = ts - nowMs();
  if (delay <= 0) return void cb();
  const chunk = Math.min(delay, MAX_TIMEOUT);
  setTimeout(() => scheduleAt(ts, cb), chunk);
}

async function renderDocs(listEl: HTMLUListElement, docs: PropertyDocument[]) {
  listEl.innerHTML = "";
  if (docs.length === 0) {
    const li = document.createElement("li");
    const { createEmptyState } = await import("./ui/EmptyState");
    li.appendChild(
      createEmptyState({
        title: STR.empty.propertyTitle,
        body: STR.empty.propertyDesc,
        cta: {
          kind: "button",
          label: "Add document",
          onClick: () => {
            document
              .querySelector<HTMLInputElement>("#prop-desc")
              ?.focus();
          },
        },
      }),
    );
    listEl.appendChild(li);
    return;
  }
  docs.forEach((d) => {
    const li = document.createElement("li");
    li.textContent = `${d.description} — renews ${toDate(d.renewal_date).toLocaleDateString()} `;
    if (d.relative_path) {
      const openBtn = document.createElement("button");
      openBtn.textContent = "Open";
      openBtn.addEventListener("click", () =>
        openAttachment("property_documents", String(d.id)),
      );
      li.appendChild(openBtn);

      const revealBtn = document.createElement("button");
      revealBtn.textContent = revealLabel();
      revealBtn.addEventListener("click", () =>
        revealAttachment("property_documents", String(d.id)),
      );
      li.appendChild(revealBtn);
    }
    listEl.appendChild(li);
  });
}

async function scheduleDocReminders(docs: PropertyDocument[]) {
  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === "granted";
  if (!granted) return;

  const now = nowMs();
  docs.forEach((d) => {
    if (!d.reminder) return;
    const dueTs = d.renewal_date;
    if (d.reminder > now) {
      scheduleAt(d.reminder, () => {
        sendNotification({
          title: "Property Renewal",
          body: `${d.description} renews on ${toDate(dueTs).toLocaleDateString()}`,
        });
      });
    } else if (now < dueTs) {
      sendNotification({
        title: "Property Renewal",
        body: `${d.description} renews on ${toDate(dueTs).toLocaleDateString()}`,
      });
    }
  });
}

export async function PropertyView(container: HTMLElement) {
  const hh = await getHouseholdIdForCalls();

  const section = document.createElement("section");
  section.innerHTML = `
    <ul id="property-list"></ul>
    <form id="property-form">
      <input id="prop-desc" type="text" placeholder="Description" required />
      <input id="prop-due" type="date" required />
      <input id="prop-doc" type="text" placeholder="Document path (optional)" />
      <button id="prop-choose" type="button">Choose File</button>
      <label style="display:block;margin-top:.5rem;">
        Reminder (optional):
        <input id="prop-rem" type="date" />
      </label>
      <button type="submit">Add Document</button>
    </form>
  `;
  container.innerHTML = "";
  container.appendChild(section);

  const listEl = section.querySelector<HTMLUListElement>("#property-list")!;
  const form = section.querySelector<HTMLFormElement>("#property-form")!;
  const descInput = section.querySelector<HTMLInputElement>("#prop-desc")!;
  const dueInput = section.querySelector<HTMLInputElement>("#prop-due")!;
  const docInput = section.querySelector<HTMLInputElement>("#prop-doc");
  const chooseBtn = section.querySelector<HTMLButtonElement>("#prop-choose");
  const remInput = section.querySelector<HTMLInputElement>("#prop-rem");

  let docs: PropertyDocument[] = await propertyDocsRepo.list({
    householdId: hh,
    orderBy: "position, created_at, id",
  });
  await renderDocs(listEl, docs);
  await scheduleDocReminders(docs);

  chooseBtn?.addEventListener("click", async () => {
    const selected = await openDialog({
      multiple: false,
      filters: [
        { name: "Documents", extensions: ["pdf", "doc", "docx", "png", "jpg", "jpeg"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (!docInput) return;
    if (typeof selected === "string") docInput.value = selected;
    else if (Array.isArray(selected) && selected[0]) docInput.value = selected[0];
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    // parse YYYY-MM-DD at local noon to avoid TZ shifts
    const [y, m, d] = dueInput.value.split("-").map(Number);
    const dueLocalNoon = new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0).getTime();

    let remTs: number | undefined;
    if (remInput?.value) {
      const [ry, rm, rd] = remInput.value.split("-").map(Number);
      remTs = new Date(ry, (rm ?? 1) - 1, rd ?? 1, 12, 0, 0, 0).getTime();
    } else {
      // default: 1 day before
      remTs = dueLocalNoon - 24 * 60 * 60 * 1000;
    }

    const created = await propertyDocsRepo.create(hh, {
      description: descInput.value,
      renewal_date: dueLocalNoon,
      relative_path: sanitizeRelativePath(docInput?.value ?? ""),
      category: PROPERTY_DOCUMENTS_CATEGORY,
      reminder: remTs,
      position: docs.length,
    });

    docs.push(created);
    await renderDocs(listEl, docs);
    await scheduleDocReminders([created]);
    form.reset();
  });
}
