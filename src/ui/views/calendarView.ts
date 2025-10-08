import { CalendarView } from "../../CalendarView";
import { wrapLegacyView } from "./wrapLegacyView";

export const mountCalendarView = wrapLegacyView(CalendarView);
