export { rawMailFieldsFromEnv } from "./envFields.js";
export { setMailSettings } from "./mailSettings.js";
export { resolveMailConfig, resolveMailConfigForOrg } from "./resolver.js";
export { describeMailConfig, describeMailConfigForOrg } from "./describer.js";
export type {
  MailScope,
  MailSettingsInput,
  RawMailFields,
  FieldSource,
  FieldDescriptor,
  ConfigDescriptor,
} from "./types.js";
