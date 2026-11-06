#!/usr/bin/env bash
# User-started bounded StepFun check. Do not run from CI or an agent.
# env -i starts a clean bash. The hidden read and export happen only there.
# env/bash/node arguments never contain the key; node inherits the variable.
# Does not read keychain, auth files, .env, or any pre-set global key.
set -euo pipefail
set +x
umask 077

cleanup() {
  unset HARK_STEPFUN_API_KEY
  unset KEY_INPUT
}
trap cleanup EXIT INT TERM HUP

unset HARK_STEPFUN_API_KEY
unset KEY_INPUT

if [[ $# -gt 2 ]]; then
  printf '%s\n' '{"code":"invalid_args","status":null}' >&2
  exit 2
fi
if [[ $# -eq 1 || ( $# -eq 2 && "$1" != "--summary" ) ]]; then
  printf '%s\n' '{"code":"invalid_args","status":null}' >&2
  exit 2
fi
for arg in "$@"; do
  case "$arg" in
    --api-key|--api-key=*|HARK_STEPFUN_API_KEY=*|*KEY=*|*TOKEN=*|*SECRET=*|*PASSWORD=*)
      printf '%s\n' '{"code":"key_in_args","status":null}' >&2
      exit 2
      ;;
  esac
done

if [[ ! -t 0 ]]; then
  printf '%s\n' '{"code":"interactive_tty_required","status":null}' >&2
  exit 2
fi

if [[ "${HARK_STEPFUN_CLEAN_SHELL:-}" != "1" ]]; then
  trap - EXIT INT TERM HUP
  exec env -i \
    PATH="$PATH" \
    TMPDIR="${TMPDIR:-/tmp}" \
    LANG="${LANG:-C.UTF-8}" \
    HOME="${HOME:-/tmp}" \
    TERM="${TERM:-dumb}" \
    HARK_STEPFUN_CLEAN_SHELL=1 \
    bash --noprofile --norc -- "$0" "$@"
fi

# Clean shell. set +x is already on, and is repeated before the read.
set +x
unset HARK_STEPFUN_API_KEY
unset KEY_INPUT
printf '%s' 'StepFun live-check key (hidden, not saved): ' >&2
IFS= read -r -s KEY_INPUT || true
printf '\n' >&2
if [[ -z "${KEY_INPUT}" ]]; then
  unset KEY_INPUT
  printf '%s\n' '{"code":"missing_key","status":null}' >&2
  exit 2
fi
export HARK_STEPFUN_API_KEY="$KEY_INPUT"
unset KEY_INPUT

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

set +e
node --experimental-strip-types \
  packages/agent-host/scripts/stepfun-live-check.ts \
  "$@"
status=$?
set -e
exit "$status"
