import { PASSWORD_MIN_LENGTH } from "./constants.js";
import { scorePasswordStrengthInline } from "./password-strength.js";

/** Shared auth-page styles for password strength and confirm-match hints. */
export const AUTH_PASSWORD_STRENGTH_CSS = `
.auth-password-strength {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  margin-top: 0.375rem;
}
.auth-password-strength[hidden] { display: none; }
.auth-password-strength__bar {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.25rem;
}
.auth-password-strength__segment {
  height: 0.25rem;
  border-radius: 999px;
  background: var(--at-gray-200);
}
.auth-password-strength__segment--weak { background: var(--at-red); }
.auth-password-strength__segment--fair { background: var(--at-yellow); }
.auth-password-strength__segment--good { background: var(--at-blue); }
.auth-password-strength__segment--strong { background: var(--at-green); }
.auth-password-strength__label {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--at-gray-600);
}
.auth-confirm-match--ok { color: var(--at-green-600); }
.auth-confirm-match--warn { color: var(--at-gray-500); }
`;

/** Inline script for setup / change-password pages — embeds the same scorer as @admitto/auth. */
export function passwordStrengthAuthScript(): string {
  const scorerSource = scorePasswordStrengthInline.toString();
  return `<script>
(function () {
  var MIN = ${PASSWORD_MIN_LENGTH};
  var score = ${scorerSource};

  function appendDescribedBy(input, id) {
    var tokens = (input.getAttribute("aria-describedby") || "").split(/\\s+/).filter(Boolean);
    if (tokens.indexOf(id) === -1) tokens.push(id);
    input.setAttribute("aria-describedby", tokens.join(" "));
  }

  function ensureMeter(input) {
    var field = input.closest(".auth-field");
    if (!field) return null;
    var meter = field.querySelector(".auth-password-strength");
    if (!meter) {
      meter = document.createElement("div");
      meter.className = "auth-password-strength";
      meter.hidden = true;
      meter.setAttribute("role", "status");
      meter.setAttribute("aria-live", "polite");
      meter.innerHTML =
        '<div class="auth-password-strength__bar" aria-hidden="true">' +
        '<span class="auth-password-strength__segment"></span>'.repeat(4) +
        '</div><span class="auth-password-strength__label"></span>';
      field.appendChild(meter);
      var meterId = input.id + "-strength";
      meter.id = meterId;
      appendDescribedBy(input, meterId);
    }
    return meter;
  }

  function updateMeter(input) {
    var meter = ensureMeter(input);
    if (!meter) return;
    var result = score(input.value, MIN);
    if (result.level === "empty") {
      meter.hidden = true;
      return;
    }
    meter.hidden = false;
    meter.setAttribute("aria-label", "Password strength: " + result.label);
    var label = meter.querySelector(".auth-password-strength__label");
    if (label) label.textContent = result.label;
    var segments = meter.querySelectorAll(".auth-password-strength__segment");
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      seg.className = "auth-password-strength__segment";
      if (i < result.score) seg.className += " auth-password-strength__segment--" + result.level;
    }
  }

  function wireMatch(confirmInput, passwordInput) {
    var field = confirmInput.closest(".auth-field");
    if (!field) return;
    var hint = field.querySelector(".auth-confirm-match");
    if (!hint) {
      hint = document.createElement("p");
      hint.className = "auth-field-hint auth-confirm-match";
      hint.id = confirmInput.id + "-match";
      hint.setAttribute("role", "status");
      hint.setAttribute("aria-live", "polite");
      field.appendChild(hint);
      appendDescribedBy(confirmInput, hint.id);
    }
    function update() {
      if (!confirmInput.value) {
        hint.textContent = "";
        hint.className = "auth-field-hint auth-confirm-match";
        return;
      }
      var matches = confirmInput.value === passwordInput.value;
      hint.textContent = matches ? "Passwords match." : "Passwords do not match yet.";
      hint.className = "auth-field-hint auth-confirm-match " + (matches ? "auth-confirm-match--ok" : "auth-confirm-match--warn");
    }
    confirmInput.addEventListener("input", update);
    passwordInput.addEventListener("input", update);
  }

  var password = document.getElementById("password");
  if (password) {
    password.addEventListener("input", function () { updateMeter(password); });
    updateMeter(password);
  }
  var confirm = document.getElementById("confirm_password") || document.getElementById("password_confirm");
  if (confirm && password) {
    wireMatch(confirm, password);
  }
})();
</script>`;
}
