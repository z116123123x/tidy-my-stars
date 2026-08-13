# Full-Rebuild Recovery

A GitHub List rebuild is not transactional. Prepare a durable write-ahead
artifact before deleting any List so an interrupted run can be resumed or the
previous semantic state can be recreated.

Recovery is best effort, not a guarantee. Before requesting or accepting write
authorization, tell the user that the delete-first rebuild can end in a
`critical-partial` state when API availability, permissions, schema changes, or
connectivity prevent both completion and restoration. The journal preserves
the evidence needed to recover; it cannot make GitHub mutations transactional
or recreate the original List IDs.

## Prepare before mutation

Write `stars-rebuild-recovery.json` atomically in the user's task directory.
Use the exact canonical schema:

```text
{schema_version:"1.0",account_login,captured_at,phase,
 planned_candidate_sha256,exact_diff_sha256,pre_write,
 desired_projection_sha256,operation_journal}

pre_write = {
  star_count,
  starred_repositories:[full_name],
  lists:[{list_id,name,description,repositories:[full_name]}]
}

journal_entry = {
  sequence,occurred_at,operation_id,
  operation:"delete-list"|"create-list"|"restore-membership"|"verify-final",
  target,outcome,created_list_id
}
```

Before mutation, `phase` is exactly `"prepared"` and `operation_journal` is
empty. The post-write applied-state validator accepts only the same artifact
advanced to `phase:"completed"` with the complete verified journal.

`pre_write` is the complete recovery source for the old semantic state. Do not
add repository node IDs or a second desired snapshot to this journal. The
complete desired List and membership plan lives in the sibling frozen
`stars-lists-diff.json`; `exact_diff_sha256` binds that file and
`desired_projection_sha256` binds the candidate-derived desired projection.
The append-only operation journal begins after capture and uses contiguous
sequence numbers.

Validate that the pre-write Star and List snapshots are complete, List IDs and
names are unique, every membership references a captured Star, both hashes bind
the exact frozen diff and candidate projection, and the journal is initially
empty. Re-read GitHub immediately before the first deletion. If it differs from
`pre_write`, stop before mutation and regenerate the analysis, exact diff, and
recovery artifact.

Freeze the immediate reread as `stars-current-pre-write-state.json` and run
`validate-application-preflight.mjs` exactly as specified in
`application-receipt-contract.md`. Accept only its exit-zero
`application-preflight-validation.json`. This binds the exact semantic
candidate, diff, prepared recovery artifact, and fresh state before the first
destructive request.

The recovery file is private user data. Keep it inside the private per-run
directory but outside generated report output, use file mode `0600` on POSIX or
equivalent current-user-only access controls, and never sync or publish it
automatically.

## Apply and checkpoint

Set the phase to `deleting`, then perform the authorized full rebuild. Update
the artifact atomically after every confirmed mutation and at the transitions
to `creating`, `restoring-memberships`, and `verifying`. Do not infer remote
state from the journal alone; re-read GitHub before every resumed operation.

Make retries idempotent against semantic state. A deleted List ID cannot be
recreated, so compare names, descriptions, and complete memberships rather
than requiring old IDs.

## Recover an interrupted rebuild

After any failure following the first deletion, diagnose the concrete error and
use the journal plus freshly read remote state to attempt to resume the desired
rebuild or restore the pre-write semantic state. Prefer completing the already
authorized desired rebuild. If that is no longer possible but writes remain
available, attempt to recreate all previous List names, descriptions, and
memberships from the pre-write snapshot.

Verify whichever complete state was recovered and record `completed` or
`restored`. If permissions, schema, or connectivity make both paths impossible,
record `critical-partial`, preserve the recovery artifact, report the exact
remote state and blocker, and never claim the apply succeeded. No recovery path
may unstar a repository or exceed the granted List-write scope.

Only `completed` can support an applied-state receipt. `restored` means the
desired rebuild was not applied, and `critical-partial` is a failure. After a
completed rebuild, preserve the full applied handoff together:
`stars-lists-diff.json`, finalized `stars-rebuild-recovery.json`,
`stars-current-pre-write-state.json`, `application-preflight-validation.json`,
`stars-final-state.json`, `application-receipt.json`, and the derived
`application-validation.json`, as specified by the already-loaded
`application-receipt-contract.md`. Do not put the application receipt inside
this journal: the journal is mutable during recovery and contains the complete
private pre-write state, while the receipt is an immutable hash-bound claim
about one verified outcome.
