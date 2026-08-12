/** PassCreator adapter config. Source (env var vs stored per-org setting) is decided in a later PR. */
export interface PassCreatorConfig {
  apiKey: string;
  templateId: string;
  /** Defaults to the confirmed live API host. */
  baseUrl?: string;
  /** PassCreator field key -> Admitto placeholder token (see passcreator-mapper.ts). Empty/unset
   * keeps the default 5-field mapping (name, eventDate, eventHours, eventPlace, ticketType). */
  fieldMapping?: Record<string, string>;
}

export const PASSCREATOR_DEFAULT_BASE_URL = "https://app.passcreator.com";
