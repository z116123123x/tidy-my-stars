# Stars Report Contract

`explain-my-stars` projects one frozen semantic analysis into a navigable
report. The implementation may change; facts, taxonomy, reasons, and
recommendations may not.

## Contents

- Input
- Semantic invariants
- Information architecture
- Interaction and writing
- Accessibility and responsive behavior
- Safety and runtime
- Output and verification

## Input

`stars-analysis.json` uses `schema_version: "1.0"` and contains:

| Field | Required meaning |
| --- | --- |
| `generated_at` | ISO-8601 time when the analysis was frozen |
| `locale` | BCP 47 language tag for interface selection and formatting |
| `account` | GitHub login and complete Star count |
| `run` | sensitivity 1-10, analysis status, and GitHub application status |
| `lists` | unique route-safe IDs, names, descriptions, and `classification` or `review-queue` kind |
| `repositories` | every Star once, with canonical GitHub identity and description when available |
| `memberships` | exact List ID and a distinct reason for that repository-List relationship |
| `unclassified_reason` | required when no classification membership exists |
| `validation` | coverage status, semantic review status, and honest notes |

The file contains at most 31 classification Lists and exactly one review queue.
List IDs contain letters or digits separated only by `.`, `_`, or `-`.
`account.star_count` equals the repository count. Every membership points to a
declared List and has a nonblank reason. A queue-only repository still requires
`unclassified_reason`.

The analysis is accepted only with its complete semantic run directory. The
report system independently revalidates `semantic-plan.json`, frozen sources,
`collection-receipt.json`, `execution-receipts.json`, and
`semantic-validation.json`; the supplied analysis must be exactly the plan's
`candidate` and match its canonical SHA-256. The receipt is evidence only after
it exactly matches a freshly derived passing receipt. The report handoff is a
pre-write candidate and therefore requires `application_status: "planned"`.
That field never changes. Optional applied state comes only after deterministic
revalidation of the complete sibling artifact set:
`stars-lists-diff.json`, finalized `stars-rebuild-recovery.json`,
`stars-current-pre-write-state.json`, `application-preflight-validation.json`,
`stars-final-state.json`, `application-receipt.json`, and
`application-validation.json`. All seven must bind the same planned candidate.
Missing application evidence means planned; malformed or incomplete supplied
evidence is rejected.

## Semantic invariants

- Input List names and descriptions, repository identities, memberships,
  reasons, sensitivity, recommendation eligibility, and validation notes are
  authoritative and immutable.
- Overlap is intentional when each List provides an independently useful path.
- The review-queue reason is the AI rationale for human review. It never removes
  supported classifications and never means an unstar happened.
- Sensitivity is one run-level inclusion threshold: 1 is narrow and 10 is
  broad. It is not quality, confidence, rank, or a target queue size.
- Partial analyses are rejected. Refresh or finish `tidy-my-stars` before
  reporting.
- A self-declared `validation.semantic_review: "passed"`, an unbound analysis,
  or a sidecar receipt that was not independently rederived is rejected.
- Do not enrich the report with newer GitHub facts. Rerun `tidy-my-stars` and
  rebuild when current facts are required.
- Applied-state metadata may show only the validated receipt status and hashes;
  it may not replace Lists, memberships, reasons, or any candidate byte.
- The report loads one generated, schema-checked provenance document bound to
  the exact candidate bytes and validated handoff. It visibly preserves every
  semantic offline-validation limitation. When an application receipt exists,
  it also preserves the exact complete application limitation array: every
  preflight limitation plus each post-write limitation, with no duplicates or
  paraphrased omissions. It describes `applied` only as a validated external
  receipt claim, never as an authenticated live GitHub fact. Without that
  receipt, the report clearly remains planned.

## Information architecture

The result is a collection explorer, not one long report. It provides durable,
reloadable destinations for:

- a compact overview with exact counts and starting paths;
- an explicit site map and global repository, List, and reason search;
- classification List directory and detail views;
- repository directory and canonical detail views with every exact reason;
- Likely Unstar queue and one-item human-review views;
- methods, limitations, export, and a complete print projection.

