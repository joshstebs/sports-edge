# SportsEdge integration plan

SportsEdge provides the signed-in workspace, analyst chat, prop research, and the picks ledger. Start with the single-user analytics workflow from the supplied memo.

1. Add a Research Workspace to SportsEdge. Read recent historical line movements from BetTrack's authenticated MCP analytics HTTP API. Display the matchup, market, movement size and time, with an action to ask the existing analyst about that snapshot.
2. Add BetIQ's 30-day closing-line value, model status and tracked bankroll as independent read-only cards. Use SportsEdge's admin session for access to the connected single-user services. Keep SportsEdge's existing picks ledger as the write path.
3. Add a unified, read-only ledger with the latest 50 records per source. Use source record IDs, the returned odds, and the available placement, submission or save timestamp. Review possible cross-source overlaps before considering a historical backfill. Show BetIQ’s native comparison on its own settled ticket cohorts.

## Sports Betting Supercenter

Open **Supercenter** to move between game odds, player research, edge analysis, model results, and your picks. The game board uses The Odds API if `ODDS_API_KEY` or `THE_ODDS_API_KEY` is set and returns upcoming events. ESPN provides a single-feed fallback. Book quotes are grouped by the same game, market, selection, and point value. Each threshold is compared separately.

Use **Compare quotes** to enter prices from two books for the same game and selection. Add your probability estimate for a break-even, edge, and expected-return comparison. Player research opens the same comparison when you enter a prop line. Historical hit rates are shown separately from the probability you enter. Admin users can open **BetTrack & BetIQ** for line movements, model analytics, and the connected history.

## Run the workspace locally

Install dependencies with `npm ci` and `npm ci --prefix server`. Configure SportsEdge's admin login as described in the main README. Start SportsEdge with `npm run dev`, sign in as an admin and select **Supercenter → BetTrack & BetIQ**.

Copy the integration variables from `server/.env.example` into `server/.env`. Run the BetTrack dashboard backend with PostgreSQL and its odds collection configured. Generate a dashboard API key scoped to your BetTrack user with the `stats` and `bets` permissions. Set `BETTRACK_URL` to the backend origin and `BETTRACK_API_KEY` to that key. Start BetIQ's FastAPI backend on a private interface and set `BETIQ_URL` to its origin. Use services reachable from the SportsEdge server. See the [BetTrack fork](https://github.com/joshstebs/BetTrack) and [BetIQ fork](https://github.com/joshstebs/BetIQ).

## Start with an empty ledger

A local SportsEdge server can record manual picks before the external services are connected. Set `SPORTS_EDGE_DATA_DIR` to a new directory and keep Redis unconfigured for that instance. Open **My Picks**, enter a selection and American odds, then save it as pending. Once the outcome is known, mark the pick as won, lost or push. Manual picks use the entered odds and manual grading.

## Ledger and comparison

In **Supercenter → BetTrack & BetIQ → Ledger & comparison**, filter the unified ledger by source and expand records to inspect individual selections. SportsEdge stores each saved leg independently. BetTrack and BetIQ supply ticket-level records. SportsEdge saves picks through the slip and shows their results in **My Picks** and **Results**.

The overlap review matches BetTrack and SportsEdge selections only when they share an Odds API-style event ID, a supported market (moneyline, spread or total), a selection name and any applicable line. Repeated wagers on the same selection can still be distinct tickets. BetIQ’s user history does not expose fixture IDs, so its tickets cannot be matched to the other sources reliably. The ledger displays recent records even when a different source is unavailable, and backfill requires validation against live history.

Choose a 7-, 30- or 90-day window for **You vs. the model**. The comparison uses BetIQ’s game dates and native cohort rules. It requests pregame user picks and excludes cash-outs. P&L reflects BetIQ’s recorded stake and profit, and the model side uses paper bets. The ledger’s source filter applies only to the history list.

## Player Prop Lab

Open **Model Lab → Player Prop Lab** as an admin. Scan a sport or a specific market to collect pregame prices and review the slate without an analyst API key. The scan also attempts to grade prior candidates. **Grade completed games** runs the bounded grader on demand.

The learning cohort uses half-point offers with a matching game, fresh SportsGameOdds price, and baseline model probability recorded before the game starts. Grading uses the matching game ID. Research thresholds stay available when the slate lacks priced offers.

Adjustments group outcomes by sport, market, side, and model version. SportsEdge fits a capped adjustment on earlier dates and applies it only if it lowers Brier score on separate later dates. Outcomes unavailable at the first later quote are excluded from training. The default model stays in use for thin or inconclusive samples. The comparison measures probability accuracy and does not claim a historical return.

SportsGameOdds pricing requires `SPORTSGAMEODDS_API_KEY`. Other price feeds still support the existing slate workflow. Their quotes are outside this learning cohort until SportsEdge can match them to an exact game.
