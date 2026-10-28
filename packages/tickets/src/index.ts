export { generateToken } from "./token.js";
export { hashToken } from "./hash.js";
export { buildTicketUrl, extractTokenFromUrl, looksLikeInternalToken } from "./url.js";
export { generateQrPng, buildQrPayload } from "./qr.js";
export {
  resolveTicket,
  resolveTicketLogoUrl,
  toResolved,
  parseTicketAddressComponents,
  parseWalletFieldMapping,
} from "./resolve.js";
export { issueTicket, issueTicketsForEvent } from "./issue.js";
export { isAttendeeGone, lockAttendeeRow, lockAttendeesForUpdate, lockLiveAttendees } from "./attendee-lock.js";
export {
  MAX_COMPANION_SLOTS,
  readRegistrationCompanions,
  removeAttendeeCompanion,
  writeAttendeeCompanion,
} from "./attendee-companion.js";
export type {
  AttendeeCompanionRemoveResult,
  AttendeeCompanionTarget,
  AttendeeCompanionWriteResult,
  RegistrationCompanion,
  WriteAttendeeCompanionParams,
} from "./attendee-companion.js";
export { attendeeIsLive, keepLiveRows } from "./lock-check.js";
export type { LockedAttendee } from "./attendee-lock.js";
export {
  ERASED_ATTENDEE_NAME,
  ERASED_COMPANION_NAME,
  ERASED_EMAIL_DOMAIN,
  ERASE_TRANSACTION_TIMEOUT_MS,
  erasedAttendeeEmail,
  eraseAttendees,
  isErasedPlaceholderEmail,
} from "./erase-attendees.js";
export { scrubImportJobResults } from "./erase-job-results.js";
export { scrubAttendeeTraces } from "./attendee-traces.js";
export {
  EXPORT_STOPPED_BY_ERASURE_ERROR,
  IMPORT_STOPPED_BY_ERASURE_ERROR,
  attendeeJobIdsWithFiles,
  createUnderAttendeeJobQueueLock,
  lockAttendeeJobQueue,
  lockOpenAttendeeJobs,
  stopOpenAttendeeJobs,
} from "./stop-open-jobs.js";
export { removeAttendees } from "./remove-attendees.js";
export { lockRegistrationQueue, lockRegistrationsForUpdate, tryLockRegistrationQueue } from "./registration-lock.js";
export type { LockedRegistration } from "./registration-lock.js";
export type {
  RemoveAttendeesParams,
  RemoveAttendeesResult,
  RemoveUntrackedWalletTarget,
  RemoveWalletTarget,
} from "./remove-attendees.js";
export {
  CREATION_SETTLE_WINDOW_MS,
  PASS_ROW_STILL_AT_PROVIDER,
  SETTLED_RECHECK_HORIZON_MS,
  deleteErasedWalletPasses,
  deletePassesUnder,
  erasedPassToDeleteWhere,
  passIsStillToDelete,
  recheckSettledWalletPasses,
  reservedPassId,
  settledUntrackedPassRow,
} from "./erase-wallet-passes.js";
export type { EraseWalletPassesResult, RecheckSettledWalletPassesResult } from "./erase-wallet-passes.js";
export type {
  EraseAttendeesParams,
  EraseAttendeesResult,
  EraseWalletTarget,
} from "./erase-attendees.js";
export { checkInScan, getRecentCheckIns, isAdmittable } from "./checkin.js";
export { ADMITTABLE_STATUS_LIST } from "./admittable.js";
export { admitAttendee, shouldRequireConfirmOnScan } from "./admit.js";
export { lookupAttendees, getAttendeeCard, getCheckInStats } from "./attendee-card.js";
export {
  ensureAttendeeItemStates,
  transitionItemState,
  revokeItemState,
  IllegalItemTransitionError,
  REVOCABLE_ITEM_STATES,
} from "./item-states.js";
export {
  revokeAllCheckInsForEvent,
  revokeAllItemsForEvent,
  revokeItemsForAttendees,
} from "./bulk-revoke.js";
export {
  addAttendeeNote,
  updateAttendeeNote,
  deleteAttendeeNote,
  NoteTooLongError,
  OperatorRequiredError,
  AttendeeNotFoundError,
  NoteNotFoundError,
  NoteForbiddenError,
  MAX_ATTENDEE_NOTE_LENGTH,
} from "./notes.js";
export {
  undoLastCheckIn,
  revokeCheckIn,
  revokeCheckInTx,
  revokeCheckInMutation,
  UndoNotAllowedError,
} from "./undo.js";
export { parseCustomData, customDataValue } from "./custom-data.js";
export {
  resolveWalletCustomFieldPlaceholders,
  WALLET_CUSTOM_FIELD_PLACEHOLDER_PREFIX,
} from "./wallet-custom-fields.js";
export { buildItemDetail } from "./event-item-contents.js";
export {
  eventCustomFieldOrderBy,
  loadEventCustomDataFields,
  loadRegistrantFormFields,
  validateContentFieldReferences,
  UnknownContentFieldError,
  findConflictingContentField,
  assertContentFieldsNotAssignedElsewhere,
  ContentFieldAlreadyAssignedError,
} from "./event-custom-fields.js";
export {
  buildCustomDataFromInput,
  keepShownAnswers,
  normalizeCustomDataFieldValue,
  validateCustomDataPatch,
  assertCustomDataMeetsRequirements,
} from "./validate-custom-data.js";
export {
  eventCustomFieldRulesFitType,
  eventCustomFieldRulesSchema,
  hasNoRules,
  readStoredFieldRules,
} from "./custom-field-rules.js";
// The checks of conditions between fields live in @admitto/shared, so that the admin app's field editor asks the very same ones.
export { controlsOtherFields, findShowWhenProblem } from "@admitto/shared";
export type { ConditionField, ShowWhenProblem } from "@admitto/shared";
export {
  MAX_CUSTOM_FIELDS_PER_EVENT,
  REGISTRANT_EMAIL_MAX,
  REGISTRANT_LONG_TEXT_MAX,
  REGISTRANT_NAME_MAX,
  REGISTRANT_TEXT_MAX,
  RegistrantInputError,
  buildRegistrantCustomData,
  normalizeRegistrantLongText,
  normalizeRegistrantText,
  pickRegistrantFormFields,
  pickRegistrantProfileFields,
  registrantEmailSchema,
  registrantNameSchema,
  registrantRawLimit,
  registrantTextSchema,
} from "./registrant-input.js";
export type { RegistrantFormField, RegistrantProfileFields } from "./registrant-input.js";
export {
  MAX_REGISTRATION_BULK_IDS,
  REGISTRATION_AGE_FILTERS,
  REGISTRATION_SEARCH_MAX_LENGTH,
  REGISTRATION_SEARCH_MAX_WORDS,
  canRetryRegistrationMail,
  isRegistrationAgeFilter,
  isRegistrationStatus,
  parseRegistrationFilter,
  parseRegistrationSearch,
  registrationAgeCutoff,
  registrationListWhere,
} from "./registration-list.js";
export type {
  RegistrationAgeFilter,
  RegistrationFilterField,
  RegistrationFilterInput,
  RegistrationFilterResult,
  RegistrationListFilter,
} from "./registration-list.js";
export { isEmptyRegistrationFilter, registrationSelectionDigest } from "./registration-selection.js";
export { deleteRegistrations } from "./registration-deletion.js";
export type {
  DeleteRegistrationsParams,
  DeleteRegistrationsResult,
  DeleteRegistrationsTarget,
  DeletedRegistration,
} from "./registration-deletion.js";
export {
  RESERVED_CUSTOM_DATA_SOURCE_FIELDS,
  isReservedCustomDataSourceField,
  filterCustomDataAttributeFields,
} from "./custom-data-reserved.js";
export {
  BADGE_ITEM_KEY,
  COMPANION_ITEM_KEY,
  ensureBadgeEventItem,
  ensureCompanionEventItem,
  isBadgeItemUsable,
} from "./event-items.js";
export {
  attendeeIdsWithCompanion,
  EVENT_ITEM_AUDIENCES,
  filterItemsForAttendee,
  isCompanionAudience,
  itemAppliesToAttendee,
} from "./item-audience.js";
export type { EventItemAudience } from "./item-audience.js";
export {
  ensureStandardTicketType,
  loadEventTicketTypes,
  acquireEventTicketTypesLock,
  assertTicketTypeInCatalog,
  UnknownTicketTypeError,
  TICKET_TYPE_COLOR_KEYS,
  STANDARD_TICKET_TYPE_KEY,
  slugifyTicketTypeKey,
  uniqueTicketTypeKey,
} from "./ticket-types.js";
export type { TicketTypeInfo, TicketTypeColor } from "./ticket-types.js";
export { parseEventOpsConfig, loadEventOpsConfig } from "./ops-config.js";
export { writeActionLog, writeActionLogMany, writeBulkActionLog } from "./ops-audit.js";
export { writeAdminAuditLog, writeAdminAuditLogBestEffort } from "./admin-audit.js";
export {
  ATTENDEE_EXPORT_RSVP_STATUSES,
  ATTENDEE_MAIL_STATUS_FILTERS,
  ATTENDEE_SORT_COLUMNS,
  EXPORT_ROW_CAP,
  buildAttendeeListWhere,
  countFilteredAttendees,
  findFilteredAttendeesForExport,
  findFilteredAttendeesForList,
  findSelectedAttendeesForExport,
} from "./attendees-list-filters.js";
export {
  EXPORT_BASE_COLUMNS,
  AttendeeExportTooLargeError,
  buildSanitizedExportRows,
  buildExportColumns,
  buildExportColumnLabels,
  buildExportCsv,
  exportAttendeesCsv,
} from "./attendees-export.js";
export type { SanitizedExportRow, ExportAttendeesCsvResult } from "./attendees-export.js";
export {
  PDF_A4_PRINTABLE_WIDTH,
  PDF_A3_PRINTABLE_WIDTH,
  PDF_MIN_COLUMN_WIDTH,
  PDF_MIN_ROW_HEIGHT,
  measurePdfColumnMetrics,
  resolvePdfPageSize,
  distributePdfColumnWidths,
  buildExportPdfBuffer,
} from "./attendees-export-pdf.js";
export type {
  PdfColumnMetrics,
  PdfColumnWidthPlan,
  PdfPageSize,
} from "./attendees-export-pdf.js";
export { buildExportXlsxBuffer } from "./attendees-export-xlsx.js";
export {
  buildAttendeesExportArtifact,
} from "./attendees-export-artifact.js";
export type {
  AttendeesExportArtifact,
  AttendeesExportFormat,
} from "./attendees-export-artifact.js";
export { claimNextAdminJob } from "./claim-admin-job.js";
export { drainExportJobs } from "./drain-export-jobs.js";
export type { DrainExportJobsResult, ExportJobStorage } from "./drain-export-jobs.js";
export { resolveTicketPageDisplay, buildWalletPassInput, walletUserProvidedId } from "./wallet-pass-input.js";
export { formatDate, formatDateShort, formatEventHour, formatEventHoursRange } from "@admitto/shared/region-date-format";
export { reissueOneWalletPass } from "./reissue-wallet-pass.js";
export {
  removeOneWalletPassFromProvider,
  type RemoveWalletPassOutcome,
} from "./remove-wallet-pass-from-provider.js";
export { resolveEventWalletProvider } from "./resolve-event-wallet-provider.js";
export { drainWalletPushJobs, readWalletPushRequest } from "./drain-wallet-push-jobs.js";
export type { DrainWalletPushJobsResult, WalletPushRequest } from "./drain-wallet-push-jobs.js";
export { keepLiveWalletMessageTargets, loadWalletMessageTargets } from "./send-wallet-message.js";
export type { SendWalletMessageTarget } from "./send-wallet-message.js";
export { drainWalletMessageJobs } from "./drain-wallet-message-jobs.js";
export type { DrainWalletMessageJobsResult } from "./drain-wallet-message-jobs.js";
export { drainWalletRefreshStatusJobs } from "./drain-wallet-refresh-status-jobs.js";
export type { DrainWalletRefreshStatusJobsResult } from "./drain-wallet-refresh-status-jobs.js";
export {
  countPendingGraceInactivePasses,
  drainWalletCleanupJobs,
  WALLET_CLEANUP_JOB_TYPES,
  WALLET_REMOVE_INACTIVE_GRACE_MS,
} from "./drain-wallet-cleanup-jobs.js";
export type { DrainWalletCleanupJobsResult, WalletCleanupJobType } from "./drain-wallet-cleanup-jobs.js";
export { voidOneWalletPassAtProvider } from "./void-wallet-pass-at-provider.js";
export { refreshWalletPassStatusUnlessErased } from "./refresh-wallet-pass-status.js";
export type { LiveWalletStatusRefreshOutcome } from "./refresh-wallet-pass-status.js";
export type { VoidWalletPassOutcome } from "./void-wallet-pass-at-provider.js";
export {
  reclaimStaleExportJobs,
  parseExportJobStaleRunningMs,
  isWorkerHeartbeatStaleForPendingReclaim,
  DEFAULT_EXPORT_JOB_STALE_RUNNING_MS,
  DEFAULT_EXPORT_PENDING_HEARTBEAT_STALE_MS,
  WORKER_HEARTBEAT_ID,
  STALE_EXPORT_JOB_ERROR,
  STALE_EXPORT_PENDING_ERROR,
} from "./reclaim-stale-export-jobs.js";
export type {
  ReclaimStaleExportJobsResult,
  ReclaimStaleExportJobsOptions,
} from "./reclaim-stale-export-jobs.js";
export {
  redactAttendeeListFiltersForStorage,
  scrubExportJobResultJson,
  isExportInvalidated,
} from "./export-job-privacy.js";
export type { RedactedAttendeeListFilters } from "./export-job-privacy.js";
export { safeExportJobError } from "./export-job-errors.js";
export type {
  AttendeeCustomFieldFilter,
  AttendeeExportRsvpStatus,
  AttendeeListFilterParams,
  AttendeeMailStatusFilter,
  AttendeeListSqlRow,
  AttendeeSortBy,
  AttendeeSortDir,
  ExportAttendeeSqlRow,
} from "./attendees-list-filters.js";
export { quoteCsvCell, sanitizeCsvCell } from "./csv-sanitize.js";
export type { OpsAuditContext } from "./ops-audit.js";
export type { AdminAuditWriteInput } from "./admin-audit.js";
export type {
  TicketMode,
  ResolvedTicket,
  ResolveTicketContext,
  IssuedTicketResult,
  IssueEventSummary,
  CheckInScanParams,
  CheckInResult,
  CheckInScanResult,
  AdmitResult,
  UndoCheckInResult,
  CheckInAttendeeInfo,
  CheckInHistoryEntry,
  AttendeeCardDto,
  AttendeeCardItemDto,
  EventItemConfig,
  EventItemContent,
  LookupAttendeeResult,
} from "./types.js";
export type { EventOpsConfig } from "./ops-config.js";

