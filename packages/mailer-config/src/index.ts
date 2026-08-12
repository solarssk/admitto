export { rawMailFieldsFromEnv } from "./envFields.js";
export { setMailSettings, mergeMailSettingsRow } from "./mailSettings.js";
export {
  resolveMailConfig,
  resolveMailConfigForOrg,
  tryParseOrgMailConfigFromRow,
  tryParseEventMailConfigFromRow,
  MailConfigError,
} from "./resolver.js";
export type { MailConfigErrorCode } from "./resolver.js";
export { describeMailConfig, describeMailConfigForOrg, describeMailConfigForOrgWizard } from "./describer.js";
export { validateOrgMailSettingsUpdate, validateEventMailSettingsUpdate } from "./validateOrgUpdate.js";
export type {
  MailScope,
  MailSettingsInput,
  RawMailFields,
  FieldSource,
  FieldDescriptor,
  ConfigDescriptor,
} from "./types.js";
