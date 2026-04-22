#!/bin/bash
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

if [ ! -d node_modules ]; then
  npm ci
fi

install_steward_cli() {
  local version="0.4.38"

  if command -v steward >/dev/null 2>&1; then
    local installed_version
    installed_version="$(steward --version 2>/dev/null | awk '{print $NF}' || true)"
    if [ "$installed_version" = "$version" ]; then
      return 0
    fi
  fi

  if ! command -v npm >/dev/null 2>&1; then
    echo "session-start hook: npm not available — skipping steward CLI install" >&2
    return 0
  fi

  npm install -g "@contextgraph/agent@${version}" >/dev/null

  echo "session-start hook: installed steward CLI v${version} (@contextgraph/agent)"
}

install_steward_cli
