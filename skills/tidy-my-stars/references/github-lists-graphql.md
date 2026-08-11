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

Keep repository node IDs, List IDs, names, descriptions, and memberships in
the read-only plan. Re-read this state immediately before an authorized write.

## Full rebuild

Before mutation, persist and validate the complete pre-write and desired states
plus an operation journal as required by the skill's recovery contract. Then,
after authorization, apply the frozen plan in order:

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
