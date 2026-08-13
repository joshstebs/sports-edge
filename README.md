# SportsEdge — AI Betting Analyst

A sports analytics chat platform where an AI betting analyst answers matchup, prop, and Same Game Parlay (SGP) questions with **real live data** — never fabricated numbers.

## Stack
- **Backend** (`server/`, port 3100): Express + TypeScript. LLM chat with function-calling tools that pull live data on demand.
- **Frontend** (`client/`, port 5180): React 19 + Vite + Tailwind v4. ChatGPT-style chat with markdown, tool-provenance chips, structured SGP leg cards, AI grades, EV chips, and a Parlay Slip with combined odds.

## Data sources (all real, all labeled)
| Source | What it provides | Key |
|---|---|---|
| statsapi.mlb.com | Player search, season stats, game logs, schedule, lineups | none |
| baseballsavant.mlb.com | xwOBA / xBA / xSLG, barrel%, hard-hit% (2026 CSVs) | none |
| site.web.api.espn.com | NFL/NBA rosters + gamelogs, team efficiency, news, **DraftKings odds** (via summary payload) | none |
| api.open-meteo.com | Game-time weather + 30-park venue table | none |
| api.the-odds-api.com | Multi-book odds (FanDuel, Bet365, BetMGM...) | `ODDS_API_KEY` (optional) |
| LLM (Gemini/OpenAI) | Chat brain — tool-calling agent | `GEMINI_API_KEY` or `OPENAI_API_KEY` |

## Predictive engine
Empirical **P(over) at half-lines** computed from real game logs (Beta-shrunk `(hits+1)/(n+2)`, last 15 games for batters / 10 starts for pitchers):
- Always-X.5 lines (no pushes), grade A ≥ .65 / B ≥ .58 / C ≥ .5 / D < .5 (D = no edge, skip)
- Edge tier from |P − 0.5|: elite / high / mid / low
- Coefficient of variation (consistency) + form trend per prop
- Everything derived from real stats — the bot cannot invent numbers (tools return `available:false` and it says so)

## Pick ledger & self-learning loop
- **Pick ledger**: `POST /api/ledger` saves SGP legs; `POST /api/ledger/:id/result` marks won/lost/push; `GET /api/ledger` returns ROI + win rate computed from **real odds** (flat 1-unit stakes). Stored in `server/data/ledger.json` (gitignored).
- **Self-learning predictions**: every pick the analyst makes appends a `[PREDICTION_LOG]` JSON block that the backend extracts and stores (`server/data/predictions.json`). A daily **6 AM cron** (`scripts/evaluate.ts`, wired to Telegram via Hermes cron) grades each pending pick against the official statsapi box score for the game on the pick's own date, computes hit rate / ROI / per-market calibration, and writes **adaptive learning rules** (`data/learning.json`) that get injected into the system prompt at chat time — the analyst literally learns from its own tracked results. Silent when there are no picks to grade.

## Model fallback chain
The chat brain rotates through models when one is unavailable (Gemini free-tier quotas are per-model):
`gemini-3.5-flash` → `gemini-flash-latest` → `gemini-2.5-flash-lite` → (if `OPENAI_API_KEY` set) `gpt-4o-mini`.
Set `GEMINI_MODEL`/`OPENAI_MODEL` in `server/.env` to override the primary. Also registered as a Windows user environment variable (`GEMINI_API_KEY`) — the server reads the env var first, then `server/.env`.

## Setup
```bash
# 1. Install
cd server && pnpm install
cd ../client && pnpm install

# 2. Add your LLM key (chat needs it)
cp server/.env.example server/.env   # then edit: GEMINI_API_KEY or OPENAI_API_KEY

# 3. Run (root convenience script)
pnpm dev        # backend :3100 + frontend :5180 (Vite proxies /api)
```

## Chat API
`POST /api/chat` `{messages:[{role,content}], sport?: "mlb"|"nfl"|"nba"}` → SSE stream of `meta`, `tool`, `delta`, `sgp`, `done`, `error` events. When the user asks for a parlay, the model emits a ` ```sgp ``` ` JSON block that the backend parses into structured leg cards.

## Roadmap
- Walk-forward backtest harness for the predictive engine (per-fold ROI/Yield, consensus-odds baseline)
- Auto-settle ledger picks from box scores
- Kelly sizing + bankroll tracker

*For entertainment only. Sports betting involves risk. Fractional unit sizing is encouraged.*
