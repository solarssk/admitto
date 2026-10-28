import { useCallback, useRef } from "react";
import { fetchLegalDocuments } from "../api/client.js";
import { fetchAttendeeCustomFields, type CustomDataFieldDef } from "../attendees/customData.js";

/** What a request's answers and consents are named by: the questions of the event, and the titles of its extra consents. */
export interface RequestLookups {
  fields: CustomDataFieldDef[];
  /** The title of each extra consent, by the key a request stored it under. */
  consentTitles: ReadonlyMap<string, string>;
}

/** Reads both, and says whether both came: a name that could not be read falls back to the key of the answer, and is read again at the next opening. */
async function readLookups(eventId: string): Promise<{ lookups: RequestLookups; complete: boolean }> {
  const [fields, documents] = await Promise.allSettled([fetchAttendeeCustomFields(eventId), fetchLegalDocuments(eventId)]);
  const titles = documents.status === "fulfilled" ? documents.value.items.flatMap((doc) => (doc.key ? [[doc.key, doc.title] as const] : [])) : [];
  return {
    lookups: { fields: fields.status === "fulfilled" ? fields.value : [], consentTitles: new Map(titles) },
    complete: fields.status === "fulfilled" && documents.status === "fulfilled",
  };
}

/**
 * The names behind a request's answers, read once for the tab and shared by every request that is opened (a reviewer who works through
 * the queue opens one after the other, and the questions of the event do not change under them). They are an extra: when they cannot
 * be read, the request still opens, with the key of each answer in place of its question, and the next opening tries again.
 */
export function useRequestLookups(eventId: string): () => Promise<RequestLookups> {
  const cache = useRef<Promise<RequestLookups> | null>(null);
  return useCallback(() => {
    if (cache.current) return cache.current;
    const reading = readLookups(eventId).then(({ lookups, complete }) => {
      if (!complete) cache.current = null;
      return lookups;
    });
    cache.current = reading;
    return reading;
  }, [eventId]);
}
