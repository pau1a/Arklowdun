import type { ScenarioContext, ScenarioDefinition, ScenarioHandlers } from "../../src/lib/ipc/scenarioLoader";
import type { Event } from "../../src/bindings/Event";
import type { Note } from "../../src/bindings/Note";
import type { NoteLink } from "../../src/bindings/NoteLink";
import type { Vehicle } from "../../src/bindings/Vehicle";
import type { SearchResult } from "../../src/bindings/SearchResult";
import type { Category } from "../../src/bindings/Category";
import type { BackupOverview } from "../../src/bindings/BackupOverview";
import type { BackupEntry } from "../../src/bindings/BackupEntry";
import type { BackupManifest } from "../../src/bindings/BackupManifest";
import type { ExportEntryDto } from "../../src/bindings/ExportEntryDto";
import type { ImportPreviewDto } from "../../src/bindings/ImportPreviewDto";
import type { ImportExecuteDto } from "../../src/bindings/ImportExecuteDto";
import type { ValidationReport } from "../../src/bindings/ValidationReport";
import type { HardRepairOutcome } from "../../src/bindings/HardRepairOutcome";
import type { ContextNotesPage } from "../../src/bindings/ContextNotesPage";
import type { NotesPage } from "../../src/bindings/NotesPage";
import type { NotesDeadlineRangePage } from "../../src/bindings/NotesDeadlineRangePage";
import type { EventsListRangeResponse } from "../../src/bindings/EventsListRangeResponse";
import type { NoteLinkList } from "../../src/bindings/NoteLinkList";

const BASE_SECONDS = Math.floor(Date.parse("2024-06-01T12:00:00Z") / 1000);

type HouseholdRecordRaw = {
  id: string;
  name: string;
  tz: string | null;
  color: string | null;
  is_default: boolean;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
};

type ScenarioData = {
  households: HouseholdRecordRaw[];
  activeHouseholdId: string;
  events: Event[];
  notes: Note[];
  noteLinks: NoteLink[];
  vehicles: Vehicle[];
  searchResults: SearchResult[];
  categories: Category[];
  backups: {
    manifest: BackupManifest;
    overview: BackupOverview;
    entries: BackupEntry[];
    exportEntry: ExportEntryDto;
  };
  imports: {
    preview: ImportPreviewDto;
    execute: ImportExecuteDto;
  };
  repair: {
    validation: ValidationReport;
    hard: HardRepairOutcome;
  };
};

type MutableScenarioState = ScenarioData & {
  cursor: number;
};

function cloneData(data: ScenarioData): MutableScenarioState {
  return {
    households: data.households.map((h) => ({ ...h })),
    activeHouseholdId: data.activeHouseholdId,
    events: data.events.map((e) => ({ ...e })),
    notes: data.notes.map((n) => ({ ...n })),
    noteLinks: data.noteLinks.map((l) => ({ ...l })),
    vehicles: data.vehicles.map((v) => ({ ...v })),
    searchResults: data.searchResults.map((r) => ({ ...r })),
    categories: data.categories.map((c) => ({ ...c })),
    backups: {
      manifest: { ...data.backups.manifest },
      overview: {
        ...data.backups.overview,
        backups: data.backups.overview.backups.map((b) => ({ ...b, manifest: { ...b.manifest } })),
      },
      entries: data.backups.entries.map((b) => ({ ...b, manifest: { ...b.manifest } })),
      exportEntry: { ...data.backups.exportEntry },
    },
    imports: {
      preview: { ...data.imports.preview },
      execute: { ...data.imports.execute },
    },
    repair: {
      validation: { ...data.repair.validation },
      hard: { ...data.repair.hard },
    },
    cursor: 0,
  };
}

function nextId(state: MutableScenarioState, prefix: string, rngValue: number): string {
  const serial = Math.floor(rngValue * 1_000_000)
    .toString(36)
    .padStart(4, "0");
  state.cursor += 1;
  return `${prefix}-${state.cursor}-${serial}`;
}

function toNotesPage(notes: Note[]): NotesPage {
  return { notes: notes.map((note) => ({ ...note })) };
}

function toContextNotesPage(notes: Note[], links: NoteLink[]): ContextNotesPage {
  return {
    notes: notes.map((note) => ({ ...note })),
    links: links.map((link) => ({ ...link })),
  };
}

function toDeadlineRangePage(notes: Note[]): NotesDeadlineRangePage {
  return { items: notes.map((note) => ({ ...note })) };
}

