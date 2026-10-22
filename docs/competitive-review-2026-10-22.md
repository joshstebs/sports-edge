# SportsEdge competitive review, October 22, 2026

The comparison covers the competitors' public product/help pages, not authenticated paid accounts or independent accuracy testing.

| App and public source | Relevant workflow | SportsEdge implementation |
| --- | --- | --- |
| [Outlier player research](https://help.outlier.bet/en/articles/12556167-how-to-find-winning-nfl-player-props-using-outlier) | Centralizes prop hit rates, odds, injury context and market research. | Prop Research exposes the existing official game-log endpoint in the main authenticated navigation. Users inspect recent observations and test over/under lines with explicit pushes and sample counts. |
| [OddsJam price tools](https://oddsjam.com/betting-tools/positive-ev) and [no-vig calculator](https://oddsjam.com/betting-calculators/no-vig-fair-odds) | Makes the relationship between price and expected value visible. | Price Lab lets users test their own book's price against the stored model estimate. It displays break-even probability, probability-point edge and expected return. This is not automated line shopping or a no-vig consensus estimate. |
| [Action Network app](https://www.actionnetwork.com/app) | Brings odds, research and tracked activity together. | Today now provides direct research, desk and tracked-pick routes. Desk additions retain the matchup, event date, line and model provenance, and correctly reflect an already selected pick. No sportsbook account sync is added. |

## Product direction

Make SportsEdge recognizable as an evidence-led decision workspace: research the player, challenge the exact quote, retain the selection and review the outcome. Keep the established visual identity. The desk combines searchable recommendations with quote-age review cues and an expandable evidence receipt. None of these features is claimed to be exclusive across the industry.

## Code findings addressed

- The market-insights price resolver preferred game moneyline over the selection price. It now uses only the selection's stored odds, rejects malformed American prices, excludes unpriced/settled legs and retains the newest duplicate recommendation.
- Total-bases props were categorized as game totals. Market classification now uses specific total-market names.
- Today passed `game` while its receiver expected `matchup`. Both entry points now share one complete pick-to-slip converter.
- Event dates and provenance were dropped on add; duplicate indicators were always given an empty set. Both are corrected. Date-only event labels no longer shift to the previous day in Canadian time zones.
- Today's Parlays link opened chat. It now opens the slip destination.
- The experiences query bypassed the main authentication component and scanned every user's local slip keys. It now renders behind authentication and reads only the authenticated user's key.
- MLB research returned an opponent object where the UI needs a string. It now serializes the opponent name.
- MLB game-log caching ignored the requested window. The cache key now includes that limit so an earlier five-game request cannot truncate a twenty-game request.
- Compatible dependency patches address the advisories reported for `proxy-addr`, `ip-address` and `qs`. Full npm audits for both packages report zero known vulnerabilities after updating the lockfiles.

## Verification boundaries

Production requires sign-in. Local browser checks use a separate fixture build of the actual React components; fixture data and API substitution are outside the repository and are not part of the production build. These checks verify UI state transitions, not current provider availability or real production recommendations. Tests cover the actual MLB research route with controlled provider responses, odds math, push handling, market classification, freshness and pick identity.

Quote capture timestamps and book identities are not present in the existing top-edges API. Recommendation time is labeled honestly. Automatic live odds comparison and sportsbook sync require additional provider contracts and are outside this change.
