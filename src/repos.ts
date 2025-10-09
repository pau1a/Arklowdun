// src/repos.ts
import { call } from "@lib/ipc/call";
import { logUI } from "@lib/uiLog";
import { z } from "zod";
import {
  AttachmentInputSchema,
  AttachmentRefSchema,
  RenewalInputSchema,
  RenewalSchema,
  type AttachmentInput,
  type AttachmentRef,
  type Renewal,
  type RenewalInput,
} from "@lib/ipc/contracts";
import { clearSearchCache } from "./services/searchRepo";

import type {
  Bill,
  Policy,
  PropertyDocument,
  Pet,
  PetMedicalRecord,
  FamilyMember,
  InventoryItem,
  ShoppingItem,
  Event,
  BudgetCategory,
  Category,
  Expense,
} from "./models";
import type { Note } from "@features/notes";
import type { EventsListRangeResponse } from "@bindings/EventsListRangeResponse";

type ListOpts = {
  householdId: string;
  orderBy?: string;
  limit?: number;
  offset?: number;
  includeHidden?: boolean;
};

const SEARCH_TABLES = new Set(["notes", "events", "vehicles", "pets"]);

// Generic repo factory with per-table default ordering
function domainRepo<T extends object>(table: string, defaultOrderBy: string) {
  return {
    async list(opts: ListOpts): Promise<T[]> {
      if (table === "events") {
        throw new Error(
          'Do not use domainRepo("events"). Use eventsApi.listRange(...) (events_list_range) instead.'
        );
      }
      const args: Record<string, unknown> = {
        householdId: opts.householdId,
        orderBy: opts.orderBy ?? defaultOrderBy,
        limit: opts.limit,
        offset: opts.offset,
      };

      if (table === "categories" && typeof opts.includeHidden === "boolean") {
        args.includeHidden = opts.includeHidden;
        // Some command bindings still rely on snake_case parameters; include both for safety.
        args.include_hidden = opts.includeHidden;
      }

      return await call<T[]>(`${table}_list`, args);
    },

    async create(householdId: string, data: Partial<T>): Promise<T> {
      if (table === "events") {
        throw new Error('Do not use domainRepo("events"). Use eventsApi.* helpers.');
      }
      const out = await call<T>(`${table}_create`, {
        data: { ...data, household_id: householdId },
      });
      // after successful write (post-await) by design
      if (SEARCH_TABLES.has(table)) clearSearchCache();
      return out;
    },

    async update(householdId: string, id: string, data: Partial<T>): Promise<void> {
      if (data == null || (typeof data === "object" && Object.keys(data).length === 0)) {
        logUI("INFO", "repo.update.noop", { table, id });
        return;
      }
      if (table === "events") {
        throw new Error('Do not use domainRepo("events"). Use eventsApi.* helpers.');
      }
      await call(`${table}_update`, { id, data, householdId });
      // after successful write (post-await) by design
      if (SEARCH_TABLES.has(table)) clearSearchCache();
    },

    async delete(householdId: string, id: string): Promise<void> {
      if (table === "events") {
        throw new Error('Do not use domainRepo("events"). Use eventsApi.* helpers.');
      }
      await call(`${table}_delete`, { householdId, id });
      // after successful write (post-await) by design
      if (SEARCH_TABLES.has(table)) clearSearchCache();
    },

    async restore(householdId: string, id: string): Promise<void> {
      if (table === "events") {
        throw new Error('Do not use domainRepo("events"). Use eventsApi.* helpers.');
      }
      await call(`${table}_restore`, { householdId, id });
      // after successful write (post-await) by design
      if (SEARCH_TABLES.has(table)) clearSearchCache();
    },
  };
}

// ---- Normal repos ----
export const billsRepo            = domainRepo<Bill>("bills", "position, created_at, id");
export const policiesRepo         = domainRepo<Policy>("policies", "position, created_at, id");
export const propertyDocsRepo     = domainRepo<PropertyDocument>("property_documents", "position, created_at, id");
export const petsRepo             = domainRepo<Pet>("pets", "position, created_at, id");
export const petMedicalRepo       = domainRepo<PetMedicalRecord>("pet_medical", "date DESC, created_at DESC, id");
const familyMembersRepo           = domainRepo<FamilyMember>("family_members", "position, created_at, id");