function toEventsResponse(events: Event[]): EventsListRangeResponse {
  return { items: events.map((event) => ({ ...event })), truncated: false, limit: 100 };
}

function placeholderNote(householdId: string): Note {
  return {
    id: `placeholder-note-${householdId}`,
    household_id: householdId,
    category_id: undefined,
    position: 0,
    created_at: BASE_SECONDS,
    updated_at: BASE_SECONDS,
    deleted_at: undefined,
    text: "",
    color: "#2563EB",
    x: 0,
    y: 0,
    z: undefined,
    deadline: undefined,
    deadline_tz: undefined,
  };
}

function toNoteLinkList(notes: Note[], links: NoteLink[]): NoteLinkList {
  return {
    items: links.map((link) => {
      const note = notes.find((n) => n.id === link.note_id) ?? placeholderNote(link.household_id);
      return { note: { ...note }, link: { ...link } } as NoteLinkList["items"][number];
    }),
  };
}

interface ScenarioConfig {
  name: string;
  description?: string;
  data: ScenarioData;
  metadata?: Record<string, unknown>;
}

export function createScenario(config: ScenarioConfig): ScenarioDefinition {
  const state = cloneData(config.data);

  const defaultCategoryForHousehold = (householdId: string): Category | null => {
    return (
      state.categories.find(
        (category) =>
          category.household_id === householdId &&
          (category.deleted_at === undefined || category.deleted_at === null),
      ) ?? null
    );
  };

  const makeNote = (data: Partial<Note> | undefined, ctx: ScenarioContext): Note => {
    const now = Math.floor(ctx.clock.now().getTime() / 1000);
    const source = data as Partial<Note> & { household_id?: string; categoryId?: string };
    const householdId =
      typeof source?.household_id === "string" && source.household_id.length > 0
        ? source.household_id
        : typeof (source as Record<string, unknown>)?.householdId === "string"
          ? ((source as Record<string, unknown>).householdId as string)
          : state.activeHouseholdId;
    const explicitCategory =
      typeof source?.category_id === "string" && source.category_id.length > 0
        ? source.category_id
        : typeof source?.categoryId === "string" && source.categoryId.length > 0
          ? source.categoryId
          : undefined;
    const categoryId = explicitCategory ?? defaultCategoryForHousehold(householdId)?.id;
    const note: Note = {
      id: nextId(state, "note", ctx.rng.next()),
      household_id: householdId,
      category_id: categoryId,
      position: typeof data?.position === "number" ? data.position : state.notes.length,
      created_at: now,
      updated_at: now,
      deleted_at: undefined,
      text: typeof data?.text === "string" ? data.text : "",
      color: typeof data?.color === "string" ? data.color : "#2563EB",
      x: typeof data?.x === "number" ? data.x : 0,
      y: typeof data?.y === "number" ? data.y : 0,
      z: typeof data?.z === "number" ? data.z : undefined,
      deadline: data?.deadline,
      deadline_tz: data?.deadline_tz,
    };
    state.notes.push(note);
    return { ...note };
  };

  const makeLink = (
    note: Note,
    entityId: string,
    entityType: NoteLink["entity_type"],
    ctx: ScenarioContext,
  ): NoteLink => {
    const now = Math.floor(ctx.clock.now().getTime() / 1000);
    const link: NoteLink = {
      id: nextId(state, "note-link", ctx.rng.next()),
      household_id: note.household_id,
      note_id: note.id,
      entity_type: entityType,
      entity_id: entityId,
      relation: "related",
      created_at: now,
      updated_at: now,
    };
    state.noteLinks.push(link);
    return { ...link };
  };

  const handlers: ScenarioHandlers = {
    about_metadata: () => ({ version: "fake", commit: "0000000" }),
    attachment_open: () => null,
    attachment_reveal: () => null,
    bills_list_due_between: () => [],
    db_backup_create: (_, ctx) => {
      const now = ctx.clock.now().toISOString();
      const entry: BackupEntry = {
        directory: `/tmp/backups/${now}`,
        sqlitePath: `/tmp/backups/${now}/app.db`,
        manifestPath: `/tmp/backups/${now}/manifest.json`,
        manifest: { ...state.backups.manifest, createdAt: now },
        totalSizeBytes: 1024,
      };
      state.backups.entries.push(entry);
      state.backups.overview.backups.push(entry);
      return entry;
    },
    db_backup_overview: () => ({
      ...state.backups.overview,
      backups: state.backups.overview.backups.map((b) => ({ ...b, manifest: { ...b.manifest } })),
    }),
    db_backup_reveal: () => null,
    db_backup_reveal_root: () => null,
    db_export_run: () => ({ ...state.backups.exportEntry }),
    db_files_index_ready: () => true,
    db_hard_repair_run: () => ({ ...state.repair.hard }),
    db_has_pet_columns: () => false,
    db_has_vehicle_columns: () => true,
    db_import_execute: () => ({ ...state.imports.execute }),
    db_import_preview: () => ({ ...state.imports.preview }),
    db_repair_run: () => ({ ...state.repair.validation }),
    db_table_exists: (payload) => {
      const name = (payload as { name?: string; args?: { name?: string } }).name ?? (payload as any)?.args?.name;
      return name ? ["events", "notes", "vehicles"].includes(name) : false;
    },
    diagnostics_doc_path: () => "/tmp/diagnostics.md",
    diagnostics_household_stats: () => ({ households: state.households.length }),
    diagnostics_summary: () => ({ ok: true }),
    events_backfill_timezone: () => ({ started: true }),
    events_backfill_timezone_cancel: () => null,
    events_backfill_timezone_status: () => ({ status: "idle" }),
    events_list_range: (payload) => {
      const args = payload as { start?: number; end?: number; householdId?: string };
      const start = args.start ?? BASE_SECONDS - 86_400;
      const end = args.end ?? BASE_SECONDS + 86_400;
      const householdId = args.householdId ?? state.activeHouseholdId;
      const items = state.events.filter(
        (event) =>
          event.household_id === householdId &&
          (event.deleted_at === undefined || event.deleted_at === null) &&
          event.start_at_utc >= start &&
          event.start_at_utc <= end,
      );
      return toEventsResponse(items);
    },
    event_create: (payload, ctx) => {
      const id = nextId(state, "event", ctx.rng.next());
      const args = (payload as { data?: Partial<Event> }).data ?? (payload as any);
      const now = Math.floor(ctx.clock.now().getTime() / 1000);
      const event: Event = {
        id,
        household_id: args?.household_id ?? state.activeHouseholdId,
        title: args?.title ?? "New event",
        tz: args?.tz ?? "UTC",
        start_at_utc: args?.start_at_utc ?? now,
        end_at_utc: args?.end_at_utc ?? now + 3600,
        rrule: args?.rrule,
        exdates: args?.exdates,
        reminder: args?.reminder,
        created_at: now,
        updated_at: now,
        deleted_at: undefined,
        series_parent_id: args?.series_parent_id,
      };
      state.events.push(event);
      return { ...event };
    },
    event_update: (payload, ctx) => {
      const args = (payload as { id?: string; householdId?: string; data?: Partial<Event> });
      const id = args.id ?? (payload as any)?.args?.id;
      const data = args.data ?? (payload as any)?.args?.data ?? {};
      const event = state.events.find((e) => e.id === id);
      if (event) {
        Object.assign(event, data);
        event.updated_at = Math.floor(ctx.clock.now().getTime() / 1000);
      }
      return null;
    },
    event_delete: (payload, ctx) => {
      const id = (payload as { id?: string }).id ?? (payload as any)?.args?.id;
      const event = state.events.find((e) => e.id === id);
      if (event) {
        event.deleted_at = Math.floor(ctx.clock.now().getTime() / 1000);
      }
      return null;
    },
    event_restore: (payload) => {
      const id = (payload as { id?: string }).id ?? (payload as any)?.args?.id;
      const event = state.events.find((e) => e.id === id);
      if (event) {
        event.deleted_at = undefined;
      }
      return null;
    },
    household_list: (payload) => {
      const includeDeleted = Boolean((payload as { includeDeleted?: boolean }).includeDeleted);
      return state.households
        .filter((household) => includeDeleted || household.deleted_at === null)
        .map((household) => ({ ...household }));
    },
    household_get_active: () => state.activeHouseholdId,
    household_get: (payload) => {
      const id = (payload as { id?: string }).id ?? (payload as any)?.args?.id;
      const record = state.households.find((h) => h.id === id);
      return record ? { ...record } : null;
    },
    household_create: (payload, ctx) => {
      const args = (payload as { args?: Record<string, unknown> }).args ?? (payload as any);
      const id = nextId(state, "household", ctx.rng.next());
      const now = Math.floor(ctx.clock.now().getTime() / 1000);
      const record: HouseholdRecordRaw = {
        id,
        name: typeof args?.name === "string" ? (args.name as string) : `Household ${state.households.length + 1}`,
        tz: (args?.tz as string) ?? null,
        color: (args?.color as string) ?? null,
        is_default: false,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      };
      state.households.push(record);
      return { ...record };
    },
    household_update: (payload, ctx) => {
      const args = (payload as { args?: Record<string, unknown>; id?: string; data?: Record<string, unknown> });
      const source = args.args ?? args.data ?? (payload as any);
      const id = (args.id as string) ?? (source?.id as string);
      const record = state.households.find((h) => h.id === id);
      if (record) {
        if (typeof source?.name === "string") {
          record.name = source.name as string;
        }
        if (Object.prototype.hasOwnProperty.call(source ?? {}, "color")) {
          record.color = (source?.color as string | null) ?? null;
        }
        record.updated_at = Math.floor(ctx.clock.now().getTime() / 1000);
      }
      return record ? { ...record } : null;
    },
    household_delete: (payload, ctx) => {
      const id = (payload as { id?: string }).id ?? (payload as any)?.args?.id ?? state.activeHouseholdId;
      const record = state.households.find((h) => h.id === id);
      if (record) {
        record.deleted_at = Math.floor(ctx.clock.now().getTime() / 1000);
      }
      const fallback = state.households.find((h) => h.id !== id && h.deleted_at === null);
      if (state.activeHouseholdId === id && fallback) {
        state.activeHouseholdId = fallback.id;
      }
      return { fallbackId: fallback ? fallback.id : null };
    },
    household_restore: (payload) => {
      const id = (payload as { id?: string }).id ?? (payload as any)?.args?.id;
      const record = state.households.find((h) => h.id === id);
      if (record) {
        record.deleted_at = null;
      }
      return record ? { ...record } : null;
    },
    household_set_active: (payload) => {
      const id = (payload as { id?: string }).id ?? (payload as any)?.args?.id;
      if (typeof id === "string") {
        state.activeHouseholdId = id;
      }
      return null;
    },
    import_run_legacy: () => ({ ok: true }),
    notes_list_cursor: () => toNotesPage(state.notes),
    notes_list_by_deadline_range: () => toDeadlineRangePage(state.notes.filter((note) => note.deadline !== undefined)),
    notes_list_for_entity: (payload) => {
      const entityId = (payload as { entityId?: string }).entityId ?? (payload as any)?.args?.entityId;
      const links = state.noteLinks.filter((link) => link.entity_id === entityId);
      const notes = state.notes.filter((note) => links.some((link) => link.note_id === note.id));
      return toContextNotesPage(notes, links);
    },
    categories_list: (payload) => {
      const args = (payload as { args?: Record<string, unknown> }).args ?? (payload as Record<string, unknown>);
      const householdId =
        (typeof (payload as Record<string, unknown>)?.householdId === "string"
          ? (payload as Record<string, unknown>).householdId
          : undefined) ??
        (typeof (payload as Record<string, unknown>)?.household_id === "string"
          ? (payload as Record<string, unknown>).household_id
          : undefined) ??
        (typeof args?.householdId === "string"
          ? (args.householdId as string)
          : typeof args?.household_id === "string"
            ? (args.household_id as string)
            : state.activeHouseholdId);
      const includeHidden = Boolean(
        (args?.includeHidden as boolean | undefined) ??
          (args?.include_hidden as boolean | undefined) ??
          (payload as Record<string, unknown>)?.includeHidden ??
          (payload as Record<string, unknown>)?.include_hidden ??
          false,
      );
      return state.categories
        .filter((category) => {
          if (category.household_id !== householdId) return false;
          if (includeHidden) return true;
          return category.deleted_at === undefined || category.deleted_at === null;
        })
        .map((category) => ({ ...category }));
    },
    notes_quick_create_for_entity: (payload, ctx) => {
      const args = (payload as { args?: Record<string, unknown> }).args ?? (payload as Record<string, unknown>);
      const householdId =
        (typeof (payload as Record<string, unknown>)?.householdId === "string"
          ? (payload as Record<string, unknown>).householdId
          : undefined) ??
        (typeof (payload as Record<string, unknown>)?.household_id === "string"
          ? (payload as Record<string, unknown>).household_id
          : undefined) ??
        (typeof args?.householdId === "string"
          ? (args.householdId as string)
          : typeof args?.household_id === "string"
            ? (args.household_id as string)
            : state.activeHouseholdId);
      const entityId =
        (typeof (payload as Record<string, unknown>)?.entityId === "string"
          ? (payload as Record<string, unknown>).entityId
          : undefined) ??
        (typeof (payload as Record<string, unknown>)?.entity_id === "string"
          ? (payload as Record<string, unknown>).entity_id
          : undefined) ??
        (typeof args?.entityId === "string"
          ? (args.entityId as string)
          : typeof args?.entity_id === "string"
            ? (args.entity_id as string)
            : state.events[0]?.id ?? "event-0");
      const entityType =
        ((typeof (payload as Record<string, unknown>)?.entityType === "string"
          ? (payload as Record<string, unknown>).entityType
          : undefined) ??
          (typeof (payload as Record<string, unknown>)?.entity_type === "string"
            ? (payload as Record<string, unknown>).entity_type
            : undefined) ??
          (typeof args?.entityType === "string"
            ? (args.entityType as string)
            : typeof args?.entity_type === "string"
              ? (args.entity_type as string)
              : "Event")) as NoteLink["entity_type"];
      const categoryId =
        (typeof (payload as Record<string, unknown>)?.categoryId === "string"
          ? (payload as Record<string, unknown>).categoryId
          : undefined) ??
        (typeof (payload as Record<string, unknown>)?.category_id === "string"
          ? (payload as Record<string, unknown>).category_id
          : undefined) ??
        (typeof args?.categoryId === "string"
          ? (args.categoryId as string)
          : typeof args?.category_id === "string"
            ? (args.category_id as string)
            : defaultCategoryForHousehold(householdId)?.id);
      const text =
        (typeof (payload as Record<string, unknown>)?.text === "string"
          ? (payload as Record<string, unknown>).text
          : undefined) ?? (typeof args?.text === "string" ? (args.text as string) : "");
      const color =
        (typeof (payload as Record<string, unknown>)?.color === "string"
          ? (payload as Record<string, unknown>).color
          : undefined) ?? (typeof args?.color === "string" ? (args.color as string) : undefined);

      const note = makeNote(
        {
          household_id: householdId,
          category_id: categoryId ?? undefined,
          text,
          color,
        },
        ctx,
      );
      const link = makeLink(note, entityId, entityType, ctx);
      return toContextNotesPage([note], [link]);
    },
    notes_create: (payload, ctx) => {
      const args = (payload as { data?: Partial<Note> }).data ?? (payload as any);
      return makeNote(args, ctx);
    },
    notes_update: (payload, ctx) => {
      const args = (payload as { id?: string; data?: Partial<Note> });
      const id = args.id ?? (payload as any)?.args?.id;
      const data = args.data ?? (payload as any)?.args?.data ?? {};
      const note = state.notes.find((n) => n.id === id);
      if (note) {
        Object.assign(note, data);
        note.updated_at = Math.floor(ctx.clock.now().getTime() / 1000);
      }
      return null;
    },
    notes_delete: (payload, ctx) => {
      const id = (payload as { id?: string }).id ?? (payload as any)?.args?.id;
      const note = state.notes.find((n) => n.id === id);
      if (note) {
        note.deleted_at = Math.floor(ctx.clock.now().getTime() / 1000);
      }
      return null;
    },
    notes_restore: (payload) => {
      const id = (payload as { id?: string }).id ?? (payload as any)?.args?.id;
      const note = state.notes.find((n) => n.id === id);
      if (note) {
        note.deleted_at = undefined;
        return { ...note };
      }
      return null;
    },
    note_links_create: (payload, ctx) => {
      const args = (payload as { data?: Partial<NoteLink> }).data ?? (payload as any);
      const now = Math.floor(ctx.clock.now().getTime() / 1000);
      const link: NoteLink = {
        id: nextId(state, "note-link", ctx.rng.next()),
        household_id: args?.household_id ?? state.activeHouseholdId,
        note_id: (args?.note_id as string) ?? state.notes[0]?.id ?? "note-0",
        entity_type: (args?.entity_type as NoteLink["entity_type"]) ?? "Event",
        entity_id: (args?.entity_id as string) ?? state.events[0]?.id ?? "event-0",
        relation: (args?.relation as string) ?? "related",
        created_at: now,
        updated_at: now,
      };
      state.noteLinks.push(link);
      return { ...link };
    },
    note_links_list_by_entity: (payload) => {
      const entityId = (payload as { entityId?: string }).entityId ?? (payload as any)?.args?.entityId;
      const links = state.noteLinks.filter((link) => link.entity_id === entityId);
      const notes = state.notes.filter((note) => links.some((link) => link.note_id === note.id));
      return toNoteLinkList(notes, links);
    },
    note_links_unlink_entity: (payload) => {
      const entityId = (payload as { entityId?: string }).entityId ?? (payload as any)?.args?.entityId;
      state.noteLinks = state.noteLinks.filter((link) => link.entity_id !== entityId);
      return null;
    },
    note_links_get_for_note: (payload) => {
      const noteId = (payload as { noteId?: string }).noteId ?? (payload as any)?.args?.noteId;
      const links = state.noteLinks.filter((link) => link.note_id === noteId);
      const notes = state.notes.filter((note) => note.id === noteId);
      return toNoteLinkList(notes, links);
    },
    note_links_delete: (payload) => {
      const id = (payload as { id?: string }).id ?? (payload as any)?.args?.id;
      state.noteLinks = state.noteLinks.filter((link) => link.id !== id);
      return null;
    },
    open_diagnostics_doc: () => null,
    open_path: () => null,
    search_entities: () => state.searchResults.map((result) => ({ ...result })),
    vehicles_list: (payload) => {
      const householdId = (payload as { householdId?: string }).householdId ?? state.activeHouseholdId;
      return state.vehicles.filter((vehicle) => vehicle.household_id === householdId).map((vehicle) => ({ ...vehicle }));
    },
    vehicles_get: (payload) => {
      const id = (payload as { id?: string }).id ?? (payload as any)?.args?.id;
      const householdId = (payload as { householdId?: string }).householdId ?? state.activeHouseholdId;
      const vehicle = state.vehicles.find((v) => v.id === id && v.household_id === householdId);
      return vehicle ? { ...vehicle } : null;
    },
    vehicles_create: (payload, ctx) => {
      const args = (payload as { data?: Partial<Vehicle> }).data ?? (payload as any);
      const now = Math.floor(ctx.clock.now().getTime() / 1000);
      const vehicle: Vehicle = {
        id: nextId(state, "vehicle", ctx.rng.next()),
        household_id: args?.household_id as string ?? state.activeHouseholdId,
        name: (args?.name as string) ?? "Vehicle",
        make: (args?.make as string) ?? "",
        model: (args?.model as string) ?? "",
        reg: (args?.reg as string) ?? "",
        vin: args?.vin as string | undefined,
        next_mot_due: args?.next_mot_due as number | undefined,
        next_service_due: args?.next_service_due as number | undefined,
        created_at: now,
        updated_at: now,
        deleted_at: undefined,
        position: typeof args?.position === "number" ? (args.position as number) : state.vehicles.length,
      };
      state.vehicles.push(vehicle);
      return { ...vehicle };
    },
    vehicles_update: (payload, ctx) => {
      const args = (payload as { id?: string; data?: Partial<Vehicle> });
      const id = args.id ?? (payload as any)?.args?.id;
      const data = args.data ?? (payload as any)?.args?.data ?? {};
      const vehicle = state.vehicles.find((v) => v.id === id);
      if (vehicle) {
        Object.assign(vehicle, data);
        vehicle.updated_at = Math.floor(ctx.clock.now().getTime() / 1000);
      }
      return null;
    },
    vehicles_delete: (payload, ctx) => {
      const id = (payload as { id?: string }).id ?? (payload as any)?.args?.id;
      const vehicle = state.vehicles.find((v) => v.id === id);
      if (vehicle) {
        vehicle.deleted_at = Math.floor(ctx.clock.now().getTime() / 1000);
      }
      return null;
    },
    vehicles_restore: (payload) => {
      const id = (payload as { id?: string }).id ?? (payload as any)?.args?.id;
      const vehicle = state.vehicles.find((v) => v.id === id);
      if (vehicle) {
        vehicle.deleted_at = undefined;
      }
      return null;
    },
  } satisfies ScenarioHandlers;

  return {
    name: config.name,
    description: config.description,
    handlers,
    metadata: config.metadata,
  };
}

export type { ScenarioData };
