// This file mirrors the NoteLinkList structs exported from the Rust backend.

import type { Note } from "./Note";
import type { NoteLink } from "./NoteLink";

export type NoteLinkListItem = { note: Note; link: NoteLink };

export type NoteLinkList = { items: NoteLinkListItem[] };
