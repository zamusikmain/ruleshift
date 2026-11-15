# Personal player progress

Progress lives in `ruleshift.profile.v1` in browser localStorage, under optional
`progression`. Missing data migrates without removing identity, old achievements
or aggregate stats. Known Survival and Daily records migrate; historical Classic,
Blitz, Chaos and Online modes cannot be inferred from legacy aggregate totals.
No historical XP is invented. Disabled storage falls back to memory.

The profile shows five Offline record tables, four Online mode rows, level/XP,
17 achievements (8 preserved, 9 added) and local Daily medals. All UI is RU/EN.
Wide tables scroll inside their container. Notices use a bounded queue (5) and
Low/Medium/High intensity without particle systems or new libraries.

Online stats are applied only from authoritative Worker snapshots: completed
results, or a server-marked forfeiture. Client messages cannot submit scores,
winners or XP. The identity key is room code plus server-issued participant ID;
a persisted highest match number deduplicates snapshots, reconnect and Rematch.
Each actual new Rematch is a new match, not a free reward. Draws and losses reset
the mode's win streak. Win rate uses settled matches only.

The Worker marks voluntary exit / reconnect grace expiry as forfeiture. Exit
waits up to 1.5 seconds for the server snapshot before closing. Forfeits award no
XP. Countdown cancellation awards nothing. New snapshot fields are optional;
protocol remains v6. Old servers can supply normal result stats; their snapshots
lack the new forfeiture acknowledgement and exact survived-event counter.
On old servers, clean rules are the conservative fallback event count.

XP requires at least 20 simulated seconds and two survived events. Formula:
10 per event + 5 per clean event + 5 per clean combination, maximum 200 per run.
Offline voluntary quit gives zero XP. Pause gives no simulated time/actions.
Daily gives XP only for its first successful completion on a UTC date; repeats
can improve personal records. Level = 1 + floor(sqrt(XP / 100)), capped at 100.
Records include genuine partial/quit runs, but those runs do not grant XP.

Online cursors retain up to 4096 room/participant entries and fail closed for new
entries at that limit rather than removing replay protection. Offline callback
IDs and Daily award dates are bounded to 8192 entries. Finishing logic also guards
each run against duplicate callbacks. Local data/clock can be edited or cleared;
none of these awards have server/economic value. Local progress does not prevent
collusion between players. No ELO/MMR, global rank or cosmetic shop is implemented.

If the browser closes or loses contact before receiving the authoritative result,
that match cannot be safely settled locally. Do not infer a win/loss or award XP.
There is currently no persistent account, cross-device sync or result-recovery API.

## Future global leaderboard boundary

`src/shared/leaderboardContract.ts` defines a future server store interface only;
there is no fake adapter, leaderboard rows or public API. A real implementation
requires authenticated persistent accounts, server-unique match receipts and a
durable transaction that deduplicates match/account, validates receipt ownership
and atomically applies XP/stat/reward updates. Server UTC must govern valuable
Daily awards. Browser Offline records must never become verified global scores.
Then add pagination, retention/privacy rules and recovery of results after a
disconnect. Room-scoped participant IDs and today's local XP are insufficient.

Before release: live Online exit/reconnect/Rematch tests, phone multitouch and
long profile/history scrolling, storage-disabled reload behavior, and balance of
XP thresholds across all modes. Local tests cannot substitute for production QA.
