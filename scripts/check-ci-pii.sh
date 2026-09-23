#!/usr/bin/env bash
set -euo pipefail

# Scan tracked data files without ever printing matched content to CI logs.
# Keep the email and phone scopes separate so their existing check names stay stable.
case "${1:-}" in
  email)
    # package-lock.json may contain dependency-maintainer emails, not product data.
    # The end anchor prevents @example.com.evil from being treated as a test address.
    hits=$(git ls-files -z -- '*.csv' '*.tsv' '*.json' ':!package-lock.json' \
      | xargs -0 grep -hREo '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' -- \
      | grep -viE '@(example\.(com|org|net)|test\.(com|org|net))$' || true)
    if [[ -n "$hits" ]]; then
      echo '::error::Suspicious email addresses found in tracked data files. Matches are hidden; inspect locally.' >&2
      exit 1
    fi
    echo 'OK: no real email addresses in data files'
    ;;
  phone)
    # E.164-leaning: require a leading + and 7-21 digits, allowing short separator runs.
    # The boundary groups avoid matching a + inside a longer numeric identifier.
    hits=$(git ls-files -z -- '*.csv' '*.tsv' '*.json' '*.yaml' '*.yml' '*.sql' ':!package-lock.json' \
      | xargs -0 grep -hREo '(^|[^0-9])\+[1-9]([0-9]|[ .()-]{1,2}[0-9]){6,20}($|[^0-9])' -- || true)
    if [[ -n "$hits" ]]; then
      echo '::error::Suspicious phone numbers found in tracked data files. Matches are hidden; inspect locally.' >&2
      exit 1
    fi
    echo 'OK: no phone-number-shaped strings in data files'
    ;;
  *)
    echo 'Usage: check-ci-pii.sh email|phone' >&2
    exit 2
    ;;
esac
