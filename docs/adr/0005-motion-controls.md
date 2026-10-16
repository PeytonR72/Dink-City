# ADR-0005: Motion controls and Swing at Contact

Status: accepted (2026-10-15)

Control mode is client-only; the Sim never sees it. Keyboard remains the default. Offline Matches and Practice create the local Side as reported, with keyboard Contact filled by autoContact after both Intents exist. Online prediction preserves explicit contact (including false); undefined retains its existing quantized autoContact query. Bot Sides remain auto. Contact mode never changes during a Match, so replay and reconciliation retain their meaning (ADR-0004).

Motion uses Neutral Bot positioning through Observation, at hard move speed, with manual movement overriding it. Its early provisional Soft Commit supplies setup timing; a Swing supplies type, aim and Contact for exactly one input Tick (revised 2026-10-16 after physical playtest feedback). Only a reported Side with contact on this Tick and an existing Commit may change type without changing the Commit tick or bestDistance. All other presses retain their original semantics. Serves remain plain shot presses. SIM_VERSION is 2.

Motion tuning is separate from simTuning. Depth is zero, switching is allowed during rallies. No physical-sensor accuracy or feel claim follows from synthetic tests.

Rejected: backswing-as-Commit (indirect), changing contactMode mid-Match (breaks re-simulation), and a Motion-only Sim quality curve (unnecessary special case). Phone timestamp age is bounded, but no lead, future scheduling, contact window or phone-timestamp rewind is applied. A fresh received Swing is consumed on the next input sample whether it hits or misses. Network age up to 400 ms remains an input-validity limit, not a duration during which Contact is held. The existing online tick-stamped prediction/rewind protocol is unchanged: one reported Tick can be reconciled, never searched forward for a later hit.

## Keyboard re-press compatibility

A keyboard type change on the exact Contact Tick otherwise has the same Intent as a Motion Swing: preserving timing for one and resetting it for the other is impossible without another bit. A generic optional recommit Intent flag explicitly requests a fresh Commit at Contact. Only the keyboard adapters produce it, when a different type is pressed on that Tick. The Sim still knows nothing about Control mode. The default reported-contact rule remains preserve timing, and all auto Sides retain their old behavior. The flag is recorded in replays and encoded as bit 8 in QIntent; PROTOCOL_VERSION is bumped to 9. This is the minimal compatibility extension needed to satisfy both requirements.

## Physical playtest revision, 2026-10-16

The user reported roughly one successful swing in twelve and requested exact swing timing. The previous six-Tick window both queued early hits and lost all Contact ticks when detection plus transport age exceeded 100 ms. Removing that window fixes both behaviors without widening ball reach. Early Soft preparation stays solely for positioning and shot-quality setup; it never asserts Contact. Duplicate/older timestamps and cancelled events cannot revive a consumed swing.

Recognition is modestly relaxed: peak 100 -> 85 degrees/second, required peak fall 35% -> 20% (ratio .65 -> .8). Drive 330 degrees/second, Lob 22 degrees, 400 ms cooldown and half-threshold settling remain. Retain the quiet rearm sample as the baseline for the next short gesture. Synthetic tests are not physical-phone accuracy evidence.
