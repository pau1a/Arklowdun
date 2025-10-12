import type { AttachmentCategory as BackendAttachmentCategory } from "../bindings/AttachmentCategory";

export const ATTACHMENT_CATEGORIES = [
  "bills",
  "policies",
  "property_documents",
  "inventory_items",
  "pet_medical",
  "pet_image",
  "vehicles",
  "vehicle_maintenance",
  "notes",
  "misc",
] as const satisfies readonly BackendAttachmentCategory[];

export type AttachmentCategory = (typeof ATTACHMENT_CATEGORIES)[number];

export const PET_IMAGE_CATEGORY = "pet_image" as const;

type EnsureParity = BackendAttachmentCategory extends AttachmentCategory
  ? AttachmentCategory extends BackendAttachmentCategory
    ? true
    : never
  : never;
const _ensureAttachmentCategoryParity: EnsureParity = true;
void _ensureAttachmentCategoryParity;

export function isAttachmentCategory(value: string): value is AttachmentCategory {
  return (ATTACHMENT_CATEGORIES as readonly string[]).includes(value);
}