export {
  acquireEventCapacityLock,
  eventCapacityLockKey,
  EVENT_CAPACITY_TRANSACTION_OPTIONS,
  EventLockBusyError,
  runEventCapacityTransaction,
  tryAcquireEventCapacityLock,
} from "./event-capacity.js";
export type { EventCapacityTransactionOptions } from "./event-capacity.js";
export { runPublicWrite } from "./public-write-gate.js";
export type { PublicWriteOptions, PublicWriteResult } from "./public-write-gate.js";
export {
  enqueueRegistrationMail,
  enqueueRegistrationMails,
  registrationMailFor,
  registrationMailMisfit,
} from "./registration-mail-queue.js";
export type { RegistrationMailEntry, RegistrationMailMisfit, RegistrationMailMoment } from "./registration-mail-queue.js";
export { seatsNeeded } from "./registration-seats.js";
export type { PlacedStatus } from "./registration-seats.js";
export { createAttendeeFromRegistration } from "./registration-attendee.js";
export type { RegistrationAttendeeSource } from "./registration-attendee.js";
export {
  EVENT_MAIL_CAP_PER_SEAT,
  REGISTRATION_CONFIRM_WINDOW_MS,
  confirmRegistrationAddress,
  eventMailCap,
  placeRegistration,
} from "./registration-placement.js";
export type {
  ConfirmRegistrationInput,
  ConfirmRegistrationResult,
  PlaceRegistrationInput,
  PlaceRegistrationResult,
  PlacementOptions,
  RegistrantSubmission,
  SubmissionMailLimits,
} from "./registration-placement.js";
export { admitRegistrations, rejectRegistrations } from "./registration-decisions.js";
export type {
  AdmitOutcome,
  AdmitRegistrationsParams,
  AdmitRegistrationsResult,
  RejectOutcome,
  RejectRegistrationsParams,
  RejectRegistrationsResult,
  StaffActor,
} from "./registration-decisions.js";
export { retryRegistrationMails } from "./registration-mail-retry.js";
export type {
  RetryMailOutcome,
  RetryRegistrationMailsParams,
  RetryRegistrationMailsResult,
} from "./registration-mail-retry.js";
export {
  activeAttendeeWhere,
  countActiveAdmittedAttendees,
  countActiveAttendees,
  countCompanionsIssued,
  countSeatsInUse,
  countSeatsOfAttendee,
} from "./event-seats.js";
