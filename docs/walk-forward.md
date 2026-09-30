# Walk-forward model report

Run `npm run backtest --prefix server` with configured prediction storage, or
`npm run backtest --prefix server -- /path/to/private-predictions.json` against a
local JSON array of prediction records. The command reads data and writes a
JSON report to stdout. It does not change picks, model weights, or production.

It scores recorded predictions in chronological order, separately by model
version and sport/market. A test day's calibration may use only outcomes
settled before that UTC day. The first 20 settled examples per model and
market are training history and are excluded from test metrics. Rows without
verified prices, probabilities, or valid settlement timing are counted under
`skipped`. Brier score and ROI use only the resulting held-out rows; the
market Brier reference uses the offered American odds, including vig.

This measures the existing recommendation selection, not hypothetical bets
on every available market. It cannot establish causal model superiority when
models saw different slates or prices. Chat wording and LLM tool reliability
are outside this model report and should be tested separately. Do not promote
a model based on small samples or this report alone.
