# SportsEdge product contract

Help a signed-in user research a specific sports market, inspect a recommendation's evidence and price, and retain its identity through the slip and results ledger.

## Core workflow

Today routes to Prop Research, the Edge Desk and tracked picks. Prop Research retrieves published MLB/ESPN game logs for a supported player market, displays up to 5/10/20 observations and evaluates a user-entered over/under line. Pushes are excluded from the historical hit-rate denominator and counted separately. Short samples show their actual size.

The Edge Desk searches and filters stored recommendations with a real selection price and positive model edge. Users can sort by edge, recommendation time or model sample size. A 15-minute recommendation-age warning is a review cue, not a claim about the actual quote age. A game moneyline must never substitute for a prop price.

Price Lab evaluates user-entered American odds for the same selection, using the stored probability. It is a hypothetical win/loss calculation that assumes no pushes. It neither fetches a live price nor modifies a saved selection. Historical hit rates and model probabilities are distinct.

## Invariants

- No recommendations, quotes, game logs, outcomes or availability checks may be fabricated.
- Preserve event date, matchup, line and model provenance when a desk recommendation enters the slip.
- Authentication and per-user local state apply to the experiences route as well as the main workspace.
- Keep provider failures visible. Do not silently replace unavailable research with sample data.
- Preserve the existing server availability, model and durable-write gates.
- No new subscriptions, data services or paid infrastructure are required for this change.
