import { EVENT_CUSTOM_FIELD_SUGGESTIONS_MAX, EVENT_CUSTOM_FIELD_SUGGESTION_MAX, type EventCustomFieldType } from "@admitto/shared";
import { Notice } from "@admitto/ui";
import type { EventCustomFieldDto } from "../api/types.js";
import { SectionLabel } from "../attendees/SectionLabel.js";
import { SearchableSelect, type SearchableSelectOption } from "../components/SearchableSelect.js";
import { customFieldTypeIcon } from "./customFieldType.js";
import { conditionCandidates, dependentsIn, fieldNameIn, ownConditionBlockedMessage } from "./fieldDependencies.js";
import { typeTakesSuggestions, type RulesDraft, type RulesProblems } from "./fieldRules.js";
import { GUEST_FORM_ICON_OPTIONS, guestFormIconNamed, iconNotDrawnMessage } from "./guestFormIcons.js";
import { IconPicker } from "./IconPicker.js";
import { OptionsEditor } from "./OptionsEditor.js";
import "./requirements.css";

export interface FormRulesEditorProps {
  type: EventCustomFieldType;
  /** The field is Required: a required yes/no question is two buttons on the form, which have no place for an icon. */
  required: boolean;
  draft: RulesDraft;
  problems: RulesProblems;
  /** The event's fields, which the question a condition depends on is picked from. */
  fields: readonly EventCustomFieldDto[];
  /** The key of the field being edited; empty while a new field has no label yet. */
  sourceField: string;
  /** The field is on the registration form once it is saved: a question with a condition can be there only with the one it depends on. */
  onForm: boolean;
  /** What is wrong with the condition as far as the other fields go, in a sentence (`dependencyMessage`); empty when nothing is. */
  conditionError: string;
  /** The field is being saved: the controls stay on screen, with what they hold, and take no change. */
  saving: boolean;
  onChange: (draft: RulesDraft) => void;
}

const NO_CONDITION: SearchableSelectOption = { id: "", label: "No condition" };

/** What the condition row says while nothing is wrong with it. */
function conditionHint(controller: EventCustomFieldDto | undefined): string {
  if (controller?.type === "boolean") return "Asked only when the answer to that question is Yes. Leave it empty to ask everyone.";
  return "Asked only when the answer to that question is the one you choose. Leave it empty to ask everyone.";
}

interface ConditionControlsProps {
  draft: RulesDraft;
  fields: readonly EventCustomFieldDto[];
  candidates: readonly EventCustomFieldDto[];
  onForm: boolean;
  blockedReason: string;
  conditionError: string;
  missingAnswer: string | undefined;
  disabled: boolean;
  onChange: (draft: RulesDraft) => void;
}

/** "Show only when": the question this one depends on, and the answer that shows it. */
function ConditionControls({
  draft,
  fields,
  candidates,
  onForm,
  blockedReason,
  conditionError,
  missingAnswer,
  disabled,
  onChange,
}: Readonly<ConditionControlsProps>) {
  const controller = candidates.find((field) => field.source_field === draft.showWhen?.field);
  const noCandidates = candidates.length === 0;
  const reason = blockedReason || (noCandidates ? "This event has no yes/no or single choice question without a condition yet. Add one first." : "");
  const questionOptions: SearchableSelectOption[] = [
    NO_CONDITION,
    ...candidates.map((field) => ({
      id: field.source_field,
      label: `${fieldNameIn(field, fields)}${onForm && !field.show_on_form ? " (not on the form)" : ""}`,
      icon: customFieldTypeIcon(field.type).replace(/^ti-/, ""),
    })),
  ];
  const answerOptions: SearchableSelectOption[] =
    controller?.type === "select"
      ? [{ id: "", label: "Choose an answer" }, ...(controller.options ?? []).map((option) => ({ id: option, label: option }))]
      : [{ id: "true", label: "Yes" }];
  let answer = "";
  if (controller?.type === "boolean") answer = "true";
  else if (typeof draft.showWhen?.value === "string") answer = draft.showWhen.value;
  const problem = conditionError || missingAnswer || "";
  const hint = reason || conditionHint(controller);

  function chooseQuestion(key: string) {
    const next = candidates.find((field) => field.source_field === key);
    // The same question again keeps the answer that was chosen for it.
    if (next?.source_field === draft.showWhen?.field) return;
    onChange({ ...draft, showWhen: next ? { field: next.source_field, value: next.type === "boolean" ? true : "" } : null });
  }

  return (
    <fieldset className="form-rules__group" aria-labelledby="cf-show-when-label">
      <span className="at-label" id="cf-show-when-label">
        Show only when
      </span>
      <div className="form-rules__condition">
        <SearchableSelect
          id="cf-show-when-field"
          label="Question"
          showLabel={false}
          placeholder="No condition"
          searchPlaceholder="Search questions…"
          emptyLabel="No questions found"
          value={draft.showWhen?.field ?? ""}
          options={questionOptions}
          disabled={disabled || reason !== ""}
          invalid={conditionError !== ""}
          describedBy="cf-show-when-note"
          onChange={chooseQuestion}
        />
        <SearchableSelect
          id="cf-show-when-answer"
          label="Answer"
          showLabel={false}
          placeholder={controller ? "Choose an answer" : "Choose a question first"}
          searchPlaceholder="Search answers…"
          emptyLabel="No answers found"
          value={answer}
          options={answerOptions}
          // A yes/no question has one answer that can show this one, so there is nothing to choose.
          disabled={disabled || controller?.type !== "select"}
          invalid={missingAnswer !== undefined}
          describedBy="cf-show-when-note"
          onChange={(value) => onChange({ ...draft, showWhen: draft.showWhen ? { field: draft.showWhen.field, value } : null })}
        />
      </div>
      <div className="form-rules__note" id="cf-show-when-note">
        {problem ? (
          <span className="at-hint at-hint--error" role="alert">
            {problem}
          </span>
        ) : (
          <span className="at-hint">{hint}</span>
        )}
      </div>
    </fieldset>
  );
}

