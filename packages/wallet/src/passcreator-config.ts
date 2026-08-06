/** PassCreator adapter config. Source (env var vs stored per-org setting) is decided in a later PR. */
export interface PassCreatorConfig {
  apiKey: string;
  templateId: string;
  /** Defaults to the confirmed live API host. */
  baseUrl?: string;
}

export const PASSCREATOR_DEFAULT_BASE_URL = "https://app.passcreator.com";
