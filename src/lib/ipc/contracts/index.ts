import { z } from "zod";
import type { Vehicle } from "@bindings/Vehicle";
import type { Event } from "@bindings/Event";
import type { NotesPage } from "@bindings/NotesPage";
import type { ContextNotesPage } from "@bindings/ContextNotesPage";
import type { Note } from "@bindings/Note";
import type { NoteLink } from "@bindings/NoteLink";
import type { NoteLinkList } from "@bindings/NoteLinkList";
import type { NotesDeadlineRangePage } from "@bindings/NotesDeadlineRangePage";
import type { EventsListRangeResponse } from "@bindings/EventsListRangeResponse";
import type { BackupOverview } from "@bindings/BackupOverview";
import type { BackupEntry } from "@bindings/BackupEntry";
import type { ExportEntryDto } from "@bindings/ExportEntryDto";
import type { ValidationReport } from "@bindings/ValidationReport";
import type { ImportPreviewDto } from "@bindings/ImportPreviewDto";
import type { ImportExecuteDto } from "@bindings/ImportExecuteDto";
import type { HardRepairOutcome } from "@bindings/HardRepairOutcome";
import type { DbHealthReport } from "@bindings/DbHealthReport";
import type { SearchResult } from "@bindings/SearchResult";

export type ContractEntry<K extends keyof typeof contracts> = (typeof contracts)[K];

const flexibleRequest = z.object({}).passthrough();

const emptyObject = z.object({}).strict();

const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/)
  .transform((value: string) => value.toUpperCase());

const nullableHexColor = z.union([hexColor, z.null()]);

const householdRecord = z
  .object({
    id: z.string(),
    name: z.string().optional().nullable(),
    is_default: z.union([z.boolean(), z.number()]).optional().nullable(),
    tz: z.string().optional().nullable(),
    created_at: z.number().optional().nullable(),
    updated_at: z.number().optional().nullable(),
    deleted_at: z.number().optional().nullable(),
    color: z.string().optional().nullable(),
  })
  .passthrough();

const householdArgs = z
  .object({
    name: z.string().min(1),
    color: nullableHexColor.optional(),
  })
  .passthrough();

const householdUpdateArgs = householdArgs
  .extend({
    id: z.string(),
  })
  .partial({ name: true, color: true })
  .required({ id: true });

const filesIndexRequestBase = z
  .object({
    household_id: z.string().optional(),
    householdId: z.string().optional(),
  })
  .passthrough();

const filesIndexRequest = filesIndexRequestBase.superRefine(
  (value: z.infer<typeof filesIndexRequestBase>, ctx: z.RefinementCtx) => {
    if (typeof value.household_id === "string" || typeof value.householdId === "string") {
      return;
    }
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "household id required" });
  },
);

const filesIndexMode = z.enum(["full", "incremental"]);
const filesIndexState = z.enum(["Idle", "Building", "Cancelling", "Error"]);
const filesIndexStatusResponse = z.object({
  last_built_at: z.string().nullable(),
  row_count: z.number(),
  state: filesIndexState,
});
const filesIndexSummaryResponse = z.object({
  total: z.number(),
  updated: z.number(),
  duration_ms: z.number(),
});
const filesIndexCancelResponse = z.object({ cancelled: z.boolean() });
const filesIndexRebuildRequest = filesIndexRequestBase
  .extend({ mode: filesIndexMode })
  .superRefine((value, ctx) => {
    if (typeof value.household_id === "string" || typeof value.householdId === "string") {
      return;
    }
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "household id required" });
  });

const attachmentCategory = z.enum([
  "bills",
  "policies",
  "property_documents",
  "inventory_items",
  "pet_medical",
  "vehicles",
  "vehicle_maintenance",
  "notes",
  "misc",
]);

const conflictStrategy = z.enum(["rename", "fail"]);
const attachmentsRepairMode = z.enum(["scan", "apply"]);

const fileMoveRequest = z
  .object({
    household_id: z.string(),
    from_category: attachmentCategory,
    from_rel: z.string().min(1),
    to_category: attachmentCategory,
    to_rel: z.string().min(1),
    conflict: conflictStrategy.optional(),
  })
  .passthrough();

