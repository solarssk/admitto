import { Link } from "react-router";
import { Badge, Card } from "@admitto/ui";
import type { RegistrationPublicFieldDto } from "../api/types.js";
import "./registration-access.css";

/**
 * The questions of the Fields tab that the form asks, in the order a guest meets them: what the organiser sees to notice a question
 * that is on the form without anyone meaning it to be. Only the label and whether it is required, never an answer. The questions
 * every form asks (name, email) and the ones the switches above add are not in the list.
 */
export function AccessQuestionsCard({ fields }: Readonly<{ fields: readonly RegistrationPublicFieldDto[] }>) {
  return (
    <Card title="Your questions on the form">
      <div className="settings-card-stack">
        {fields.length === 0 ? (
          <p className="settings-card-intro">No question of yours is on the form. Guests give their name and email address, and what the switches above add.</p>
        ) : (
          <ul className="access-questions">
            {fields.map((field) => (
              <li key={field.key} className="access-question">
                <span className="access-question__label">{field.label}</span>
                <Badge variant={field.required ? "info" : "neutral"}>{field.required ? "Required" : "Optional"}</Badge>
              </li>
            ))}
          </ul>
        )}
        <p className="settings-card-intro">
          <Link to={{ search: "?tab=fields" }} replace>
            Add or change questions on the Fields tab.
          </Link>
        </p>
      </div>
    </Card>
  );
}
