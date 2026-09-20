# Engine Architecture

Type: grilling
Status: open
Blocked by: 01

## Question

Pin down the book engine's internals before ADRs:
- Diff algorithm across two book pushes: level identity (price tick), classification into lifecycle events (added / grew / shrank / vanished / consumed / cancelled) using trades that arrived since the previous push; handling of levels that scroll out of the 20-level window (vanished vs out-of-window).
- Persistence and resiliency bookkeeping: what state per price is retained after a level vanishes, and for how long.
- Connection state machine: transitions, staleness threshold, resubscribe/resync behaviour, what the engine emits on each transition.
- Engine API shape: input events, output (current book, lifecycle events, metrics), how presentation samples it without copying (e.g. typed arrays vs object graphs), and how the boundary would move to a Worker later.