const FamilyMemberCreateRequestSchema = z
  .object({
    householdId: z.string().min(1),
    name: z.string().min(1),
    position: z.number().int().nonnegative(),
    notes: z.string().nullable().optional(),
  })
  .passthrough();

export type FamilyMemberCreateRequest = z.infer<typeof FamilyMemberCreateRequestSchema>;
export const inventoryRepo        = domainRepo<InventoryItem>("inventory_items", "position, created_at, id");
export const notesRepo            = domainRepo<Note>("notes", "position, created_at, id");
export const shoppingRepo         = domainRepo<ShoppingItem>("shopping_items", "position, created_at, id");

export const familyRepo = {
  ...familyMembersRepo,
  async create(input: FamilyMemberCreateRequest): Promise<FamilyMember> {
    const payload = FamilyMemberCreateRequestSchema.parse(input);
    const args = {
      householdId: payload.householdId,
      name: payload.name,
      position: payload.position,
      notes: payload.notes ?? null,
    } satisfies Record<string, unknown>;
    const response = await call("family_members_create", args);
    if (response == null) {
      const error: Error & { code?: string; context?: unknown } = new Error(
        "family_members_create returned null/undefined",
      );
      error.code = "IPC_NULL_RESPONSE";
      error.context = { args };
      throw error;
    }
    return response as FamilyMember;
  },
  attachments: {
    async list(memberId: string): Promise<AttachmentRef[]> {
      const start = performance.now();
      logUI("DEBUG", "ui.family.attachments.list.start", { member_id: memberId });
      try {
        const response = await call("member_attachments_list", { memberId });
        const parsed = AttachmentRefSchema.array().parse(response);
        logUI("INFO", "ui.family.attachments.list.complete", {
          member_id: memberId,
          count: parsed.length,
          duration_ms: Math.round(performance.now() - start),
        });
        return parsed;
      } catch (error) {
        logUI("ERROR", "ui.family.attachments.list.error", {
          member_id: memberId,
          message: (error as Error)?.message ?? String(error),
        });
        throw error;
      }
    },
    async add(input: AttachmentInput): Promise<AttachmentRef> {
      const payload = AttachmentInputSchema.parse(input);
      const start = performance.now();
      logUI("DEBUG", "ui.family.attachments.add.start", {
        member_id: payload.member_id,
        household_id: payload.household_id,
      });
      try {
        const response = await call("member_attachments_add", payload);
        const parsed = AttachmentRefSchema.parse(response);
        logUI("INFO", "ui.family.attachments.add.complete", {
          member_id: payload.member_id,
          attachment_id: parsed.id,
          duration_ms: Math.round(performance.now() - start),
        });
        return parsed;
      } catch (error) {
        logUI("ERROR", "ui.family.attachments.add.error", {
          member_id: payload.member_id,
          message: (error as Error)?.message ?? String(error),
        });
        throw error;
      }
    },
    async remove(id: string): Promise<void> {
      const start = performance.now();
      logUI("DEBUG", "ui.family.attachments.remove.start", { attachment_id: id });
      try {
        await call("member_attachments_remove", { id });
        logUI("INFO", "ui.family.attachments.remove.complete", {
          attachment_id: id,
          duration_ms: Math.round(performance.now() - start),
        });
      } catch (error) {
        logUI("ERROR", "ui.family.attachments.remove.error", {
          attachment_id: id,
          message: (error as Error)?.message ?? String(error),
        });
        throw error;
      }
    },
  },
  renewals: {
    async list(memberId?: string, householdId?: string): Promise<Renewal[]> {
      const start = performance.now();
      logUI("DEBUG", "ui.family.renewals.list.start", { member_id: memberId, household_id: householdId });
      try {
        const response = await call("member_renewals_list", { memberId, householdId });
        const parsed = RenewalSchema.array().parse(response);
        logUI("INFO", "ui.family.renewals.list.complete", {
          member_id: memberId,
          household_id: householdId,
          count: parsed.length,
          duration_ms: Math.round(performance.now() - start),
        });
        return parsed;
      } catch (error) {
        logUI("ERROR", "ui.family.renewals.list.error", {
          member_id: memberId,
          household_id: householdId,
          message: (error as Error)?.message ?? String(error),
        });
        throw error;
      }
    },
    async upsert(input: RenewalInput): Promise<Renewal> {
      const payload = RenewalInputSchema.parse(input);
      const start = performance.now();
      logUI("DEBUG", "ui.family.renewals.upsert.start", {
        member_id: payload.member_id,
        household_id: payload.household_id,
      });
      try {
        const response = await call("member_renewals_upsert", payload);
        const parsed = RenewalSchema.parse(response);
        logUI("INFO", "ui.family.renewals.upsert.complete", {
          member_id: payload.member_id,
          household_id: payload.household_id,
          renewal_id: parsed.id,
          duration_ms: Math.round(performance.now() - start),
        });
        return parsed;
      } catch (error) {
        logUI("ERROR", "ui.family.renewals.upsert.error", {
          member_id: payload.member_id,
          household_id: payload.household_id,
          message: (error as Error)?.message ?? String(error),
        });
        throw error;
      }
    },
    async delete(id: string): Promise<void> {
      const start = performance.now();
      logUI("DEBUG", "ui.family.renewals.delete.start", { renewal_id: id });
      try {
        await call("member_renewals_delete", { id });
        logUI("INFO", "ui.family.renewals.delete.complete", {
          renewal_id: id,
          duration_ms: Math.round(performance.now() - start),
        });
      } catch (error) {
        logUI("ERROR", "ui.family.renewals.delete.error", {
          renewal_id: id,
          message: (error as Error)?.message ?? String(error),
        });
        throw error;
      }
    },
  },
  notes: {
    listByMember(notes: Note[], memberId: string): Note[] {
      return notes.filter((note: Note & { member_id?: string; memberId?: string }) => {
        const linked = note.member_id ?? note.memberId;
        return typeof linked === "string" && linked === memberId;
      });
    },
  },
};

