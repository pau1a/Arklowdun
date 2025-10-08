import { NotesView } from "../../NotesView";
import { wrapLegacyView } from "./wrapLegacyView";

export const mountNotesView = wrapLegacyView(NotesView);
