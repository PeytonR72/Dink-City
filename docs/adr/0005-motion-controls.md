# ADR-0005: Motion controls and Swing at Contact

Status: accepted (2026-10-15)

Control mode is client-only; the Sim never sees it. Keyboard remains the default. Offline Matches and Practice create the local Side as reported, with keyboard Contact filled by autoContact after both Intents exist. Online prediction preserves explicit contact (including false); undefined retains its existing quantized autoContact query. Bot Sides remain auto. Contact mode never changes during a Match, so replay and reconciliation retain their meaning (ADR-0004).

Motion uses Neutral Bot positioning through Observation, at hard move speed, with manual movement overriding it. Its early provisional Soft Commit supplies setup timing; a Swing supplies type, aim and Contact for six Ticks by default. Only a reported Side with contact on this Tick and an existing Commit may change type without changing the Commit tick or bestDistance. All other presses retain their original semantics. Serves remain plain shot presses. SIM_VERSION is 2.

Motion tuning is separate from simTuning. Depth is zero, switching is allowed during rallies. No physical-sensor accuracy or feel claim follows from synthetic tests.

Rejected: backswing-as-Commit (indirect), changing contactMode mid-Match (breaks re-simulation), and a Motion-only Sim quality curve (unnecessary special case). Phone timestamp age is bounded; swingLeadMs restores a bounded part of transport delay without rewinding offline time.

## Keyboard re-press compatibility

A keyboard type change on the exact Contact Tick otherwise has the same Intent as a Motion Swing: preserving timing for one and resetting it for the other is impossible without another bit. A generic optional recommit Intent flag explicitly requests a fresh Commit at Contact. Only the keyboard adapters produce it, when a different type is pressed on that Tick. The Sim still knows nothing about Control mode. The default reported-contact rule remains preserve timing, and all auto Sides retain their old behavior. The flag is recorded in replays and encoded as bit 8 in QIntent; PROTOCOL_VERSION is bumped to 9. This is the minimal compatibility extension needed to satisfy both requirements.
