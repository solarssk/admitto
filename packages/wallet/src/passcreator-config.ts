/** PassCreator adapter config, sourced from the event's own stored API key/template/field mapping
 * (Event Settings -> Wallet), not an env var or org-level setting. */
export interface PassCreatorConfig {
  apiKey: string;
  templateId: string;
  /** Defaults to the confirmed live API host. */
  baseUrl?: string;
  /** PassCreator field key -> Admitto placeholder token (see passcreator-mapper.ts). No default
   * mapping - empty/unset sends nothing beyond the base fields (templateId, userProvidedId,
   * enforceUniqueUserProvidedId, barcodeValue). */
  fieldMapping?: Record<string, string>;
}

export const PASSCREATOR_DEFAULT_BASE_URL = "https://app.passcreator.com";
