# Application Receipt Contract

The semantic candidate is immutable and always uses
`application_status:"planned"`. A verified authorized full rebuild does not
rewrite or relabel `stars-analysis.json`; it adds external applied-state
evidence. Missing application evidence means planned. Invalid supplied evidence
fails closed.

Keep these private files beside the semantic run:

- `stars-current-pre-write-state.json`: the complete GitHub state reread
  immediately before the first deletion;
- `application-preflight-validation.json`: the deterministic passing
  delete-first gate bound to that fresh state;
- `stars-lists-diff.json`: the exact frozen full-replacement diff;
- `stars-rebuild-recovery.json`: the mutable write-ahead journal finalized with
  `phase:"completed"` only after successful recovery-safe execution;
- `stars-final-state.json`: a fresh complete read of Stars, Lists, and List
  memberships after the mutations;
- `application-receipt.json`: the runner's immutable applied-state claim; and
- `application-validation.json`: the deterministic validation receipt.

The exact diff schema is
`{schema_version,account_login,generated_at,planned_candidate_sha256,
pre_write_state_sha256,desired_projection_sha256,remove_lists,create_lists,
restore_memberships}`. Remove entries preserve complete pre-write Lists;
creation entries use `{planned_list_id,name,description,kind}`; membership
entries use `{repository,planned_list_id}`. No unstar operation exists.

The recovery schema is
`{schema_version,account_login,captured_at,phase,planned_candidate_sha256,
exact_diff_sha256,pre_write,desired_projection_sha256,operation_journal}`.
The pre-write object contains the complete Star names and Lists. Journal entries
have contiguous sequence numbers plus `{occurred_at,operation_id,operation,
target,outcome,created_list_id}`. Allowed operations are `delete-list`,
`create-list`, `restore-membership`, and one `verify-final`, in that phase order.

Before mutation, the recovery artifact must use `phase:"prepared"` with an
empty journal. Freeze a fresh current-state file with the exact shape
`{schema_version:"1.0",account_login,captured_at,star_count,
starred_repositories,lists}`; its List shape is
`{list_id,name,description,repositories}`. Then run:

```text
node <tidy-my-stars-skill-directory>/scripts/validate-application-preflight.mjs \
  <semantic-and-application-run-directory> \
  <absolute-fresh-current-state.json>
```

This gate independently revalidates the semantic plan and receipt, requires
`stars-analysis.json` to equal `plan.candidate`, checks the exact diff and
prepared recovery hashes/projections, verifies the claimed account and
chronology, and requires the fresh state projection to exactly equal
`recovery.pre_write`. It writes private
`application-preflight-validation.json`. Missing, stale, symlinked, aliased,
incomplete, or post-write artifacts fail closed. Accept only exit zero, then
begin deletion immediately; a passing offline gate cannot prove GitHub state
remained unchanged after the reread. The receipt is deterministic and has no
self-claimed execution timestamp: rederivation proves the exact frozen gate
conditions and bindings, but offline validation cannot prove that the validator
actually ran before the first mutation. Retain live runner and authenticated API
logs when that execution-order fact matters.

The final state schema is
`{schema_version,account_login,verified_at,star_count,starred_repositories,
lists}`. Each final List has `{list_id,name,description,repositories}`. The
validator ignores replaceable remote List IDs when comparing semantics, but it
requires each ID to equal the completed create-operation ID for that exact
planned List identity.
The Star set must remain exact.

`application-receipt.json` schema 1.0 is:

```text
{schema_version,application_id,account_login,started_at,completed_at,
 status:"applied",
 authorization:{scope:"github-star-lists-full-rebuild",confirmed_at},
 bindings:{planned_candidate_sha256,semantic_validation_receipt_sha256,
           exact_diff_sha256,recovery_artifact_sha256,
           current_pre_write_state_sha256,
           application_preflight_validation_sha256,final_state_sha256,
           desired_projection_sha256},
 operation_summary:{deleted_lists,created_lists,restored_memberships},
 final_state:{verified_at,projection_sha256},limitations}
```

Run:

```text
node <tidy-my-stars-skill-directory>/scripts/validate-application-receipt.mjs <semantic-and-application-run-directory>
```

The gate independently revalidates the semantic run, exact candidate, semantic
receipt, diff, prepared preflight state and its exact passing receipt, completed
recovery journal, final state, chronology, account, operation counts, and
hashes. It reconstructs the prepared recovery artifact from the completed
journal and rejects a missing or forged preflight. It writes private
`application-validation.json`. It rejects
symlinked or aliased artifacts and removes stale success output on failure.
Chronology is exact: diff, recovery capture, the immediate current-state reread,
authorization confirmation, application start, journaled mutations and final
verification, then application completion. Every timestamp in the diff,
prepared/current state, completed journal, authorization, application receipt,
and final state must be no later than the validation clock plus the
five-minute clock-skew tolerance. A completed claim may not precede the final
verification it relies on.

State the limits honestly. Final validation preserves every preflight
limitation: it does not authenticate the claimed account or the pre-write read,
prove that read was fresh, prove remote state remained unchanged before the
first deletion, or prove the preflight validator actually ran before mutation.
It does not prove that the user granted the authorization claimed by the runner
or that external actions occurred. It additionally does not authenticate GitHub
final-state reads or mutation responses. The final limitation array is the
exact deduplicated union of those preflight and post-write disclosures; report
provenance and verification must preserve it without narrowing or paraphrasing.
Preserve live runner and authenticated API logs when those facts matter.
