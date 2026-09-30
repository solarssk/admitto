# Counts review attempts that could have cost model tokens. Input: `gh run list --json
# databaseId,status,conclusion,startedAt,updatedAt`; arguments: $self (this run's id) and $settle
# (seconds a run spends in the debounce wait, the earliest point at which it can have moved on
# towards the reviewer).
#
# A run that failed after Claude spent turns costs as much as a successful one, so success,
# failure and timed_out all count, and so do runs still in progress or queued. A cancelled run is
# the awkward case: a newer push cancels an older run at any moment (cancel-in-progress), which is
# free while it is still in the debounce wait but not once the reviewer has started. The run list
# does not say which step was running, so a cancelled run counts when it lived longer than $settle:
# after that it may be in checkout, diff preparation or the reviewer itself. Counting a run that
# was still preparing only makes the limit trip a little early, never late, which is the safe side
# for a spend guard.
def lifetime: ((.updatedAt | fromdateiso8601) - ((.startedAt // .createdAt) | fromdateiso8601));

[.[]
  | select(.databaseId != $self)
  | select(.status == "in_progress" or .status == "queued"
      or .conclusion == "success" or .conclusion == "failure" or .conclusion == "timed_out"
      or (.conclusion == "cancelled" and lifetime > $settle))]
| length
