# SportsEdge — AI Betting Analyst

A sports analytics chat platform where an AI betting analyst answers matchup, prop, and Same Game Parlay (SGP) questions with **real live data** — never fabricated numbers.

## Stack
- **Backend** (`server/`, port 3100): Express + TypeScript. Authenticated LLM chat with function-calling tools that pull live data on demand.
- **Frontend** (repository root, port 5180): React 19 + Vite + Tailwind v4. ChatGPT-style chat with markdown, tool-provenance chips, structured SGP leg cards, AI grades, EV chips, and a persistent Parlay Slip with combined odds.
- **Voice**: browser-native microphone dictation fills the composer, completed analyst replies include a read-aloud/stop control, and **Call SportsEdge** runs a continuous hands-free conversation that automatically listens, sends the transcript through the same grounded chat route, reads the validated answer aloud, and returns to listening. Unsupported browsers fall back to text without breaking chat; audio is not uploaded to the SportsEdge server.

## Grounded agent runtime
- Tool calls emitted in the same model turn execute **in parallel**, cutting avoidable latency when a request needs stats, odds, lineup, weather, news and availability together.
- Every tool result is enriched server-side with `_evidence`: source labels extracted from the real provider payload, fetch timestamp, measured latency and a `verified-live` / `available-unlabeled` / `unavailable` quality flag.
- Tool failures stay isolated and fail closed. One unavailable provider does not discard successful sibling evidence and never becomes a fabricated value.
- Tool results are appended back into LLM history in their original model-call order, preserving deterministic tool-call semantics while the underlying network work runs concurrently.
- The existing availability gate, positive-edge model gate, prediction ledger and evaluation loop remain authoritative and unchanged.

## Data sources (all real, all labeled)
| Source | What it provides | Key |
|---|---|---|
| statsapi.mlb.com | Player search, season stats, game logs, schedule, lineups | none |
| baseballsavant.mlb.com | xwOBA / xBA / xSLG, barrel%, hard-hit% (2026 CSVs) | none |
| site.web.api.espn.com | MLB/NFL/NBA/NHL rosters, injury reports, gamelogs where available, team efficiency, news, **DraftKings odds** (via summary payload) | none |
| api.open-meteo.com | Game-time weather + 30-park venue table | none |
| api.the-odds-api.com | Multi-book odds (FanDuel, Bet365, BetMGM...) | `ODDS_API_KEY` (optional) |
| LLM (Gemini/OpenAI) | Chat brain — tool-calling agent | `GEMINI_API_KEY` or `OPENAI_API_KEY` |

## Predictive engine
The deterministic `player_prop_model` supports MLB, NFL, NBA, and NHL player markets. It requires the exact sportsbook side and line, runs the live availability gate first, and derives probability from 5–20 official recent game records:

- Beta(2,2) shrinkage for non-push lines; Dirichlet smoothing keeps over/under/push separate on integer lines
- Missing fields or insufficient history return `available:false`—never a fabricated probability
- A bet recommendation requires a non-D grade plus verified odds with positive modeled edge
- Model probability, version, sample size, and source overwrite any LLM-authored values before a leg can reach the slip or prediction history
- Settled outcomes recalibrate each sport/market/model cohort only after at least 20 verified picks

## Pick ledger & self-learning loop
- **Availability safety gate**: every player prop is checked server-side against the current active roster and ESPN injury report before it can reach the slip or prediction log. Injured, inactive, questionable, unknown, or unverifiable players fail closed. MLB also requires a confirmed batting order or probable pitcher for the resolved game.
- **Pick ledger**: the slip is independent of chat state and persists per signed-in user. `POST /api/ledger` saves all newly added legs idempotently (`idempotencyKey` prevents retry duplicates); `POST /api/ledger/:id/result` marks won/lost/push; `GET /api/ledger` returns ROI + win rate computed from **real odds** (flat 1-unit stakes). Official prediction results also auto-settle matching pending slip legs.
- **Self-learning predictions**: every trusted server-generated pick appends a structured `[PREDICTION_LOG]` block. The daily Vercel Cron (`GET /api/evaluate`, protected by `CRON_SECRET`) grades a bounded batch against final official MLB box scores and official ESPN NFL/NBA/NHL game logs, retries provider/not-final failures, excludes unsupported or ambiguous legs, and rebuilds calibration from the full settled history. Only samples of at least 20 verified picks can produce confidence-adjustment rules.
- **Persistence**: local development uses atomic files under `server/data`. Vercel requires `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`; stateful writes fail closed with HTTP 503 when durable storage is absent, rather than falsely succeeding in ephemeral `/tmp`.

## Model fallback chain
The chat brain rotates through models when one is unavailable (Gemini free-tier quotas are per-model):
`gemini-3.5-flash` → `gemini-flash-latest` → `gemini-2.5-flash-lite` → (if `OPENAI_API_KEY` set) `gpt-4o-mini`.
Set `GEMINI_MODEL`/`OPENAI_MODEL` in `server/.env` to override the primary. Also registered as a Windows user environment variable (`GEMINI_API_KEY`) — the server reads the env var first, then `server/.env`.

## Authentication

SportsEdge uses signed, HttpOnly, Secure, SameSite=Strict session cookies. Passwords are stored as scrypt hashes, never plaintext. Admin and tester histories are isolated by user ID.

Generate the initial accounts locally; the two passwords print once to the terminal:

```bash
npm run auth:generate --prefix server -- --admin josh-admin --tester sportsedge-test > .env.auth
```

Copy the generated `AUTH_USERS_JSON` and `AUTH_SESSION_SECRET` values into the local environment and the Vercel project environment. In the Vercel dashboard, paste the raw value after `=` and omit the dotenv-only outer single quotes. Set `APP_ORIGIN` to the exact deployed HTTPS origin (for example, `https://sports-edge-kohl.vercel.app`). `.env.auth` is ignored by Git. Rotate either password by re-running the generator and replacing both environment values.

## Setup
```bash
# 1. Install the frontend and backend dependencies
npm ci
npm ci --prefix server

# 2. Configure auth, durable storage and an LLM key
cp server/.env.example server/.env
# Edit server/.env. For local development, paste the generated .env.auth values.
# Vercel additionally requires APP_ORIGIN, Upstash REST credentials and CRON_SECRET.

# 3. Run (root convenience script)
npm run dev        # backend :3100 + frontend :5180 (Vite proxies /api)

# 4. Verify before publishing
npm run build
npm run build:server
npm test
```

The same install, build, and test sequence runs automatically in GitHub Actions for every pull request into `master` and every push to `master`.

## Chat API
`POST /api/chat` `{messages:[{role,content}], sport?: "mlb"|"nfl"|"nba"|"nhl"}` → SSE stream of `meta`, `tool`, `delta`, `sgp`, `log`, `done`, `error` events. Auth is required. When the user asks for a parlay, the model emits a ` ```sgp ``` ` JSON block that the backend validates, availability-checks, and parses into structured leg cards.

## Roadmap
- Walk-forward backtest harness for the predictive engine (per-fold ROI/Yield, consensus-odds baseline)
- Expand supported market coverage as stable league-specific box-score fields become available
- Kelly sizing + bankroll tracker
- Optional Mastra adapter after the current runtime has a stable evidence contract; framework migration is intentionally separate from the merge-safe agent/data-quality work

*For entertainment only. Sports betting involves risk. Fractional unit sizing is encouraged.*