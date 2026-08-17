# Odds and Model Strategy (2026-08-17)

## Odds
- The Odds API free tier = team markets only (h2h, spreads, totals). Legit and keyed.
- Player props use model-generated lines with an honest "historical estimate" label (never claim +EV without a market line). Free and resilient.
- Upgrading ODDS_API_KEY to a Business-tier key auto-enables real prop markets (getEventProps already supports markets=player_props). No code change needed.
- Do NOT add fragile scrapers (PrizePicks/DK WAF-block datacenter IPs; ToS gray). The free-tier + model-line fallback is the correct design.

## Model cascade (chatClient.ts)
Primary: Gemini (GEMINI_MODEL, default gemini-3.5-flash) → lite fallbacks.
Fallback: OpenRouter (gpt-oss-20b:free → nemotron-3.5-lightning:free → ...) — enabled when OPENROUTER_API_KEY is set on Vercel.
Last resort: OpenAI (openaiKey).

All fallback models verified live on OpenRouter (2026-08-17). PRINT KEY 0600: adds OPENROUTER_API_KEY to SportsEdge prod.
