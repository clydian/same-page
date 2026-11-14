#!/bin/sh
# SamePage: read-only, versioned Modern Web Guidance entry point.
set -eu
case "${1-}" in
  search|retrieve)
    if [ "$#" -ne 2 ] || [ -z "$2" ]; then
      echo 'Expected search "generic English query" or retrieve "returned-id[,id]".' >&2
      exit 2
    fi
    case "$2" in -*) echo 'Arguments must not start with an option.' >&2; exit 2 ;; esac
    ;;
  list) [ "$#" -eq 1 ] || exit 2 ;;
  *) echo 'Usage: lookup.sh search QUERY | retrieve IDS | list' >&2; exit 2 ;;
esac
export DISABLE_TELEMETRY=1
export ENABLE_FILE_LOGGING=false
# Ignore lifecycle hooks, including if the caller enabled them in npm config.
export npm_config_ignore_scripts=true
exec npm exec --yes --ignore-scripts --package=modern-web-guidance@1.0.0 -- \
  modern-web-guidance "$@" --skill-version 2026_11_09-5bcc021b
