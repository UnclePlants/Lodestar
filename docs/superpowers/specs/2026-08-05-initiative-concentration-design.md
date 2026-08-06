# Initiative "Concentration" (C) Toggle — Design

**Date:** 2026-08-05
**Status:** Approved

## Problem

GM has no way to mark a combatant as concentrating on a spell (D&D 5e concept) in the Initiative tracker. Needs a per-combatant toggle GM controls, visible to both GM and players.

## Data Model

Each combatant object in `state.initiative.combatants` gains:

```js
concentration: boolean // default false
```

## GM Initiative Row

`renderInitiativePanel()` (app.js:4132) — add a new button per row, placed immediately after the name/link button:

```html
<button type="button" class="init-conc" data-act="toggle-conc" data-id="{combatant.id}" title="Concentration" aria-label="Concentration">C</button>
```

- Active state (`combatant.concentration === true`) → apply `.active` class, giving the button a highlighted (blue) background.
- Inactive state → default button styling (unfilled).
- Styled like existing `.init-hp-step` buttons (small square), added near styles.css:1679–1710.

## Click Handling

Delegated click handler (app.js:872–881) gains a `toggle-conc` case:

1. Look up the combatant by `data-id`.
2. Flip `combatant.concentration`.
3. Re-render the initiative panel.
4. Call `broadcastState()` (existing sync path — no new message type).

Toggle is a plain on/off flip. No auto-clear on HP loss or any other trigger — GM has full manual control.

## Player/GM-shared Overlay

`renderInitiativeOverlay()` (app.js:4177) — visible to both GM and players. For each combatant where `concentration === true`, render a small non-interactive badge next to their name:

```html
<span class="init-conc-badge">C</span>
```

- Omitted entirely when `concentration` is false — no placeholder/empty state shown.
- Not clickable, no `data-act` — read-only indicator for players. The only interactive control is the GM row button.

## Sync

No new message type. This follows the existing "mutate `state.x` → render → `broadcastState()`" pattern already used by every other initiative mutator (`addCombatant`, `removeCombatant`, `adjustHp`, etc.).

## Styling

Add to `styles.css`:
- `.init-conc` — base button, matches `.init-hp-step` sizing/shape.
- `.init-conc.active` — highlighted (blue) background.
- `.init-conc-badge` — small letter badge for the overlay, placed near the existing `.init-ov-btn` rules (~styles.css:2164–2181).

## Out of Scope

- No auto-clear on damage/HP change.
- No concentration-check roll prompts.
- No multi-state (only two states: on/off).
