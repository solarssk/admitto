import type { EventType } from "../api/types.js";

export type EventTypeOption = { value: EventType; label: string; icon: string };

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  generic: "Generic",
  live_performance: "Live performance",
  movie: "Movie",
  sports: "Sports",
  conference: "Conference",
  convention: "Convention",
  workshop: "Workshop",
  social_gathering: "Social gathering",
};

/** Tabler icon name (without the `ti-` prefix) shown next to each option in the Event type
 * picker - same icon+label pattern as the Wallet tab's field mapping "Value" dropdown. */
const EVENT_TYPE_ICONS: Record<EventType, string> = {
  generic: "category",
  live_performance: "microphone",
  movie: "movie",
  sports: "ball-football",
  conference: "presentation",
  convention: "users-group",
  workshop: "tool",
  social_gathering: "confetti",
};

export function buildEventTypeOptions(): EventTypeOption[] {
  return (Object.keys(EVENT_TYPE_LABELS) as EventType[]).map((value) => ({
    value,
    label: EVENT_TYPE_LABELS[value],
    icon: EVENT_TYPE_ICONS[value],
  }));
}
