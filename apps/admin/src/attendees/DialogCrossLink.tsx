import "./dialog-cross-link.css";

/** A line at the foot of the Erase and Remove dialogs that points to the other one, for someone who came with the
 * other reason ("A privacy request? Use Erase personal data"). The two actions look alike in a menu and differ in
 * what they leave in Reports, so the way across is where the choice is confirmed. Without a target there is no
 * other dialog to go to (an archived event has no Remove, an erased person no Erase), and the line is left out. A
 * busy link keeps its focus and does nothing (AGENTS.md, busy buttons). */
export function DialogCrossLink({
  question,
  action,
  busy,
  onClick,
}: Readonly<{ question: string; action: string; busy: boolean; onClick: (() => void) | undefined }>) {
  if (!onClick) return null;
  return (
    <p className="dialog-cross-link">
      {question}{" "}
      <button
        type="button"
        className="link-btn dialog-cross-link__button"
        aria-disabled={busy || undefined}
        onClick={() => {
          if (!busy) onClick();
        }}
      >
        {action}
      </button>
    </p>
  );
}
