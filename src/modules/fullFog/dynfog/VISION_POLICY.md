# Player vision — implementation boundary (2026-09-08)

The room's `fogShareVision` setting defaults to false. Both stable and dev
install the same access pass. GM light creation/settings are available on both
channels; extra geometry authoring and opening controls retain their channel gate.

## Ownership and display

| Source | Personal view | Shared party view |
| --- | --- | --- |
| Public bound card owned by current PLAYER | Yes | Yes |
| Public bound card owned by another online PLAYER | No | Yes |
| Private `owners` card | Its actual owners only | Does not contribute |
| `dm`, malformed or missing bound card | No | No |
| Explicit assigned owner(s) | Actual current PLAYER owner | When an assigned PLAYER is online |
| Explicit team source | No | Yes, even without an online owner |
| Explicit GM source | No | No |
| Unbound ordinary CHARACTER/MOUNT created by an online PLAYER | That player | Yes |
| GM-created token without card/override; map; bestiary NPC | No automatic ownership | No automatic ownership |

Explicit ownership metadata overrides card ownership. Card binding overrides
creator inference, so GM-created tokens handed to players work without treating
the GM's other tokens as player characters. A hidden item or hidden/missing/cyclic
ancestor contributes no visible light. Attachment traversal is bounded to 32 items.

Ordinary offline owners leave the shared pool until reconnect. The local client
is included as an online player only when its actual role is PLAYER. A player
becoming GM ceases to be an inferred party owner. Cards, party, role, items and
scene changes re-evaluate access. Unknown identity never borrows party sources.

PRIMARY and AUXILIARY need revealing permission. An unowned PRIMARY/AUXILIARY
becomes SECONDARY locally, which can illuminate a permitted PRIMARY field but
does not independently reveal fog. AUXILIARY reveals its own view without
activating SECONDARY, so it is not a PRIMARY reachability anchor. When light
occlusion is enabled, foreign illumination also needs a clear line from an
authorized PRIMARY; the filter is non-transitive. Disabling light occlusion
does not grant NPC vision. This is a deliberate behavior change from stable's
previous ungated foreign PRIMARY lights, required for personal/shared vision;
it is not an equivalent-output optimization.

Automatic ambient lights retain the existing deliberate public lighting and
revealing exception. Explicit ownership (including team mode when sharing is
off), private/missing bound cards and hidden ancestors take precedence over
that exception. A GM can retain a public ambient lamp by leaving ownership
automatic, or restrict it using the single ownership selector.

## Writes and lifecycle

Light and self-light actors start hidden. The access pass runs before submission,
including late reactor registration. Patcher folds same-batch updates into the
first addition and checks the latest actor permission at each queued light write.
Old light visibility is revoked before new vision is granted. Wall operations
remain add → update → delete, preserving the existing grow-before-shrink ordering.

Scene/lifetime generations discard stale queued batches and stale snapshot
responses. Newer direct metadata/party/role events fence pending runtime reads,
including same-value notifications. A removed parent never falls back to a
previous snapshot. Access-only changes keep actor IDs and do not reread the
scene or rebuild unchanged wall geometry.

The ownership editor preserves other fields after save failure and allows retry
in the same menu. Delayed older choices, scene closure and role demotion cannot
apply an old ownership change. The same controls fit the 320×254 embed in both
languages in the browser test.

## Validation and remaining limits

- `node tools/vision-selftest.mjs --mutations`: 64 assertions pass; all 11
  deliberately broken variants fail assertions. Uses the real SDK item builders,
  controlled SDK transport and real stable/dev setup entry.
- `node tools/vision-edit-dom-selftest.mjs`: 18 assertions pass in headless Edge,
  covering Chinese/English, layout, save failure/retry, competing writes, role
  demotion and scene closure. Uses a dedicated test-only SDK transport.
- Existing `node tools/dynfog-selftest.mjs`: 52/52 pass before and after changes.
- TypeScript checking passes. Root performs the isolated integrated builds.

No real Owlbear GM + multiple-player room test has been performed in this batch.
Native render frames, committed movement latency, disconnection timing, browser
background throttling and actual large-map performance remain UAT requirements.
SECONDARY lights can require another native shadow pass; no FPS improvement is
claimed. Historical fog and live smooth token following are not implemented here.

Queued work can be cancelled before SDK dispatch. A host request already accepted
by Owlbear cannot be retracted; later operations use fresh generation/permissions.
The existing Patcher logs failed SDK writes and does not provide a durable retry
ledger. A failed restriction stops that batch before grants, but persistent host
write failures can leave an older local light until recovery/restart. This remains
an explicit integration boundary, not a claim of enforcement during API failure.
Client-local visual filtering also does not conceal shared metadata from a modified
client, and co-running another fog engine can introduce unrelated revealing lights.

## Primary references

Native light types and local-only light API:
https://docs.owlbear.rodeo/extensions/reference/items/light/

Official dynamic fog PRIMARY/SECONDARY/AUXILIARY behavior:
https://docs.owlbear.rodeo/extensions/reference/dynamic-fog/

The authorization policy is original suite code. No S&S source, artwork or
proprietary history-fog implementation was copied.
