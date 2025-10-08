import { FilesView } from "../../FilesView";
import { wrapLegacyView } from "./wrapLegacyView";

export const mountFilesView = wrapLegacyView(FilesView);