/**
 * What a question carries on the registration form, under a labelled break: its icon, the condition that shows it and, for a text field,
 * the suggestions it offers. None of it is required, and none of it changes what an answer may be: the icon is drawn next to the
 * question, a question with a condition is asked only when another answer says so, and suggestions only suggest, so a guest can still type
 * any text. The server judges the same things (the checks of `@admitto/shared` and of packages/tickets), so a problem is said here, where
 * the controls are, before the editor asks.
 */
export function FormRulesEditor({
  type,
  required,
  draft,
  problems,
  fields,
  sourceField,
  onForm,
  conditionError,
  saving,
  onChange,
}: Readonly<FormRulesEditorProps>) {
  const candidates = conditionCandidates(fields, sourceField);
  const dependents = dependentsIn(fields, sourceField);
  // An icon that is chosen for a kind of question the form draws no icon for is saved all the same: the editor says so, and does not hold it back.
  const notDrawn = draft.icon === null ? "" : iconNotDrawnMessage(type, required);
  return (
    <fieldset className="form-rules" aria-labelledby="cf-form-rules-title">
      <SectionLabel id="cf-form-rules-title">Registration form</SectionLabel>
      <div className="at-field">
        <span className="at-label" id="cf-icon-label">
          Icon
        </span>
        <IconPicker
          labelledBy="cf-icon-label"
          value={draft.icon}
          icons={GUEST_FORM_ICON_OPTIONS}
          defaultIcon="ban"
          noneLabel="No icon"
          disabled={saving}
          onChange={(name) => onChange({ ...draft, icon: guestFormIconNamed(name) })}
        />
        <span className="at-hint">
          Drawn on the registration form next to optional Yes / No questions and next to one-line answers (Text, Date, Date and time, Phone).
        </span>
        {notDrawn ? (
          <Notice variant="warning" as="output">
            {notDrawn}
          </Notice>
        ) : null}
      </div>
      <ConditionControls
        draft={draft}
        fields={fields}
        candidates={candidates}
        onForm={onForm}
        blockedReason={ownConditionBlockedMessage(dependents, fields)}
        conditionError={conditionError}
        missingAnswer={problems.showWhen}
        disabled={saving}
        onChange={onChange}
      />
      {typeTakesSuggestions(type) ? (
        <div className="at-field">
          <span className="at-label" id="cf-suggestions-label">
            Suggestions
          </span>
          <OptionsEditor
            rows={draft.suggestions}
            usageCounts={null}
            showUsage={false}
            noun="suggestion"
            max={EVENT_CUSTOM_FIELD_SUGGESTIONS_MAX}
            invalidKeys={problems.suggestions?.keys}
            errorId="cf-suggestions-note"
            disabled={saving}
            onChange={(suggestions) => onChange({ ...draft, suggestions })}
          />
          <div className="form-rules__note" id="cf-suggestions-note">
            {problems.suggestions ? (
              <span className="at-hint at-hint--error" role="alert">
                {problems.suggestions.message}
              </span>
            ) : (
              <span className="at-hint">
                Offered while a guest types. They only suggest: a guest can still type any text. Up to {EVENT_CUSTOM_FIELD_SUGGESTIONS_MAX},
                each up to {EVENT_CUSTOM_FIELD_SUGGESTION_MAX} characters.
              </span>
            )}
          </div>
        </div>
      ) : null}
    </fieldset>
  );
}
