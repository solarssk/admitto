/**
 * Illustrative notification card mockup - same category of trick as PreviewBody's Gmail-style
 * mail client chrome in CommunicationPage.tsx: a faithful visual replica, not a literal render
 * of iOS/Android system UI (no browser can embed that). Uses a generic wallet icon rather than
 * the event's own pass thumbnail - PassCreator's per-pass icon isn't stored anywhere in Admitto
 * today, so a real one isn't available to show here.
 */
import "./wallet-message-preview.css";

export function WalletMessagePreview({ text }: Readonly<{ text: string }>) {
  const trimmed = text.trim();
  return (
    <div className="wallet-message-preview">
      {/* The two pseudo-element layers behind .__card (see CSS) mimic a stack of notifications
          peeking out underneath, matching PassCreator's own push-notification preview. */}
      <div className="wallet-message-preview__stack">
        <div className="wallet-message-preview__card">
          <span className="wallet-message-preview__icon" aria-hidden="true">
            <i className="ti ti-wallet" aria-hidden="true" />
          </span>
          <div className="wallet-message-preview__body">
            <div className="wallet-message-preview__app-row">
              <span className="wallet-message-preview__app-name">Wallet</span>
              <span className="wallet-message-preview__now">now</span>
            </div>
            <p className="wallet-message-preview__text">
              {trimmed || <span className="wallet-message-preview__placeholder">Your message will appear here…</span>}
            </p>
          </div>
        </div>
      </div>
      <p className="mail-field-hint">
        Illustrative preview of the notification attendees see when this message is pushed to
        their pass. Apple and Google Wallet each render their own native notification style,
        which will differ slightly from this mockup.
      </p>
    </div>
  );
}
