# GitHub Lists through GraphQL

Use this reference only when the available GitHub interface does not expose
Star Lists directly and authenticated GraphQL access is available. GitHub's
schema can change; inspect the live schema before writing.

## Check capability

Confirm that the authenticated account can read Lists and that the current
schema exposes the needed create, delete, and membership-update operations.
If it does not, use another authenticated GitHub interface or stop before
writes. Do not guess a mutation.

## Read completely

Read and paginate:

- the authenticated user's Lists;
- every List's items; and
- the user's complete Stars inventory.

The live interface may retain repository node IDs operationally while issuing
GraphQL requests. Canonical private artifacts use the exact documented shapes:
the pre-write recovery snapshot stores repository `full_name` values plus List
IDs, names, descriptions, and memberships; the desired projection lives in
`stars-lists-diff.json`, not as a second recovery snapshot. Re-read the complete
canonical pre-write state immediately before an authorized write.

## Full rebuild

Before mutation, persist the complete pre-write recovery state, frozen desired
diff, and empty prepared journal required by the recovery contract. Run the
application preflight against a fresh complete reread and accept only its
passing `application-preflight-validation.json`. Then, after authorization,
apply the frozen plan in order:

1. Delete every current List and verify that no old List remains.
2. Create every new List and record its new ID.
3. Set each repository's complete desired set of new List IDs.
4. Re-read Lists and memberships and compare them with the plan.

Never unstar a repository. Never infer success solely from a mutation response.
Checkpoint every confirmed mutation. After a failure following the first
deletion, re-read the remote state and use the journal to finish the desired
rebuild or recreate the complete pre-write semantic state. If neither is
currently possible, preserve the artifact and report the exact critical partial
state rather than claiming success.

A completed applied handoff requires all seven private artifacts:
`stars-lists-diff.json`, finalized `stars-rebuild-recovery.json`,
`stars-current-pre-write-state.json`, `application-preflight-validation.json`,
`stars-final-state.json`, `application-receipt.json`, and
`application-validation.json`. Never infer or omit one from API responses.