Navigation, filters, and selected records survive reload and Back/Forward when
the chosen system supports browser history. Search and every primary
destination stay one action away. Long collections use pagination,
virtualization, or bounded views without truncating matches.

Charts show exact values, provide a text equivalent, and never imply repository
quality or rank. On mobile, omit redundant summaries before repeating data.

## Interaction and writing

- Match the interface to the analysis locale. English and Traditional Chinese
  are the bundled system's supported languages; another system must provide an
  honest fallback. Never translate repository names, List names, or reasons.
- Lead with the user's task and concrete conclusion. Distinguish source fact,
  AI judgment, and user decision; preserve uncertainty.
- Search normalized literal content first, including one-character CJK
  queries. Never execute user input as a regular expression or code.
- Review decisions are report-local and namespaced by account plus frozen run.
  Keep, decide later, consider unstar, and clear are explicit states.
- CSV exports neutralize spreadsheet-formula prefixes. JSON export preserves
  the validated structured analysis.

## Accessibility and responsive behavior

Use semantic landmarks, headings, lists, links, buttons, labels, and controls.
Provide a working skip control, one `h1`, logical heading order, visible focus,
route-change focus and scroll reset, live result counts, non-color state cues,
at least 4.5:1 text contrast, reduced-motion and forced-colors support, and
44px touch targets.

Long identities preserve bidirectional text, shrink correctly, and wrap
without causing horizontal overflow. Mobile navigation never hides
destinations in an unmarked scroller. Print includes every repository,
membership reason, and unclassified reason independently of screen filters.

## Safety and runtime

Treat every input string as untrusted text. Never place source data in raw HTML,
dynamic code, unsafe URLs, inline event handlers, or executable templates.
Allow GitHub links only after the analysis validator confirms the exact
canonical HTTPS identity.

Bundle required report assets locally unless the user explicitly authorized a
different connected delivery environment. Do not add analytics or make live
GitHub requests. The report contains no credentials and never writes GitHub.

Treat the analysis, semantic run and its source evidence and receipts, generated
site, verification receipt, browser evidence, and review decisions as private
per-run data. Keep created artifacts outside tracked, public, or synced
locations whenever possible. Use `0700` generated directories and `0600`
generated files on POSIX, or equivalent current-user-only access controls on the
active platform. Inside a Git worktree, verify the intended paths are ignored
and remain untracked before writing; move the run when they are not.

Preview only through an explicit loopback bind such as `127.0.0.1` or `::1`.
Refuse an all-interface bind, public tunnel, sync, publish, or deploy unless the
user separately confirms publication after reviewing the exact data that will
be exposed. Selecting a report system or asking to build or preview is not
publish authorization.

## Output and verification

Every run replaces only a previously generated artifact belonging to the same
implementation. Never erase an unmarked, user-owned output.

Deliver the report artifact plus a machine-readable receipt that records the
chosen implementation and binds the exact input, semantic candidate, semantic
plan, collection receipt, execution-receipts envelope, semantic-validation
receipt, the complete deterministically revalidated seven-file applied artifact
set when supplied, and final output by SHA-256.
At minimum, the receipt contains `schema_version`, overall `status`, an
`implementation` identity, input SHA-256, output SHA-256 and file inventory
when the output is a directory, named checks, and overall `limitations`. Hash a
single-file artifact from its exact bytes. Hash a directory from its sorted
relative paths and each file's SHA-256 so the value can be independently
recomputed. Output names may follow the chosen system; do not reuse another
implementation's receipt schema without identifying the difference.
Verification covers:

- complete semantic handoff, input schema, and exact candidate/data identity;
- generated provenance identity, schema, hashes, claim basis, and complete
  semantic and optional application limitations;
- a fresh deterministic rebuild or equivalent implementation projection;
- output structure, destinations, local assets, and security boundaries;
- the exact rendered browser experience on desktop and mobile;
- visual layout, printing, keyboard use, and accessibility.

Each check records `passed`, `failed`, or `not-run`, the method, evidence, and
limitations. Use `failed` for an observed defect and `not-run` only for an
unavailable capability. Overall `passed` requires every deterministic and
runtime check. Deterministic success without rendered QA is
`passed-with-limitations`, not a release pass.
