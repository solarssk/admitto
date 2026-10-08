/**
 * Guard for "Erase personal data": every column of an attendee and of everything that hangs off
 * one has a decision recorded here, so adding a column (or a table that points at an attendee)
 * fails this test until someone decides what erasure does with it. The behaviour itself is
 * tested in erase-attendees.test.ts; the reasoning is in docs/dev/attendee-erasure.md.
 *
 * What the decisions mean:
 * - placeholder: replaced by a fixed value (also pinned by the CHECK constraint)
 * - cleared:     set to NULL
 * - coarsened:   cut to the start of its hour in the event timezone
 * - set:         written by erasure itself (the marker, timestamps, a cancelled status)
 * - kept:        stays because Reports, capacity, staff history or the provider-delete retry read it
 * - deleted:     the whole row is deleted
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Decision = "placeholder" | "cleared" | "coarsened" | "set" | "kept" | "deleted";
type ModelInventory = Partial<Record<Decision, string>>;

const INVENTORY: Record<string, ModelInventory> = {
  Attendee: {
    placeholder: "name email",
    cleared: "first_name last_name company department custom_data token_hash token_enc qr_payload external_uuid public_ref",
    coarsened: "admitted_at",
    set: "status erased_at email_bounce_dismissed_at updated_at",
    // Staff ids and enums, not the person's data; Reports and the admission log read them.
    kept: "id event_id ticket_type rsvp_status rsvp_updated_at rsvp_source admitted_by created_at client_timezone",
  },
  EmailDelivery: {
    cleared: "recipient_email rendered_subject rendered_html provider_message_id error",
    set: "status retryable updated_at",
    // Counts and status of the Mail report; no content.
    kept: "id organization_id event_id attendee_id purpose batch_id template_id template_id_snapshot template_label_snapshot had_wallet_cta provider error_code attempts queued_at attempted_at accepted_at sent_at delivered_at failed_at viewed_at opened_at clicked_at created_at client_timezone actor_user_id session_id",
  },
  CheckIn: {
    cleared: "notes",
    coarsened: "checked_in_at created_at",
    kept: "id attendee_id event_id status checked_in_by source device_id session_id",
  },
  WalletPass: {
    cleared: "download_url apple_url android_url samsung_url user_agent user_agent_captured_at pass_type_id serial_number auth_token pass_url",
    // The provider ids stay until the pass is deleted at the provider, so a failed delete can be retried.
    kept: "id attendee_id provider provider_pass_id user_provided_id status last_error_code last_synced_at issued_at voided_at expires_at first_confirmed_at apple_active_registrations apple_inactive_registrations google_active_registrations google_inactive_registrations samsung_active_registrations samsung_inactive_registrations first_downloaded_at registration_checked_at registration_sync_attempted_at lifecycle_observed_at provider_removed_at provider_commanded_at created_at updated_at",
  },
  AttendeeItemState: { kept: "id attendee_id event_item_id state updated_at updated_by" },
  AttendeeNote: { deleted: "id attendee_id event_id author_user_id body created_at" },
  AttendeeActionLog: {
    deleted: "id event_id attendee_id action_type actor_user_id session_id device_id ip metadata created_at client_timezone",
  },
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(path.resolve(__dirname, "../../db/prisma/schema.prisma"), "utf8");

const models = new Map<string, string>(
  [...schema.matchAll(/^model (\w+) \{\n([\s\S]*?)^\}/gm)].map((match) => [match[1]!, match[2]!]),
);

/** Scalar columns of a model (relation fields and block attributes left out). */
function columnsOf(model: string): string[] {
  const body = models.get(model);
  if (!body) throw new Error(`model ${model} not found in schema.prisma`);
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//") && !line.startsWith("@@"))
    .flatMap((line) => {
      const field = /^(\w+)\s+(\w+)/.exec(line);
      return field && !models.has(field[2]!) ? [field[1]!] : [];
    });
}

function decided(model: string): string[] {
  return Object.values(INVENTORY[model]!).flatMap((columns) => columns!.split(" "));
}

describe("attendee erasure inventory", () => {
  it.each(Object.keys(INVENTORY))("%s: every column has a decision, and none is stale", (model) => {
    const actual = columnsOf(model).sort();
    const listed = decided(model).sort();
    expect(listed, `decisions listed twice in ${model}`).toEqual([...new Set(listed)]);
    expect(listed).toEqual(actual);
  });

  it("covers every model that points at an attendee", () => {
    const dependents = [...models.entries()]
      // A relation field, or a plain attendee_id column that carries no relation.
      .filter(
        ([name, body]) =>
          name !== "Attendee" && (/^\s*\w+\s+Attendee\??\s/m.test(body) || columnsOf(name).includes("attendee_id")),
      )
      .map(([name]) => name)
      .sort();
    expect(dependents).toEqual(Object.keys(INVENTORY).filter((model) => model !== "Attendee").sort());
  });
});
