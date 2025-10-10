# Pets PR6 — Attachments & Thumbnails (P5)

### Objective

Integrate vault sanitiser strictly into the Pets detail experience, add **image thumbnails** for pet medical attachments, and ship a **"Fix path"** flow that repairs broken links **without a full reload**.

**Done means:**

* Traversal/symlink/reserved-name attempts are rejected with a **friendly, specific reason**.
* A broken attachment is **fixed in-place** (UI updates live), no page remount.

---

## 1) Scope & intent

**In scope**

* Strict **sanitizeRelativePath** application on add/edit paths (UI) and vault guard validation (backend).
* Thumbnail generation & display for supported image types (`.jpg`, `.jpeg`, `.png`, `.gif`; HEIC out-of-scope).
* "Fix path" in the Medical tab: detect broken link → choose new file **within vault** → validate → update row → re-render the single card only.
* Friendly error-toasts reflecting guard codes: `PATH_OUT_OF_VAULT`, `PATH_SYMLINK_REJECTED`, `FILENAME_INVALID`, `ROOT_KEY_NOT_SUPPORTED`, `NAME_TOO_LONG`.
* Logging & diagnostics counters for missing/fixed attachments.

**Out of scope**

* Non-image previews (PDF/video).
* Cloud uploads or external drives.
* Schema changes (still using `pet_medical.relative_path` + `root_key` + `category='pet_medical'`).

---

## 2) Deliverables

| Deliverable               | Description                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Sanitiser enforcement** | Mandatory `sanitizeRelativePath()` on add/edit; backend vault guard already authoritative.                         |
| **Thumbnail service**     | IPC-backed thumbnail retrieval & cache under `$APPDATA/attachments/.thumbnails/`.                                  |
| **Broken-link detection** | UI marks missing file with inline warning and "Fix path" CTA.                                                      |
| **Fix-path flow**         | Dialog-based selector scoped to vault roots → updates `relative_path` on success; re-checks, re-renders card only. |
| **User messaging**        | Friendly toast strings for each vault error code; inline helper text near the path input.                          |
| **Tests**                 | UI + IPC tests for sanitiser errors, broken→fixed roundtrip, and thumbnail caching.                                |
| **Docs**                  | Update `docs/pets/ui.md` (attachments section) and `docs/pets/diagnostics.md` (counters/logs).                     |

---

## 3) Detailed tasks

### 3.1 Sanitiser integration (UI)

* Apply `sanitizeRelativePath()` before **every** `pet_medical_create/update` invocation when a path is present.
* Normalize to NFC; strip leading `/`; reject `./` and `../`; trim whitespace; enforce max length.
* Show inline validation message **before** invoking IPC if sanitiser fails.
* On backend failure, map guard code → friendly toast (see §3.5).

### 3.2 Vault guard validation (backend)

* No new rules; rely on existing `Vault::resolve` (symlink rejection, traversal, reserved names, allowed roots).
* Ensure `category='pet_medical'` is passed and enforced.
* Confirm errors bubble up as `AppError` with codes listed above.

### 3.3 Thumbnails (IPC + cache)

* **IPC command:** `thumbnails_get_or_create` (domain-agnostic helper; input: `{ root_key, relative_path, max_edge }`; output: `{ ok, relative_thumb_path }`).
* **Location:** `$APPDATA/attachments/.thumbnails/<sha1(root_key:relative_path)>-160.jpg` (JPEG, sRGB).
* **Creation:**

  * If file exists and is image, downscale to `max_edge = 160`.
  * If source mtime > thumb mtime → regenerate.
  * Non-image or read error → return `{ ok:false, code:'UNSUPPORTED' }` (UI shows generic file icon).
* **UI wiring:** medical record card tries thumbnail first; fallback to icon.
* **Performance:** lazy-load thumbs via IntersectionObserver; no layout shift (reserve `160×160` (or aspect-fit) box).

### 3.4 Broken-link detection & "Fix path"

* On render, call lightweight `files_exists` IPC: `{ root_key, relative_path }` → boolean.
* If missing:

  * Show inline banner on the card: "File not found. Fix path."
  * Clicking **Fix path** opens vault-scoped file dialog (start in `$APPDATA/attachments/`).
  * Run `sanitizeRelativePath()` on the chosen path; invoke `pet_medical_update({ id, relative_path: newPath })`.
  * On success:

    * Re-run `files_exists` for confirmation.
    * Invalidate thumbnail (`delete` cached entry / bump version key), fetch new one.
    * **Re-render only this card** (no remount of the detail view).
  * On failure: toast with mapped guard code.

### 3.5 Friendly error messaging

Map codes to stable copy (surfaced via `presentFsError`):

| Code                     | Copy                                                                    |
| ------------------------ | ----------------------------------------------------------------------- |
| `PATH_OUT_OF_VAULT`      | "That file isn’t inside the app’s attachments folder."                  |
| `PATH_SYMLINK_REJECTED`  | "Links aren’t allowed. Choose the real file."                           |
| `FILENAME_INVALID`       | "That name can’t be used. Try letters, numbers, dashes or underscores." |
| `ROOT_KEY_NOT_SUPPORTED` | "This location isn’t allowed for Pets documents."                       |
| `NAME_TOO_LONG`          | "That name is too long for the filesystem."                             |

