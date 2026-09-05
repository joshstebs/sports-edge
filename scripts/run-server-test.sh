#!/usr/bin/env bash
# Launch the SportsEdge API locally for E2E testing with the full LLM key set.
# server/.env is loaded by the server itself (dotenv/config); this script only
# injects the LLM keys that live in ~/.hermes/.env (mirroring Vercel prod env).
HERMES_ENV="$HOME/.hermes/.env"
if [ -f "$HERMES_ENV" ]; then
  # Values are plain single tokens; strip any quote characters defensively.
  eval "$(grep -E '^(export )?(OPENCODE_GO_API_KEY|OPENCODE_ZEN_API_KEY|OPENROUTER_API_KEY|GROQ_API_KEY)=' "$HERMES_ENV" | sed 's/^export //' | tr -d '"' | tr -d "'" | sed 's/^/export /')"
fi
echo "keys: GO=${OPENCODE_GO_API_KEY:+set} ZEN=${OPENCODE_ZEN_API_KEY:+set} GROQ=${GROQ_API_KEY:+set} OR=${OPENROUTER_API_KEY:+set}"
cd /home/ubuntu/sports-edge/server
exec node --import tsx src/server.ts
