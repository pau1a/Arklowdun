import { isValidEmail, isValidPhone, isValidUrl } from "./validators";
import type { FamilyMember } from "../family.types";
import { canonicalizeAndVerify, type RootKey } from "@files/path";
import { convertFileSrc } from "@lib/ipc/core";

export interface SocialLinkRow {
  key: string;
  value: string;
}

export interface PersonalFormData {
  nickname: string;
  fullName: string;
  relationship: string;
  address: string;
  emails: string[];
  phoneMobile: string;
  phoneHome: string;
  phoneWork: string;
  website: string;
  socialLinks: SocialLinkRow[];
  photoPath?: string | null;
}

export interface PersonalValidationResult {
  valid: boolean;
  focus?: () => void;
}

export interface TabPersonalInstance {
  element: HTMLElement;
  setData(data: PersonalFormData): void;
  getData(): PersonalFormData;
  validate(): PersonalValidationResult;
  setPhotoFromMember(member: FamilyMember | null): void;
  /** Returns a pending photo source selected by the user (if any). */
  getPendingPhoto(): { name: string; mimeType: string | null; read: () => Promise<Uint8Array> } | null;
  /** Clears the pending photo state after a successful save. */
  clearPendingPhoto(): void;
  /** Mark that the photo should be removed on save. */
  markPhotoRemoved(): void;
  /** Whether the user requested photo removal. */
  isPhotoRemoved(): boolean;
}

interface FieldEntry {
  wrapper: HTMLDivElement;
  input: HTMLInputElement | HTMLTextAreaElement;
  error: HTMLDivElement;
}

interface EmailEntry {
  wrapper: HTMLDivElement;
  input: HTMLInputElement;
  removeButton: HTMLButtonElement;
  error: HTMLDivElement;
}

interface SocialEntry {
  wrapper: HTMLDivElement;
  keyInput: HTMLInputElement;
  valueInput: HTMLInputElement;
  removeButton: HTMLButtonElement;
  error: HTMLDivElement;
}

const DATASET_INVALID = "data-invalid";

function createField(labelText: string, options?: { multiline?: boolean; required?: boolean; name?: string }): FieldEntry {
  const wrapper = document.createElement("div");
  wrapper.className = "family-drawer__field";

  const label = document.createElement("label");
  label.className = "family-drawer__label";
  label.textContent = labelText;
  if (options?.name) {
    label.htmlFor = `family-drawer-personal-${options.name}`;
  }
  wrapper.appendChild(label);

  const input = options?.multiline ? document.createElement("textarea") : document.createElement("input");
  input.className = "family-drawer__input";
  if (options?.required) {
    input.required = true;
  }
  if (options?.name) {
    input.id = `family-drawer-personal-${options.name}`;
    input.setAttribute("name", options.name);
  }
  if (options?.multiline) {
    (input as HTMLTextAreaElement).rows = 3;
  }
  wrapper.appendChild(input);

  const error = document.createElement("div");
  error.className = "family-drawer__error";
  error.id = `${input.id}-error`;
  error.setAttribute("role", "status");
  error.hidden = true;
  wrapper.appendChild(error);

  if (input.id) {
    input.setAttribute("aria-describedby", error.id);
  }

  return { wrapper, input, error };
}

function setFieldError(entry: FieldEntry | EmailEntry | SocialEntry, message: string | null): void {
  const { error } = entry;
  const input = (entry as FieldEntry).input ?? (entry as EmailEntry).input ?? (entry as SocialEntry).keyInput;
  if (message) {
    error.textContent = message;
    error.hidden = false;
    entry.wrapper.setAttribute(DATASET_INVALID, "true");
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
      input.setAttribute("aria-invalid", "true");
    }
  } else {
    error.textContent = "";
    error.hidden = true;
    entry.wrapper.removeAttribute(DATASET_INVALID);
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
      input.removeAttribute("aria-invalid");
    }
  }
}

function normalizeString(value: string): string {
  return value.trim();
}

