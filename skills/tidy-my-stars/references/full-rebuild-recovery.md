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
Include:

- `schema_version`, account login, capture time, and current phase;
- the SHA-256 of the exact validated `stars-analysis.json` plan;
- every pre-write List ID, name, description, and complete repository
  membership, with repository identities and node IDs;
- every desired List name, description, kind, and complete repository
  membership, with repository identities and node IDs; and
- an append-only operation journal with timestamps, operation identity,
  outcome, and any newly created List ID.

Validate that List identities are unique, all memberships reference captured
Stars, and both snapshots are complete. Re-read GitHub immediately before the
first deletion. If it differs from the pre-write snapshot, stop before mutation
and regenerate the analysis, exact diff, and recovery artifact.

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
