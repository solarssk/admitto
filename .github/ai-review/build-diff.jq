# Input: the JSON array from the "list pull request files" or "compare" API (.files).
# Output: the text the reviewer reads. Lockfiles are left out by exact file name (named on the first
# line); a file GitHub sends no patch for is marked UNAVAILABLE, except a pure rename, which has no
# patch because nothing changed and must not make a docs move unreviewable. Nothing is excluded by directory or
# extension, because a PR could then hide any file from the reviewer by choosing its path.
([.[] | select(.filename | test("(^|/)(package-lock\\.json|yarn\\.lock|pnpm-lock\\.yaml)$")) | .filename]) as $skipped
| (if ($skipped | length) > 0
     then "EXCLUDED FROM THIS REVIEW (lockfiles; covered by dependency-review and Snyk): " + ($skipped | join(", ")) + "\n\n"
     else "" end),
  (.[] | select(.filename | test("(^|/)(package-lock\\.json|yarn\\.lock|pnpm-lock\\.yaml)$") | not)
    | "diff --git a/\(.previous_filename // .filename) b/\(.filename)\n"
      + (.patch // (if .status == "renamed" and ((.changes // 0) == 0)
                    then "(renamed without content changes)"
                    else "UNAVAILABLE: GitHub returned no patch for this file (binary or too large); it could not be reviewed"
                    end))
      + "\n")
