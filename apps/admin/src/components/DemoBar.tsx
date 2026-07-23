import { useToast } from "@admitto/ui";

export function DemoBar() {
  const { addToast } = useToast();

  if (!import.meta.env.DEV) return null;

  return (
    <section className="demo-bar" aria-label="Developer tools">
      <span className="demo-bar__label">Demo:</span>
      <button
        type="button"
        onClick={() => addToast("Attendees imported: 487 created, 0 skipped", "success")}
      >
        ✓ Success toast
      </button>
      <button
        type="button"
        onClick={() => addToast("Failed to send email to ana@example.com", "error")}
      >
        × Error toast
      </button>
      <button
        type="button"
        onClick={() => addToast("3 tickets pending delivery — check mail log", "warning")}
      >
        △ Warn toast
      </button>
      <button type="button" onClick={() => addToast("Ticket resent to jan@example.com", "info")}>
        i Info toast
      </button>
    </section>
  );
}
