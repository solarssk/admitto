import { useEffect, useState } from "react";
import { Card, Notice } from "@admitto/ui";
import {
  WALLET_MESSAGE_TEXT_MAX_LENGTH,
  WALLET_MESSAGE_TRUNCATION_WARNING_LENGTH,
} from "./walletMessageLimits.js";
import { WalletMessagePreview } from "./WalletMessagePreview.js";
import { WalletsSendPanel } from "./WalletsSendPanel.js";
import type { ArchivedGuardEvent } from "../components/ArchivedGuard.js";
import { isEventArchived } from "../components/ArchivedGuard.js";
import "./communication.css";

interface WalletsTabProps {
  event: ArchivedGuardEvent;
  eventId: string;
}

/** Wallets tab: compose a short message with a live preview of the lock-screen notification it
 * produces side by side, mirroring the Templates tab's editor/preview split, then send it via
 * WalletsSendPanel below. Unlike a mail template, there's no subject/format/placeholder chips,
 * just plain text. */
export function WalletsTab({ event, eventId }: Readonly<WalletsTabProps>) {
  const [text, setText] = useState("");

  // Event switch: a draft message for one event must not silently carry over and get sent to
  // another.
  useEffect(() => {
    setText("");
  }, [eventId]);

  const remaining = WALLET_MESSAGE_TEXT_MAX_LENGTH - text.length;
  const overSoftLimit = text.length > WALLET_MESSAGE_TRUNCATION_WARNING_LENGTH;

  return (
    <div className="communication-send-tab">
      <div className="communication-templates-split">
        <Card title="Message">
          <div className="settings-card-stack">
            <p className="settings-card-intro">
              Write a short message to push to attendees' installed wallet passes as a lock-screen
              notification.
            </p>
            <fieldset className="communication-editor-fieldset" disabled={isEventArchived(event)}>
              <div className="communication-body-field">
                {/* Visually hidden: the Card title and intro above already say "Message" -
                    a second, identical visible label right above the textarea was pure
                    duplication. Kept for accessibility (the textarea still needs a name). */}
                <label htmlFor="wallets-message-text" className="sr-only">
                  Message
                </label>
                <textarea
                  id="wallets-message-text"
                  className="communication-textarea"
                  rows={4}
                  value={text}
                  maxLength={WALLET_MESSAGE_TEXT_MAX_LENGTH}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="e.g. Doors close at 6pm, please head to the main hall now."
                />
              </div>
            </fieldset>
            {/* remaining can't go negative: the textarea's own maxLength already stops
                typed/pasted input from exceeding WALLET_MESSAGE_TEXT_MAX_LENGTH. Kept as a
                separate paragraph from the warning below: this one changes on every keystroke,
                and role="alert" on a live-changing element re-announces the whole thing to a
                screen reader on every character typed once overSoftLimit is true. */}
            <p className={overSoftLimit ? "mail-field-hint mail-field-hint--warning" : "mail-field-hint"}>
              {remaining} characters remaining
            </p>
            {overSoftLimit && (
              <p className="mail-field-hint mail-field-hint--warning" role="alert">
                Long messages may be cropped on some lock screens.
              </p>
            )}
          </div>
        </Card>

        <Card title="Preview">
          <WalletMessagePreview text={text} />
        </Card>
      </div>

      <Notice variant="info">
        Google Wallet allows at most 3 notification-triggering messages per pass in a rolling
        24-hour window, and further sends within that window are rejected until it resets. Apple
        Wallet doesn't publish a fixed number, but throttles or blocks pushes it considers
        excessive. Space out repeat sends to the same event.
      </Notice>

      <WalletsSendPanel event={event} eventId={eventId} text={text} />
    </div>
  );
}
