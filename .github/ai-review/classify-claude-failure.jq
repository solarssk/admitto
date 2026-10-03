# Decides whether a failed Claude review run was a provider problem (the review could not be
# produced) or something else. Input: the execution file of anthropics/claude-code-action (the
# messages the Claude Code SDK emitted). Output: one fixed reason word when the failure is a
# provider/availability problem, nothing otherwise. Never prints text from the file.
#
# Provider problems, by the SDK's own machine-readable error on an assistant message: the login or
# subscription is rejected, the usage limit is reached, the service is overloaded or erroring.
# Deliberately NOT in the list: invalid_request, model_not_found, max_output_tokens, unknown,
# error_max_turns and a missing structured output. Those are our configuration or a review that did
# not finish, and a fallback would hide them.
def provider_errors: [
  "authentication_failed", "oauth_org_not_allowed", "account_on_hold", "verification_required",
  "billing_error", "rate_limit", "overloaded", "server_error", "cloud_credential_error"
];
def last_result: [.. | objects | select(.type == "result")] | last // {};
# Our own configuration or a review that did not finish, not an outage.
def not_an_outage: ["invalid_request", "model_not_found", "max_output_tokens", "unknown"];

([.. | objects | select(.type == "assistant") | .error? // empty]) as $errors
| ($errors | map(select(. as $e | provider_errors | index($e))) | last) as $code
| last_result as $result
| if $code != null then $code
  # A typed error that is ours: never a fallback, whatever else the result says.
  elif ($errors | map(select(. as $e | not_an_outage | index($e))) | length) > 0 then empty
  # Older wording: an error result whose text names a provider problem.
  elif ($result.is_error == true)
    and (($result.result // "") | test("usage limit|rate limit|overloaded|please run /login|invalid api key|oauth token|credit balance|\\b(529|50[0234])\\b"; "i"))
  then "provider_error"
  # An error result (subtype success with is_error, not error_max_turns and the like) before any model
  # answered: no tokens, no model usage, no typed error. This is
  # what a rejected login or an exhausted subscription looks like from the action's side.
  elif ($result.is_error == true) and ($result.subtype == "success") and (($result.total_cost_usd // 0) == 0) and (($result.modelUsage // {}) | length) == 0
  then "no_model_response"
  else empty end