const fileMoveResponse = z.object({
  moved: z.number(),
  renamed: z.boolean(),
});

const attachmentsRepairRequest = z
  .object({
    household_id: z.string(),
    mode: attachmentsRepairMode,
  })
  .passthrough();

const attachmentsRepairResponse = z.object({
  scanned: z.number(),
  missing: z.number(),
  repaired: z.number(),
  cancelled: z.boolean(),
});

const attachmentsRepairManifestExportRequest = z
  .object({
    household_id: z.string(),
  })
  .passthrough();

const householdDeleteResponse = z
  .object({ fallbackId: z.string().nullable().optional() })
  .passthrough();

const dbRequest = emptyObject;

const eventCreateData = z
  .object({
    household_id: z.string(),
    title: z.string().min(1),
    start_at_utc: z.number(),
    end_at_utc: z.number().nullable().optional(),
    tz: z.string().nullable().optional(),
    rule: z.string().optional(),
    exdates: z.string().optional(),
    reminder: z.number().nullable().optional(),
    series_parent_id: z.string().nullable().optional(),
  })
  .passthrough();

const eventUpdateData = eventCreateData
  .extend({
    household_id: z.string().optional(),
    title: z.string().min(1).optional(),
    start_at_utc: z.number().optional(),
  })
  .partial()
  .passthrough();

const notesCreateData = z
  .object({
    household_id: z.string(),
    text: z.string(),
    color: z.string(),
    x: z.number(),
    y: z.number(),
    category_id: z.string().nullable().optional(),
    position: z.number().optional(),
    z: z.number().optional(),
    deadline: z.number().nullable().optional(),
    deadline_tz: z.string().nullable().optional(),
  })
  .passthrough();

const notesUpdateData = notesCreateData
  .extend({
    color: z.string().optional(),
    text: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    deadline: z.union([z.number(), z.null()]).optional(),
    deadline_tz: z.union([z.string(), z.null()]).optional(),
    household_id: z.string().optional(),
    deleted_at: z.union([z.number(), z.null()]).optional(),
  })
  .partial()
  .passthrough();

const idRequest = z.object({ id: z.string() }).passthrough();

const householdScopedRequest = z
  .object({
    householdId: z.string(),
  })
  .passthrough();

const entityScopedRequest = householdScopedRequest.extend({
  id: z.string(),
});

const stringArray = z.array(z.string());

const notesListCursorRequest = z
  .object({
    householdId: z.string(),
    household_id: z.string().optional(),
    afterCursor: z.string().nullable().optional(),
    after_cursor: z.string().nullable().optional(),
    limit: z.number().optional(),
    categoryIds: stringArray.optional(),
    category_ids: stringArray.optional(),
    includeDeleted: z.boolean().optional(),
    include_deleted: z.boolean().optional(),
  })
  .passthrough();

const notesEntityRequest = z
  .object({
    householdId: z.string(),
    household_id: z.string().optional(),
    entityType: z.string(),
    entity_type: z.string().optional(),
    entityId: z.string(),
    entity_id: z.string().optional(),
    categoryIds: stringArray.optional(),
    category_ids: stringArray.optional(),
    cursor: z.string().nullable().optional(),
    limit: z.number().optional(),
    offset: z.number().optional(),
    orderBy: z.string().optional(),
    order_by: z.string().optional(),
  })
  .passthrough();

const noteLinkRequest = z
  .object({
    householdId: z.string(),
    household_id: z.string().optional(),
    noteId: z.string().optional(),
    note_id: z.string().optional(),
    linkId: z.string().optional(),
    entityType: z.string().optional(),
    entity_type: z.string().optional(),
    entityId: z.string().optional(),
    entity_id: z.string().optional(),
  })
  .passthrough();

const notesQuickCreateRequest = z
  .object({
    householdId: z.string(),
    entityType: z.string(),
    entityId: z.string(),
    categoryId: z.string(),
    text: z.string(),
    color: z.string().optional(),
  })
  .passthrough();

