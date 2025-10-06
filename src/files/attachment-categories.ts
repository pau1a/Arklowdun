import type { AttachmentCategory as BackendAttachmentCategory } from "../bindings/AttachmentCategory";

export const ATTACHMENT_CATEGORIES = [
  "bills",
  "policies",
  "property_documents",
  "inventory_items",
  "pet_medical",
  "vehicles",
  "vehicle_maintenance",
  "notes",
  "misc",
] as const satisfies readonly BackendAttachmentCategory[];

export type AttachmentCategory = (typeof ATTACHMENT_CATEGORIES)[number];

type EnsureParity = BackendAttachmentCategory extends AttachmentCategory
  ? AttachmentCategory extends BackendAttachmentCategory
    ? true
    : never
  : never;
const _ensureAttachmentCategoryParity: EnsureParity = true;

export function isAttachmentCategory(value: string): value is AttachmentCategory {
  return (ATTACHMENT_CATEGORIES as readonly string[]).includes(value);
}