// ✅ Budget repos you need for BudgetView.ts
export const categoriesRepo        = domainRepo<Category>("categories", "position, created_at, id");
export const budgetCategoriesRepo = domainRepo<BudgetCategory>("budget_categories", "position, created_at, id");
export const expensesRepo         = domainRepo<Expense>("expenses", "date DESC, created_at DESC, id");

export const billsApi = {
  async dueBetween(
    householdId: string,
    fromMs: number,
    toMs: number,
    limit = 100,
    offset = 0
  ) {
    return await call<any[]>("bills_list_due_between", {
      householdId,
      fromMs,
      toMs,
      limit,
      offset,
    });
  },
};

// ---- Events: dedicated API (uses events_list_range and singular CRUD) ----
export const eventsApi = {
  async listRange(
    householdId: string,
    start = 0,
    end = Date.now() + 90 * 24 * 60 * 60 * 1000,
  ): Promise<EventsListRangeResponse> {
    console.log("events_list_range (repos.ts)", { householdId, start, end });
    return await call<EventsListRangeResponse>("events_list_range", {
      householdId,
      start,
      end,
    });
  },
  async create(householdId: string, data: Partial<Event>): Promise<Event> {
    const out = await call<Event>("event_create", { data: { ...data, household_id: householdId } });
    // after successful write (post-await) by design
    clearSearchCache();
    return out;
  },
  async update(householdId: string, id: string, data: Partial<Event>): Promise<void> {
    await call("event_update", { id, data, householdId });
    // after successful write (post-await) by design
    clearSearchCache();
  },
  async delete(householdId: string, id: string): Promise<void> {
    await call("event_delete", { householdId, id });
    // after successful write (post-await) by design
    clearSearchCache();
  },
  async restore(householdId: string, id: string): Promise<void> {
    await call("event_restore", { householdId, id });
    // after successful write (post-await) by design
    clearSearchCache();
  },
};
