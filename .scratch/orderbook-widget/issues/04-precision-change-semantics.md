# Precision Change Semantics

Type: grilling
Status: open
Blocked by: 01

## Question

When the user changes nSigFigs: resubscribe with a new precision (server-side rounding) vs keep one high-precision subscription and bucket client-side? Consequences for tick unit, ladder reset vs animated re-bucketing, persistence history (does level age survive a precision change?), and what the HUD shows during the switch.
