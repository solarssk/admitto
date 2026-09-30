# Counts review attempts that could have cost model tokens. Input: `gh run list --json
# databaseId,status,conclusion,startedAt,updatedAt`; arguments: $self (this run's id) and $settle
# (seconds a run needs before it can have reached the reviewer).
#
# A run that failed after Claude spent turns costs as much as a successful one, so success,
# failure and timed_out all count, and so do runs still in progress or queued. A cancelled run is
# the awkward case: a newer push cancels an older run at any moment (cancel-in-progress), which is
# free while it is still in the debounce wait but not once the reviewer has started. The run list
# does not say which step was running, so a cancelled run counts when it lived longer than $settle,
# which is the debounce wait plus checkout and diff preparation. Counting a little too much only
# makes the limit trip early, never late.
def lifetime: ((.updatedAt | fromdateiso8601) - ((.startedAt // .createdAt) | fromdateiso8601));

[.[]
  | select(.databaseId != $self)
  | select(.status == "in_progress" or .status == "queued"
      or .conclusion == "success" or .conclusion == "failure" or .conclusion == "timed_out"
      or (.conclusion == "cancelled" and lifetime > $settle))]
| length