### 3.6 Logging

Emit structured logs:

| Event                           | Fields                               |
| ------------------------------- | ------------------------------------ |
| `ui.pets.attachment_missing`    | `medical_id`, `path`                 |
| `ui.pets.attachment_fix_opened` | `medical_id`                         |
| `ui.pets.attachment_fixed`      | `medical_id`, `old_path`, `new_path` |
| `ui.pets.thumbnail_built`       | `path`, `w`, `h`, `ms`               |
| `ui.pets.thumbnail_cache_hit`   | `path`                               |
| `ui.pets.vault_guard_reject`    | `code`, `path`                       |

### 3.7 Diagnostics

Add counters to pets section:

```json
"pets": {
  "pet_attachments_total":  count,
  "pet_attachments_missing": count,
  "pet_thumbnails_built": count,
  "pet_thumbnails_cache_hits": count
}
```

---

## 4) Tests

### 4.1 Unit (UI)

* **Sanitiser rejects traversal:** input `../bad.jpg` → inline error, no IPC.
* **Symlink reject path:** simulate backend `PATH_SYMLINK_REJECTED` → friendly toast.
* **Fix path flow:** mark missing → choose valid → update card only; verify DOM node identity unchanged for the rest of the view.
* **Thumbnail lazy-load:** only visible cards request thumbs.

### 4.2 IPC / Integration

* **Exists check:** missing path returns false; after fix, true.
* **Thumbnail cache:** first call builds; second call cache-hits (log asserts).
* **Regeneration on mtime change:** touch source; next request rebuilds.

### 4.3 Performance

* With 50 medical records (20 images), first visible window loads thumbs without blocking the main thread; no more than 1 RAF used per frame; no layout thrash.

---

## 5) Acceptance checklist

| Condition                                 | Status | Evidence                             |
| ----------------------------------------- | ------ | ------------------------------------ |
| Sanitiser enforced before IPC             | ☐      | Unit test & code review              |
| Guard rejections show friendly reason     | ☐      | Manual screenshots & logs            |
| Missing attachment flagged inline         | ☐      | Visual QA                            |
| "Fix path" updates row **without reload** | ☐      | DOM diff shows isolated card update  |
| Thumbnails generated & cached             | ☐      | `thumbnail_built` / `cache_hit` logs |
| Non-image gracefully falls back           | ☐      | Icon shown, no errors                |
| Diagnostics counters populated            | ☐      | Exported diagnostics JSON            |
| Docs updated (`ui.md`, `diagnostics.md`)  | ☐      | Commit diff                          |

---

## 6) Verification workflow

1. Open a pet with a known missing `relative_path` → card shows "File not found. Fix path."
2. Click **Fix path**, pick a valid file within `$APPDATA/attachments/` → card updates; thumbnail appears; no view remount.
3. Try to pick a path outside the vault → get toast "That file isn’t inside the app’s attachments folder."
4. Add a new record with `../../evil.png` → inline validation blocks submit.
5. Attach an image; confirm thumb is created (log `thumbnail_built`).
6. Reopen detail → `thumbnail_cache_hit` appears.
7. Export diagnostics; see new counters populated.

---

## 7) Risks & mitigations

| Risk                            | Mitigation                                                   |
| ------------------------------- | ------------------------------------------------------------ |
| Large images stall main thread  | Generate thumbnails in Rust/worker thread; lazy-load in UI.  |
| Path dialog leaks outside vault | Enforce start dir & validate with vault guard on submit.     |
| HEIC/uncommon formats break     | Limit to jpeg/png/gif; show generic icon for others.         |
| Cache bloat                     | Cap thumbnail cache (e.g., LRU + max size) in later P tweak. |
| Full re-render sneaks back in   | Unit test DOM identity around card patches.                  |

---

## 8) Documentation updates required

| File                          | Update                                                          |
| ----------------------------- | --------------------------------------------------------------- |
| `docs/pets/ui.md`             | New **Attachments & Thumbnails** section + Fix Path flow.       |
| `docs/pets/diagnostics.md`    | Add counters and example log lines.                             |
| `docs/pets/ipc.md`            | Document `thumbnails_get_or_create` and `files_exists` helpers. |
| `docs/pets/plan/checklist.md` | Mark PR6 completion upon merge.                                 |
| `CHANGELOG.md`                | "PR6 – Attachments & thumbnails with Fix Path flow."            |

---

## 9) Sign-off

| Role          | Name              | Responsibility                                       |
| ------------- | ----------------- | ---------------------------------------------------- |
| **Developer** | Ged McSneggle     | Sanitiser wiring, IPC helpers, UI, thumbnails        |
| **Reviewer**  | Paula Livingstone | Guard-copy, UX, and non-reload fix-path verification |
| **CI**        | Automated         | UI & IPC integration tests on macOS                  |

---

**Status:** Ready for implementation

**File:** `/docs/pets/plan/pr6.md`

**Version:** 1.0

**Scope:** Enforces safe attachment paths, adds thumbnails with caching, and delivers a zero-reload Fix Path repair flow for pet medical documents.
