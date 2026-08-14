/**
 * Illustrative lock-screen notification mockup - same category of trick as PreviewBody's
 * Gmail-style mail client chrome in CommunicationPage.tsx: a faithful visual replica, not a
 * literal render of iOS/Android system UI (no browser can embed that). Uses a generic wallet
 * icon rather than the event's own pass thumbnail - PassCreator's per-pass icon isn't stored
 * anywhere in Admitto today, so a real one isn't available to show here.
 */
import "./wallet-message-preview.css";

export function WalletMessagePreview({ text }: Readonly<{ text: string }>) {
  const trimmed = text.trim();
  return (
    <div className="wallet-message-preview">
      <div className="wallet-message-preview__lockscreen">
        <div className="wallet-message-preview__clock">
          <span className="wallet-message-preview__time">9:41</span>
          <span className="wallet-message-preview__date">Today</span>
        </div>
        <div className="wallet-message-preview__notification">
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
        Illustrative preview of the lock-screen banner attendees see on Apple Wallet. Google Wallet
        renders its own notification style, which may differ slightly.
      </p>
    </div>
  );
}
