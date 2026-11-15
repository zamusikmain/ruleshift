# Offline Survival and Daily Challenge

Survival has no time limit. It ends at zero HP or when the player ends the run.
Difficulty increases through bounded speed/pressure, density tiers, shorter rests
and certified combinations. Warnings and path certificates are preserved.
Independent time, score and event records plus aggregate run statistics are saved
in the optional `offline` field of `ruleshift.profile.v1`. Old profiles migrate
without losing identity, achievements or previous statistics.

Daily scenario version 1 is a 90-second Laser Grid / Death Spin course with Dash
but no Power-Ups or combinations. The UTC date fixes its seed. All gameplay
randomness comes from a seeded RNG; the scene uses a fixed 1/60-second step.
Physical layouts and event timing are deterministic. Safe destination hints,
collisions and scores naturally depend on player input. The run's date is frozen
at its start; retry after UTC midnight starts the new day's challenge.

A player completes Daily by reaching 90 seconds with positive HP. Only the first
successful local completion awards a local medal. Replays update records. History
retains up to 366 dates. Storage failure falls back to memory.

Daily records contain date, seed, scenarioVersion, attempts and an optional
bestCompleted run (time, score, events) for a future ranking adapter. They are
untrusted local data, not a global leaderboard or proof of a valid run. Changing
the device clock or editing/clearing local storage can change local medals.
No medal has server or economic value. Any future valuable reward or leaderboard
must use a server-issued UTC challenge and authoritative validation plus an
atomic one-award-per-account/date ledger. Local records must never grant those
rewards directly. No such backend is implemented here.

Menus, results and history use the existing responsive panels. Survival and Daily
also allow portrait touch gameplay with the same fitted arena, a rearranged HUD
and separate joystick/action areas. The joystick fits narrow screens without
changing its saved size preference. Other modes retain their rotation behavior.
Landscape uses the existing joystick, Dash and controls settings. Physical phone
testing remains necessary to confirm readability and multitouch comfort.
