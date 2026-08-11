# Likely Unstar Sensitivity

Sensitivity is the run-level threshold for adding repositories to the
user-decision queue. It is not a repository quality score, evidence confidence,
a ranking, or a target queue size.

Use the level selected by the user. Default to level 5. Lower levels produce a
narrower queue; higher levels produce a broader queue. Given the same evidence,
a repository that qualifies at one level also qualifies at every higher level.

A numeric selection is valid only when it is a whole-number level from 1
through 10. If the user explicitly supplies any other numeric value, do not
clamp, round, or default it. State `Likely Unstar sensitivity: invalid
(<value>). Choose a whole-number level from 1 to 10; 1 is narrow and 10 is
broad.` Obtain a valid level before continuing the run.

| Level | Include through this threshold |
|---:|---|
| 1 | Near-certain unstar: complete evidence leaves virtually no meaningful practical, learning, research, historical, reference, or distinctive value. |
| 2 | Strong recommendation: retention concerns decisively outweigh all demonstrated value. |
| 3 | Clear recommendation: retention concerns materially outweigh demonstrated value. |
| 4 | Lean unstar: retention concerns slightly outweigh demonstrated value. |
| **5** | **Baseline:** one concrete, defensible retention concern is enough, even when keeping remains slightly more likely. Include mixed, borderline, and tentative cases. |
| 6 | Also include a coherent combination of several individually weak concerns, even without one direct defect. |
| 7 | Also include one weak but specific evidence-based retention concern, even when demonstrated value clearly outweighs it. |
| 8 | Also include repositories whose demonstrated collection value is only marginal or highly conditional, even without a defect. |
| 9 | Also include repositories with no clearly demonstrated distinct collection value after complete evidence is exhausted. |
| 10 | Include every repository except those whose complete evidence clearly establishes strong retention value. |

The selected level changes only queue eligibility. It never changes evidence
collection, classification memberships, recommendation confidence, or the rule
that only the user may unstar.

At every level, give each queued repository a concrete reason grounded in its
complete evidence and collection context. Inactivity, low popularity,
superficial similarity, singleton status, ordinary security work, uncertainty,
inferred user disinterest, or shared List membership remains insufficient by
itself. A higher level does not turn those signals into automatic rules.