export function createPersonalTab(): TabPersonalInstance {
  const element = document.createElement("div");
  element.className = "family-drawer__panel";
  element.id = "family-drawer-panel-personal";

  // Avatar controls
  const avatarRow = document.createElement("div");
  avatarRow.className = "family-drawer__avatar-row";

  const avatarImg = document.createElement("img");
  avatarImg.className = "family-drawer__avatar";
  avatarImg.alt = "Profile photo";
  avatarImg.hidden = true;

  const avatarPlaceholder = document.createElement("div");
  avatarPlaceholder.className = "family-drawer__avatar--placeholder";
  avatarPlaceholder.textContent = "No photo";

  const avatarActions = document.createElement("div");
  avatarActions.className = "family-drawer__avatar-actions";

  const changePhotoBtn = document.createElement("button");
  changePhotoBtn.type = "button";
  changePhotoBtn.className = "family-drawer__add";
  changePhotoBtn.textContent = "Change photo";

  const removePhotoBtn = document.createElement("button");
  removePhotoBtn.type = "button";
  removePhotoBtn.className = "family-drawer__remove";
  removePhotoBtn.textContent = "Remove photo";
  removePhotoBtn.disabled = true;

  const photoInput = document.createElement("input");
  photoInput.type = "file";
  photoInput.accept = "image/*";
  photoInput.hidden = true;

  avatarActions.append(changePhotoBtn, removePhotoBtn);
  avatarRow.append(avatarImg, avatarPlaceholder, avatarActions, photoInput);
  element.appendChild(avatarRow);

  // Local helper: render avatar from vault path using asset URL with blob fallback
  async function renderAvatarFromVault(householdId: string | null, photoPath: string | null): Promise<void> {
    if (!photoPath || !householdId) {
      avatarImg.hidden = true;
      avatarImg.src = "";
      avatarPlaceholder.hidden = false;
      removePhotoBtn.disabled = true;
      return;
    }

    const rel = `attachments/${householdId}/misc/${photoPath}`;
    let real: string | null = null;
    try {
      const result = await canonicalizeAndVerify(rel, "appData");
      real = result.realPath;
    } catch {
      real = null;
    }

    if (!real) {
      avatarImg.hidden = true;
      avatarImg.src = "";
      avatarPlaceholder.hidden = false;
      removePhotoBtn.disabled = true;
      return;
    }

    let loaded = false;
    const trySet = (src: string) =>
      new Promise<void>((resolve) => {
        const onOk = () => {
          loaded = true;
          avatarImg.removeEventListener("error", onErr);
          resolve();
        };
        const onErr = () => {
          avatarImg.removeEventListener("load", onOk);
          resolve();
        };
        avatarImg.addEventListener("load", onOk, { once: true });
        avatarImg.addEventListener("error", onErr, { once: true });
        avatarImg.src = src;
      });

    // Attempt Tauri asset URL
    try {
      await trySet(convertFileSrc(real));
    } catch {
      /* ignore */
    }

    // Fallback: read bytes and create blob URL
    if (!loaded) {
      try {
        const mod = await import("@tauri-apps/plugin-fs");
        const bytes = await mod.readFile(real);
        const blob = new Blob([bytes], { type: "image/*" });
        const url = URL.createObjectURL(blob);
        await trySet(url);
      } catch {
        /* ignore */
      }
    }

    if (loaded) {
      avatarImg.hidden = false;
      avatarPlaceholder.hidden = true;
      removePhotoBtn.disabled = false;
    } else {
      avatarImg.hidden = true;
      avatarPlaceholder.hidden = false;
      removePhotoBtn.disabled = true;
    }
  }

  // Bind avatar controls locally within the tab instance
  changePhotoBtn.addEventListener("click", (e) => {
    e.preventDefault();
    photoInput.click();
  });

  removePhotoBtn.addEventListener("click", (e) => {
    e.preventDefault();
    photoRemoved = true;
    pendingPhoto = null;
    currentPhotoPath = null;
    updateAvatarPreview(null, null);
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });

  photoInput.addEventListener("change", () => {
    const files = photoInput.files;
    if (!files || files.length === 0) return;
    const file = files[0]!;
    const read = async () => new Uint8Array(await file.arrayBuffer());
    pendingPhoto = { name: file.name, mimeType: file.type || null, read };
    photoRemoved = false;
    try {
      const blobUrl = URL.createObjectURL(file);
      avatarImg.src = blobUrl;
      avatarImg.hidden = false;
      avatarPlaceholder.hidden = true;
      removePhotoBtn.disabled = false;
    } catch {
      /* ignore preview errors */
    }
    element.dispatchEvent(new Event("change", { bubbles: true }));
    photoInput.value = "";
  });

  const nicknameField = createField("Nickname", { required: true, name: "nickname" });
  nicknameField.input.setAttribute("aria-required", "true");
  element.appendChild(nicknameField.wrapper);

  const fullNameField = createField("Full name", { name: "full-name" });
  element.appendChild(fullNameField.wrapper);

  const relationshipField = createField("Relationship", { name: "relationship" });
  element.appendChild(relationshipField.wrapper);

  const addressField = createField("Address", { multiline: true, name: "address" });
  element.appendChild(addressField.wrapper);

  const emailSection = document.createElement("section");
  emailSection.className = "family-drawer__section";
  const emailHeading = document.createElement("h3");
  emailHeading.className = "family-drawer__section-heading";
  emailHeading.textContent = "Email addresses";
  emailSection.appendChild(emailHeading);

  const emailList = document.createElement("div");
  emailList.className = "family-drawer__list";
  emailSection.appendChild(emailList);

  const addEmailButton = document.createElement("button");
  addEmailButton.type = "button";
  addEmailButton.className = "family-drawer__add";
  addEmailButton.textContent = "Add email";
  emailSection.appendChild(addEmailButton);

  element.appendChild(emailSection);

  const phoneSection = document.createElement("section");
  phoneSection.className = "family-drawer__section";
  const phoneHeading = document.createElement("h3");
  phoneHeading.className = "family-drawer__section-heading";
  phoneHeading.textContent = "Phone numbers";
  phoneSection.appendChild(phoneHeading);

  const phoneList = document.createElement("div");
  phoneList.className = "family-drawer__phone-list";
  phoneSection.appendChild(phoneList);

  element.appendChild(phoneSection);

  const websiteField = createField("Website", { name: "website" });
  websiteField.input.placeholder = "https://";
  element.appendChild(websiteField.wrapper);

  const socialSection = document.createElement("section");
  socialSection.className = "family-drawer__section";
  const socialHeading = document.createElement("h3");
  socialHeading.className = "family-drawer__section-heading";
  socialHeading.textContent = "Social links";
  socialSection.appendChild(socialHeading);

  const socialList = document.createElement("div");
  socialList.className = "family-drawer__list";
  socialSection.appendChild(socialList);

  const addSocialButton = document.createElement("button");
  addSocialButton.type = "button";
  addSocialButton.className = "family-drawer__add";
  addSocialButton.textContent = "Add link";
  socialSection.appendChild(addSocialButton);

  element.appendChild(socialSection);

  const emailEntries: EmailEntry[] = [];
  const phoneEntries: Record<string, FieldEntry> = {};
  const socialEntries: SocialEntry[] = [];

  const createEmailEntry = (value = ""): EmailEntry => {
    const wrapper = document.createElement("div");
    wrapper.className = "family-drawer__list-item";

    const input = document.createElement("input");
    input.type = "email";
    input.className = "family-drawer__input";
    input.value = value;
    wrapper.appendChild(input);

    const controls = document.createElement("div");
    controls.className = "family-drawer__item-controls";
    wrapper.appendChild(controls);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "family-drawer__remove";
    removeButton.textContent = "Remove";
    controls.appendChild(removeButton);

    const error = document.createElement("div");
    error.className = "family-drawer__error";
    error.hidden = true;
    wrapper.appendChild(error);

    const entry: EmailEntry = { wrapper, input, removeButton, error };

    removeButton.addEventListener("click", (event) => {
      event.preventDefault();
      if (emailEntries.length === 1) {
        entry.input.value = "";
        setFieldError(entry, null);
        return;
      }
      const index = emailEntries.indexOf(entry);
      if (index >= 0) {
        emailEntries.splice(index, 1);
      }
      wrapper.remove();
    });

    emailEntries.push(entry);
    emailList.appendChild(wrapper);
    return entry;
  };

  const ensureEmailRow = () => {
    if (emailEntries.length === 0) {
      createEmailEntry();
    }
  };

  addEmailButton.addEventListener("click", (event) => {
    event.preventDefault();
    const entry = createEmailEntry();
    entry.input.focus();
  });

  const PHONE_FIELDS: Array<{ key: keyof PersonalFormData; label: string }> = [
    { key: "phoneMobile", label: "Mobile" },
    { key: "phoneHome", label: "Home" },
    { key: "phoneWork", label: "Work" },
  ];

  for (const field of PHONE_FIELDS) {
    const entry = createField(field.label);
    entry.input.setAttribute("data-phone-field", field.key);
    phoneList.appendChild(entry.wrapper);
    phoneEntries[field.key] = entry;
  }

  const createSocialEntry = (keyValue: SocialLinkRow = { key: "", value: "" }): SocialEntry => {
    const wrapper = document.createElement("div");
    wrapper.className = "family-drawer__social-item";

    const keyInput = document.createElement("input");
    keyInput.type = "text";
    keyInput.className = "family-drawer__input family-drawer__input--small";
    keyInput.placeholder = "Label";
    keyInput.value = keyValue.key;

    const valueInput = document.createElement("input");
    valueInput.type = "url";
    valueInput.className = "family-drawer__input family-drawer__input--wide";
    valueInput.placeholder = "https://";
    valueInput.value = keyValue.value;

    wrapper.append(keyInput, valueInput);

    const controls = document.createElement("div");
    controls.className = "family-drawer__item-controls";
    wrapper.appendChild(controls);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "family-drawer__remove";
    removeButton.textContent = "Remove";
    controls.appendChild(removeButton);

    const error = document.createElement("div");
    error.className = "family-drawer__error";
    error.hidden = true;
    wrapper.appendChild(error);

    const entry: SocialEntry = { wrapper, keyInput, valueInput, removeButton, error };

    removeButton.addEventListener("click", (event) => {
      event.preventDefault();
      const index = socialEntries.indexOf(entry);
      if (index >= 0) {
        socialEntries.splice(index, 1);
      }
      wrapper.remove();
    });

    socialEntries.push(entry);
    socialList.appendChild(wrapper);
    return entry;
  };

  addSocialButton.addEventListener("click", (event) => {
    event.preventDefault();
    const entry = createSocialEntry();
    entry.keyInput.focus();
  });

  ensureEmailRow();

  const getData = (): PersonalFormData => {
    const emails = emailEntries.map((entry) => normalizeString(entry.input.value)).filter((value) => value.length > 0);
    return {
      nickname: normalizeString((nicknameField.input as HTMLInputElement).value),
      fullName: normalizeString((fullNameField.input as HTMLInputElement).value),
      relationship: normalizeString((relationshipField.input as HTMLInputElement).value),
      address: normalizeString((addressField.input as HTMLTextAreaElement).value),
      emails,
      phoneMobile: normalizeString((phoneEntries.phoneMobile.input as HTMLInputElement).value),
      phoneHome: normalizeString((phoneEntries.phoneHome.input as HTMLInputElement).value),
      phoneWork: normalizeString((phoneEntries.phoneWork.input as HTMLInputElement).value),
      website: normalizeString((websiteField.input as HTMLInputElement).value),
      socialLinks: socialEntries
        .map((entry) => ({ key: normalizeString(entry.keyInput.value), value: normalizeString(entry.valueInput.value) }))
        .filter((item) => item.key.length > 0 || item.value.length > 0),
      photoPath: currentPhotoPath,
    };
  };

  const setData = (data: PersonalFormData) => {
    (nicknameField.input as HTMLInputElement).value = data.nickname ?? "";
    (fullNameField.input as HTMLInputElement).value = data.fullName ?? "";
    (relationshipField.input as HTMLInputElement).value = data.relationship ?? "";
    (addressField.input as HTMLTextAreaElement).value = data.address ?? "";
    (websiteField.input as HTMLInputElement).value = data.website ?? "";

    emailEntries.splice(0, emailEntries.length);
    emailList.replaceChildren();
    const emailValues = data.emails && data.emails.length > 0 ? data.emails : [""];
    for (const value of emailValues) {
      createEmailEntry(value ?? "");
    }

    (phoneEntries.phoneMobile.input as HTMLInputElement).value = data.phoneMobile ?? "";
    (phoneEntries.phoneHome.input as HTMLInputElement).value = data.phoneHome ?? "";
    (phoneEntries.phoneWork.input as HTMLInputElement).value = data.phoneWork ?? "";

    socialEntries.splice(0, socialEntries.length);
    socialList.replaceChildren();
    if (data.socialLinks && data.socialLinks.length > 0) {
      for (const entry of data.socialLinks) {
        createSocialEntry(entry);
      }
    } else {
      createSocialEntry();
    }

    ensureEmailRow();
  };

  const validate = (): PersonalValidationResult => {
    let firstInvalid: (() => void) | undefined;

    const assignError = (entry: FieldEntry | EmailEntry | SocialEntry, message: string | null) => {
      setFieldError(entry, message);
      if (message && !firstInvalid) {
        firstInvalid = () => {
          const input = (entry as FieldEntry).input ?? (entry as EmailEntry).input ?? (entry as SocialEntry).keyInput;
          input.focus();
        };
      }
    };

    const data = getData();

    assignError(nicknameField, data.nickname.length === 0 ? "Nickname is required." : null);

    for (const emailEntry of emailEntries) {
      const value = emailEntry.input.value.trim();
      if (value.length === 0) {
        assignError(emailEntry, null);
        continue;
      }
      if (!isValidEmail(value)) {
        assignError(emailEntry, "Enter a valid email address.");
      } else {
        assignError(emailEntry, null);
      }
    }

    const phoneMap: Array<[keyof PersonalFormData, FieldEntry, string]> = [
      ["phoneMobile", phoneEntries.phoneMobile, "Enter a valid mobile number."],
      ["phoneHome", phoneEntries.phoneHome, "Enter a valid home number."],
      ["phoneWork", phoneEntries.phoneWork, "Enter a valid work number."],
    ];

    for (const [key, entry, message] of phoneMap) {
      const value = (data[key] as string) ?? "";
      if (!value) {
        assignError(entry, null);
        continue;
      }
      assignError(entry, isValidPhone(value) ? null : message);
    }

    if (data.website) {
      assignError(websiteField, isValidUrl(data.website) ? null : "Enter a valid URL.");
    } else {
      assignError(websiteField, null);
    }

    for (const socialEntry of socialEntries) {
      const key = socialEntry.keyInput.value.trim();
      const value = socialEntry.valueInput.value.trim();
      if (!key && !value) {
        assignError(socialEntry, null);
        continue;
      }
      if (!key) {
        assignError(socialEntry, "Add a label for this link.");
        continue;
      }
      if (!value) {
        assignError(socialEntry, "Add a URL for this link.");
        continue;
      }
      assignError(socialEntry, isValidUrl(value) ? null : "Enter a valid URL.");
    }

    const valid = !firstInvalid;
    return { valid, focus: firstInvalid };
  };

  return {
    element,
    setData,
    getData,
    validate,
    setPhotoFromMember(member: FamilyMember | null) {
      currentPhotoPath = member?.photoPath ?? null;
      pendingPhoto = null;
      photoRemoved = false;
      void renderAvatarFromVault(member?.householdId ?? null, currentPhotoPath);
    },
    getPendingPhoto() {
      return pendingPhoto;
    },
    clearPendingPhoto() {
      pendingPhoto = null;
    },
    markPhotoRemoved() {
      photoRemoved = true;
      pendingPhoto = null;
      currentPhotoPath = null;
      void renderAvatarFromVault(null, null);
    },
    isPhotoRemoved() {
      return photoRemoved;
    },
  };
}

// ---- Avatar helpers (scoped within module) ----
let currentPhotoPath: string | null = null;
let pendingPhoto: { name: string; mimeType: string | null; read: () => Promise<Uint8Array> } | null = null;
let photoRemoved = false;

// (listeners are declared inside createPersonalTab)
