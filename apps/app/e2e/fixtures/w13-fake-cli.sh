#!/bin/sh
set -eu
name=$(basename "$0")
state_file=${W13_FAKE_CLI_STATE:?}
log_file=${W13_FAKE_CLI_LOG:?}
record() { printf '%s %s\n' "$name" "$*" >> "$log_file"; }
state() { if [ -f "$state_file" ]; then cat "$state_file"; else printf 'signed_out'; fi; }

if [ "$name" = "claude" ]; then
  case "${1-} ${2-} ${3-}" in
    "--version  ") printf 'Claude Code 2.99.0 (fake CLI)\n' ;;
    "auth status "|"auth status --json")
      record "auth status"
      if [ "$(state)" = "signed_in" ]; then printf '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","email":"fake-claude@example.invalid","subscriptionType":"max"}\n'; else printf '{"loggedIn":false,"authMethod":"none"}\n'; exit 1; fi
      ;;
    "auth login --claudeai")
      record "auth login"
      trap 'record "login cancelled"; exit 143' TERM INT
      printf 'Opening browser to sign in…\nIf the browser did not open, visit: https://claude.com/fake-cli-sign-in\nPaste code here if prompted > '
      IFS= read -r answer || exit 1
      if [ "$answer" = "FAKE-CODE" ]; then printf 'signed_in' > "$state_file"; record "login complete"; printf 'Login successful.\n'; else printf 'Login failed: fake code rejected\n' >&2; exit 1; fi
      ;;
    "auth logout ") record "auth logout"; printf 'signed_out' > "$state_file"; printf 'Logged out.\n' ;;
    *) record "unexpected $*"; exit 64 ;;
  esac
  exit 0
fi

if [ "$name" = "codex" ]; then
  case "${1-} ${2-}" in
    "--version ") printf 'codex-cli 0.160.0 (fake CLI)\n' ;;
    "login status") record "login status"; if [ "$(state)" = "signed_in" ]; then printf 'Logged in using ChatGPT\n'; else printf 'Not logged in\n'; exit 1; fi ;;
    "login --device-auth") record "login --device-auth"; trap 'record "login cancelled"; exit 143' TERM INT; printf 'Open this link and sign in\nhttps://auth.openai.com/codex/device\nOne-time code (expires in 15 minutes)\nFAKE-CODE\n'; while [ "$(state)" != "signed_in" ]; do sleep 0.1; done; record "login complete"; printf 'Login complete\n' ;;
    "mcp list") printf '[]\n' ;;
    "logout ") record logout; printf 'signed_out' > "$state_file"; printf 'Logged out\n' ;;
    *) record "unexpected $*"; exit 64 ;;
  esac
  exit 0
fi

if [ "$name" = "opencode" ]; then
  case "${1-} ${2-}" in
    "--version ") printf 'opencode 1.0.0 (fake CLI)\n' ;;
    "debug config") printf '{"mcp":{}}\n' ;;
    "auth list") printf '[]\n' ;;
    "acp ") record "acp started"; exit 0 ;;
    *) record "unexpected $*"; exit 64 ;;
  esac
  exit 0
fi

if [ "$name" = "copilot" ]; then
  case "${1-}" in
    --version) printf 'github-copilot 1.0.0 (fake CLI)\n' ;;
    --help) printf 'GitHub Copilot CLI (fake CLI)\n' ;;
    *) record "unexpected $*"; exit 64 ;;
  esac
  exit 0
fi

case "${1-}" in
  --version) printf '%s 1.0.0 (fake CLI)\n' "$name" ;;
  *) record "unexpected $*"; exit 64 ;;
esac