const notesDeadlineRangeRequest = z
  .object({
    householdId: z.string(),
    household_id: z.string().optional(),
    startUtc: z.number().optional(),
    start_utc: z.number(),
    endUtc: z.number().optional(),
    end_utc: z.number(),
    viewerTz: z.string().optional(),
    viewer_tz: z.string(),
    categoryIds: stringArray.optional(),
    category_ids: stringArray.optional(),
    cursor: z.string().nullable().optional(),
    limit: z.number().optional(),
  })
  .passthrough();

const vehicleCreateData = z
  .object({
    household_id: z.string(),
    name: z.string().min(1),
    make: z.string().optional(),
    model: z.string().optional(),
    reg: z.string().optional(),
    vin: z.string().optional(),
    next_mot_due: z.number().nullable().optional(),
    next_service_due: z.number().nullable().optional(),
    position: z.number().optional(),
  })
  .passthrough();

const vehicleUpdateData = vehicleCreateData.partial().extend({
  name: z.string().min(1).optional(),
  household_id: z.string().optional(),
});

function contract<Req extends z.ZodTypeAny, Res extends z.ZodTypeAny>(config: {
  request: Req;
  response: Res;
}) {
  return config;
}

export const contracts = {
  about_metadata: contract({ request: flexibleRequest, response: flexibleRequest }),
  attachment_open: contract({ request: flexibleRequest, response: z.null() }),
  attachment_reveal: contract({ request: flexibleRequest, response: z.null() }),
  attachments_repair: contract({
    request: attachmentsRepairRequest,
    response: attachmentsRepairResponse,
  }),
  attachments_repair_manifest_export: contract({
    request: attachmentsRepairManifestExportRequest,
    response: z.string(),
  }),
  bills_list: contract({ request: flexibleRequest, response: z.array(flexibleRequest) }),
  bills_get: contract({ request: flexibleRequest, response: flexibleRequest.nullable() }),
  bills_create: contract({ request: flexibleRequest, response: flexibleRequest }),
  bills_update: contract({ request: flexibleRequest, response: flexibleRequest }),
  bills_delete: contract({ request: flexibleRequest, response: flexibleRequest }),
  bills_restore: contract({ request: flexibleRequest, response: flexibleRequest }),
  bills_list_due_between: contract({ request: flexibleRequest, response: z.array(flexibleRequest) }),
  file_move: contract({
    request: fileMoveRequest,
    response: fileMoveResponse,
  }),
  db_backup_create: contract({ request: flexibleRequest, response: z.custom<BackupEntry>() }),
  db_backup_overview: contract({ request: flexibleRequest, response: z.custom<BackupOverview>() }),
  db_backup_reveal: contract({ request: flexibleRequest, response: z.void() }),
  db_backup_reveal_root: contract({ request: flexibleRequest, response: z.void() }),
  db_export_run: contract({ request: flexibleRequest, response: z.custom<ExportEntryDto>() }),
  db_files_index_ready: contract({ request: filesIndexRequest, response: z.boolean() }),
  db_has_files_index: contract({ request: flexibleRequest, response: z.boolean() }),
  files_index_status: contract({
    request: filesIndexRequest,
    response: filesIndexStatusResponse,
  }),
  files_index_rebuild: contract({
    request: filesIndexRebuildRequest,
    response: filesIndexSummaryResponse,
  }),
  files_index_cancel: contract({
    request: filesIndexRequest,
    response: filesIndexCancelResponse,
  }),
  db_get_health_report: contract({ request: dbRequest, response: z.custom<DbHealthReport>() }),
  db_hard_repair_run: contract({ request: flexibleRequest, response: z.custom<HardRepairOutcome>() }),
  db_has_pet_columns: contract({ request: flexibleRequest, response: z.boolean() }),
  db_has_vehicle_columns: contract({ request: flexibleRequest, response: z.boolean() }),
  db_import_execute: contract({ request: flexibleRequest, response: z.custom<ImportExecuteDto>() }),
  db_import_preview: contract({ request: flexibleRequest, response: z.custom<ImportPreviewDto>() }),
  db_recheck: contract({ request: dbRequest, response: z.custom<DbHealthReport>() }),
  db_repair_run: contract({ request: flexibleRequest, response: z.custom<ValidationReport>() }),
  db_table_exists: contract({ request: flexibleRequest, response: z.boolean() }),
  diagnostics_doc_path: contract({ request: flexibleRequest, response: z.string() }),
  diagnostics_household_stats: contract({ request: flexibleRequest, response: flexibleRequest }),
  diagnostics_summary: contract({ request: flexibleRequest, response: flexibleRequest }),
  events_backfill_timezone: contract({ request: flexibleRequest, response: flexibleRequest }),
  events_backfill_timezone_cancel: contract({ request: flexibleRequest, response: z.null() }),
  events_backfill_timezone_status: contract({ request: flexibleRequest, response: flexibleRequest }),
  events_list_range: contract({
    request: z
      .object({ householdId: z.string(), start: z.number(), end: z.number() })
      .passthrough(),
    response: z.custom<EventsListRangeResponse>(),
  }),
  event_create: contract({
    request: z.object({ data: eventCreateData }).passthrough(),
    response: z.custom<Event>(),
  }),
  event_update: contract({
    request: z
      .object({ id: z.string(), data: eventUpdateData, householdId: z.string() })
      .passthrough(),
    response: z.null(),
  }),
  event_delete: contract({
    request: z
      .object({ householdId: z.string(), id: z.string() })
      .passthrough(),
    response: z.null(),
  }),
  event_restore: contract({
    request: z
      .object({ householdId: z.string(), id: z.string() })
      .passthrough(),
    response: z.null(),
  }),
  expenses_list: contract({ request: flexibleRequest, response: z.array(flexibleRequest) }),
  expenses_get: contract({ request: flexibleRequest, response: flexibleRequest.nullable() }),
  expenses_create: contract({ request: flexibleRequest, response: flexibleRequest }),
  expenses_update: contract({ request: flexibleRequest, response: flexibleRequest }),
  expenses_delete: contract({ request: flexibleRequest, response: flexibleRequest }),
  expenses_restore: contract({ request: flexibleRequest, response: flexibleRequest }),
  family_members_list: contract({ request: flexibleRequest, response: z.array(flexibleRequest) }),
  family_members_get: contract({ request: flexibleRequest, response: flexibleRequest.nullable() }),
  family_members_create: contract({ request: flexibleRequest, response: flexibleRequest }),
  family_members_update: contract({ request: flexibleRequest, response: flexibleRequest }),
  family_members_delete: contract({ request: flexibleRequest, response: flexibleRequest }),
  family_members_restore: contract({ request: flexibleRequest, response: flexibleRequest }),
  household_create: contract({
    request: z.object({ args: householdArgs }).passthrough(),
    response: householdRecord,
  }),
  household_delete: contract({
    request: idRequest,
    response: householdDeleteResponse,
  }),
  household_get: contract({ request: idRequest, response: householdRecord.nullable() }),
  household_get_active: contract({ request: emptyObject, response: z.string().nullable() }),
  household_list_all: contract({ request: flexibleRequest, response: z.array(householdRecord) }),
  household_list: contract({
    request: z.object({ includeDeleted: z.boolean().optional() }).passthrough(),
    response: z.array(householdRecord),
  }),
  household_repair: contract({ request: flexibleRequest, response: flexibleRequest }),
  household_resume_delete: contract({ request: idRequest, response: householdRecord }),
  household_restore: contract({ request: idRequest, response: householdRecord }),
  household_vacuum_execute: contract({ request: flexibleRequest, response: flexibleRequest }),
  household_set_active: contract({ request: idRequest, response: z.null() }),
  household_update: contract({
    request: z.object({ args: householdUpdateArgs }).passthrough(),
    response: householdRecord,
  }),
  import_run_legacy: contract({ request: flexibleRequest, response: flexibleRequest }),
  inventory_items_list: contract({ request: flexibleRequest, response: z.array(flexibleRequest) }),
  inventory_items_get: contract({ request: flexibleRequest, response: flexibleRequest.nullable() }),
  inventory_items_create: contract({ request: flexibleRequest, response: flexibleRequest }),
  inventory_items_update: contract({ request: flexibleRequest, response: flexibleRequest }),
  inventory_items_delete: contract({ request: flexibleRequest, response: flexibleRequest }),
  inventory_items_restore: contract({ request: flexibleRequest, response: flexibleRequest }),
  notes_get: contract({ request: flexibleRequest, response: z.custom<Note>().nullable() }),
  notes_create: contract({
    request: z.object({ data: notesCreateData }).passthrough(),
    response: z.custom<Note>(),
  }),
  notes_update: contract({
    request: z
      .object({
        id: z.string(),
        data: notesUpdateData,
        householdId: z.string(),
        household_id: z.string().optional(),
      })
      .passthrough(),
    response: z.null(),
  }),
  notes_delete: contract({
    request: z
      .object({
        householdId: z.string(),
        household_id: z.string().optional(),
        id: z.string(),
      })
      .passthrough(),
    response: z.null(),
  }),
  notes_restore: contract({
    request: z
      .object({
        householdId: z.string(),
        household_id: z.string().optional(),
        id: z.string(),
      })
      .passthrough(),
    response: z.custom<Note>(),
  }),
  notes_list_cursor: contract({
    request: notesListCursorRequest,
    response: z.custom<NotesPage>(),
  }),
  notes_list_by_deadline_range: contract({
    request: notesDeadlineRangeRequest,
    response: z.custom<NotesDeadlineRangePage>(),
  }),
  notes_list_for_entity: contract({
    request: notesEntityRequest,
    response: z.custom<ContextNotesPage>(),
  }),
  notes_quick_create_for_entity: contract({
    request: notesQuickCreateRequest,
    response: z.custom<ContextNotesPage>(),
  }),
  note_links_create: contract({ request: noteLinkRequest, response: z.custom<NoteLink>() }),
  note_links_list_by_entity: contract({
    request: notesEntityRequest,
    response: z.custom<NoteLinkList>(),
  }),
  note_links_unlink_entity: contract({ request: noteLinkRequest, response: z.null() }),
  note_links_get_for_note: contract({ request: noteLinkRequest, response: z.custom<NoteLinkList>() }),
  note_links_delete: contract({ request: noteLinkRequest, response: z.null() }),
  open_diagnostics_doc: contract({ request: flexibleRequest, response: z.null() }),
  open_path: contract({ request: flexibleRequest, response: z.null() }),
  pet_medical_list: contract({ request: flexibleRequest, response: z.array(flexibleRequest) }),
  pet_medical_get: contract({ request: flexibleRequest, response: flexibleRequest.nullable() }),
  pet_medical_create: contract({ request: flexibleRequest, response: flexibleRequest }),
  pet_medical_update: contract({ request: flexibleRequest, response: flexibleRequest }),
  pet_medical_delete: contract({ request: flexibleRequest, response: flexibleRequest }),
  pet_medical_restore: contract({ request: flexibleRequest, response: flexibleRequest }),
  pets_list: contract({ request: flexibleRequest, response: z.array(flexibleRequest) }),
  pets_get: contract({ request: flexibleRequest, response: flexibleRequest.nullable() }),
  pets_create: contract({ request: flexibleRequest, response: flexibleRequest }),
  pets_update: contract({ request: flexibleRequest, response: flexibleRequest }),
  pets_delete: contract({ request: flexibleRequest, response: flexibleRequest }),
  pets_restore: contract({ request: flexibleRequest, response: flexibleRequest }),
  policies_list: contract({ request: flexibleRequest, response: z.array(flexibleRequest) }),
  policies_get: contract({ request: flexibleRequest, response: flexibleRequest.nullable() }),
  policies_create: contract({ request: flexibleRequest, response: flexibleRequest }),
  policies_update: contract({ request: flexibleRequest, response: flexibleRequest }),
  policies_delete: contract({ request: flexibleRequest, response: flexibleRequest }),
  policies_restore: contract({ request: flexibleRequest, response: flexibleRequest }),
  property_documents_list: contract({ request: flexibleRequest, response: z.array(flexibleRequest) }),
  property_documents_get: contract({ request: flexibleRequest, response: flexibleRequest.nullable() }),
  property_documents_create: contract({ request: flexibleRequest, response: flexibleRequest }),
  property_documents_update: contract({ request: flexibleRequest, response: flexibleRequest }),
  property_documents_delete: contract({ request: flexibleRequest, response: flexibleRequest }),
  property_documents_restore: contract({ request: flexibleRequest, response: flexibleRequest }),
  search_entities: contract({ request: flexibleRequest, response: z.array(z.custom<SearchResult>()) }),
  shopping_items_list: contract({ request: flexibleRequest, response: z.array(flexibleRequest) }),
  shopping_items_get: contract({ request: flexibleRequest, response: flexibleRequest.nullable() }),
  shopping_items_create: contract({ request: flexibleRequest, response: flexibleRequest }),
  shopping_items_update: contract({ request: flexibleRequest, response: flexibleRequest }),
  shopping_items_delete: contract({ request: flexibleRequest, response: flexibleRequest }),
  shopping_items_restore: contract({ request: flexibleRequest, response: flexibleRequest }),
  time_invariants_check: contract({ request: flexibleRequest, response: flexibleRequest }),
  vehicle_maintenance_list: contract({ request: flexibleRequest, response: z.array(flexibleRequest) }),
  vehicle_maintenance_get: contract({ request: flexibleRequest, response: flexibleRequest.nullable() }),
  vehicle_maintenance_create: contract({ request: flexibleRequest, response: flexibleRequest }),
  vehicle_maintenance_update: contract({ request: flexibleRequest, response: flexibleRequest }),
  vehicle_maintenance_delete: contract({ request: flexibleRequest, response: flexibleRequest }),
  vehicle_maintenance_restore: contract({ request: flexibleRequest, response: flexibleRequest }),
  vehicles_list: contract({ request: householdScopedRequest, response: z.array(z.custom<Vehicle>()) }),
  vehicles_get: contract({
    request: householdScopedRequest.extend({ id: z.string() }),
    response: z.custom<Vehicle>().nullable(),
  }),
  vehicles_create: contract({
    request: z.object({ data: vehicleCreateData }).passthrough(),
    response: z.custom<Vehicle>(),
  }),
  vehicles_update: contract({
    request: z
      .object({ id: z.string(), data: vehicleUpdateData, householdId: z.string() })
      .passthrough(),
    response: z.null(),
  }),
  vehicles_delete: contract({ request: entityScopedRequest, response: z.null() }),
  vehicles_restore: contract({ request: entityScopedRequest, response: z.null() }),
  categories_list: contract({ request: flexibleRequest, response: z.array(flexibleRequest) }),
  categories_get: contract({ request: flexibleRequest, response: flexibleRequest.nullable() }),
  categories_create: contract({ request: flexibleRequest, response: flexibleRequest }),
  categories_update: contract({ request: flexibleRequest, response: flexibleRequest }),
  categories_delete: contract({ request: flexibleRequest, response: flexibleRequest }),
  categories_restore: contract({ request: flexibleRequest, response: flexibleRequest }),
  budget_categories_list: contract({ request: flexibleRequest, response: z.array(flexibleRequest) }),
  budget_categories_get: contract({ request: flexibleRequest, response: flexibleRequest.nullable() }),
  budget_categories_create: contract({ request: flexibleRequest, response: flexibleRequest }),
  budget_categories_update: contract({ request: flexibleRequest, response: flexibleRequest }),
  budget_categories_delete: contract({ request: flexibleRequest, response: flexibleRequest }),
  budget_categories_restore: contract({ request: flexibleRequest, response: flexibleRequest }),
} as const satisfies Record<string, { request: z.ZodTypeAny; response: z.ZodTypeAny }>;

export type Contracts = typeof contracts;
