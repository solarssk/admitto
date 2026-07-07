# Graph Report - layouts  (2026-07-06)

## Corpus Check
- 3 files · ~740 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 9 nodes · 6 edges · 3 communities (0 shown, 3 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `37e58b28`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_AdminShell.test.tsx|AdminShell.test.tsx]]
- [[_COMMUNITY_EventsListShell.test.tsx|EventsListShell.test.tsx]]
- [[_COMMUNITY_InstanceSidebarFoot.test.tsx|InstanceSidebarFoot.test.tsx]]

## God Nodes (most connected - your core abstractions)
1. `mockAssignments` - 1 edges
2. `sampleEvent` - 1 edges
3. `mockAssignments` - 1 edges
4. `mockAssignments` - 1 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Communities (3 total, 3 thin omitted)

## Knowledge Gaps
- **4 isolated node(s):** `mockAssignments`, `sampleEvent`, `mockAssignments`, `mockAssignments`
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What connects `mockAssignments`, `sampleEvent`, `mockAssignments` to the rest of the system?**
  _4 weakly-connected nodes found - possible documentation gaps or missing edges._