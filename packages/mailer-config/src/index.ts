export { rawMailFieldsFromEnv } from "./envFields.js";
export { setMailSettings, mergeOrgMailSettingsRow } from "./mailSettings.js";
export { resolveMailConfig, resolveMailConfigForOrg, tryParseOrgMailConfigFromRow } from "./resolver.js";
export { describeMailConfig, describeMailConfigForOrg, describeMailConfigForOrgWizard } from "./describer.js";
export { validateOrgMailSettingsUpdate } from "./validateOrgUpdate.js";
export type {
  MailScope,
  MailSettingsInput,
  RawMailFields,
  FieldSource,
  FieldDescriptor,
  ConfigDescriptor,
} from "./types.js";
