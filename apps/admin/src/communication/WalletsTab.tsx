import { useEffect, useState } from "react";
import { Card } from "@admitto/ui";
import { WALLET_MESSAGE_TEXT_MAX_LENGTH } from "./walletMessageLimits.js";
import { WalletMessagePreview } from "./WalletMessagePreview.js";
import { WalletsSendPanel } from "./WalletsSendPanel.js";
import type { ArchivedGuardEvent } from "../components/ArchivedGuard.js";
import { isEventArchived } from "../components/ArchivedGuard.js";
import "./communication.css";

interface WalletsTabProps {
  event: ArchivedGuardEvent;
  eventId: string;
}

/** Wallets tab: compose a short message, see a live preview of the lock-screen notification it
 * produces, then send it via WalletsSendPanel. Full-width text editor mirrors the Templates
 * tab's body editor - unlike a mail template, there's no subject/format/placeholder chips, just
 * plain text. */
export function WalletsTab({ event, eventId }: Readonly<WalletsTabProps>) {
  const [text, setText] = useState("");

  // Event switch: a draft message for one event must not silently carry over and get sent to
  // another.
  useEffect(() => {
    setText("");
  }, [eventId]);

  const remaining = WALLET_MESSAGE_TEXT_MAX_LENGTH - text.length;

  return (
    <div className="communication-send-tab">
      <Card title="Message">
        <div className="settings-card-stack">
          <p className="settings-card-intro">
            Write a short message to push to attendees' installed wallet passes as a lock-screen
            notification.
          </p>
          <fieldset className="communication-editor-fieldset" disabled={isEventArchived(event)}>
            <div className="communication-body-field">
              <label htmlFor="wallets-message-text">Message</label>
              <textarea
                id="wallets-message-text"
                className="communication-textarea"
                rows={4}
                value={text}
                maxLength={WALLET_MESSAGE_TEXT_MAX_LENGTH}
                onChange={(e) => setText(e.target.value)}
                placeholder="e.g. Doors close at 6pm — please head to the main hall now."
              />
            </div>
          </fieldset>
          {/* remaining can't go negative: the textarea's own maxLength already stops typed/pasted
              input from exceeding WALLET_MESSAGE_TEXT_MAX_LENGTH. */}
          <p className="mail-field-hint">{remaining} characters remaining</p>
        </div>
      </Card>

      <Card title="Preview">
        <WalletMessagePreview text={text} />
      </Card>

      <WalletsSendPanel event={event} eventId={eventId} text={text} />
    </div>
  );
}
