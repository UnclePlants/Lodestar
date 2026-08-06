# Initiative "Concentration" (C) Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GM-clickable "C" (concentration) toggle to each Initiative combatant row, mirrored as a read-only badge to both the GM and player-visible turn-order overlay.

**Architecture:** Lodestar is a single-file vanilla-JS app (`app.js` + `styles.css` + `index.html`, no build step, no dependencies, no test framework — see `README.md`). GM and player are the same code running in two windows, distinguished by the `isPlayer` flag, kept in sync by `broadcastState()` → `BroadcastChannel`/`postMessage` → `loadSnapshot()`. This feature adds one boolean field to the combatant data shape and rides that existing sync path — no new message type, no build tooling, no automated tests (none exist in this repo; verification is manual, in-browser, matching how every other feature here is checked).

**Tech Stack:** Vanilla JavaScript, CSS custom properties (`--accent`, `--muted`, `--line`, `--text`, `--bg`), template-literal HTML rendering.

## Global Constraints

- No build step, no dependencies — every change must work by directly editing `app.js`/`styles.css` and opening `index.html` (per `README.md`).
- No automated test framework exists in this repo. Verification is manual: open the app, exercise the feature in two browser windows (GM + player, via `?view=player`), confirm visually.
- Follow existing code style: 2-space indent, double quotes, template-literal HTML strings, `data-act` delegated click handling, CSS custom properties (never hardcoded colors that already have a variable).
- Toggle is plain on/off. No auto-clear on HP change, no concentration-check prompts, no third state — confirmed out of scope in the spec (`docs/superpowers/specs/2026-08-05-initiative-concentration-design.md`).

---

### Task 1: Data field + GM row toggle button + click handling

**Files:**
- Modify: `app.js:3949-3966` (`addCombatant`)
- Modify: `app.js:4084-4091` (add new `toggleConcentration` function after `adjustHp`)
- Modify: `app.js:4154-4161` (`renderInitiativePanel` row-top markup)
- Modify: `app.js:872-881` (click delegation in `controls.initList` listener)
- Modify: `styles.css:1679-1694` (add `.init-conc` rules after `.init-remove:hover`)

**Interfaces:**
- Produces: `combatant.concentration: boolean` field on every object in `state.initiative.combatants`. `toggleConcentration(id: string): void` — flips the field for the combatant with that id, re-renders, broadcasts. Later tasks (Task 2) read `c.concentration` as a plain boolean.

- [ ] **Step 1: Add the `concentration` field to new combatants**

In `app.js`, `addCombatant()` (currently at line 3955):

```js
state.initiative.combatants.push({ id: uuid(), name, type, init, hp, maxHp: hp, concentration: false });
```

(This replaces the existing line that ends `maxHp: hp });` — just adds `, concentration: false` before the closing `});`.)

- [ ] **Step 2: Add the `toggleConcentration` function**

In `app.js`, immediately after the `adjustHp` function (which ends at line 4091, right before `function setTurnToId`), add:

```js
function toggleConcentration(id) {
  const c = state.initiative.combatants.find((x) => x.id === id);
  if (!c) return;
  c.concentration = !c.concentration;
  updateInitiativeUI();
  broadcastState();
}
```

- [ ] **Step 3: Add the C button to the GM row markup**

In `app.js`, inside `renderInitiativePanel()`, the row-top template (lines 4155-4161) currently reads:

```js
        <div class="init-row-top">
          <span class="init-dot ${c.type}"></span>
          <button type="button" class="init-name" data-act="set-turn" title="Set as current turn">${escapeHtml(c.name)}</button>
          <button type="button" class="init-link${linkState}" data-act="link" title="${linkTitle}" aria-label="${linkTitle}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><line x1="12" x2="12" y1="1" y2="4"/><line x1="12" x2="12" y1="20" y2="23"/><line x1="1" x2="4" y1="12" y2="12"/><line x1="20" x2="23" y1="12" y2="12"/></svg></button>
          <input class="init-init" type="number" data-field="init" value="${c.init}" title="Initiative">
          <button type="button" class="init-remove" data-act="remove" title="Remove" aria-label="Remove">&times;</button>
        </div>
```

Insert a new button between the `.init-link` button and the `.init-init` input:

```js
        <div class="init-row-top">
          <span class="init-dot ${c.type}"></span>
          <button type="button" class="init-name" data-act="set-turn" title="Set as current turn">${escapeHtml(c.name)}</button>
          <button type="button" class="init-link${linkState}" data-act="link" title="${linkTitle}" aria-label="${linkTitle}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><line x1="12" x2="12" y1="1" y2="4"/><line x1="12" x2="12" y1="20" y2="23"/><line x1="1" x2="4" y1="12" y2="12"/><line x1="20" x2="23" y1="12" y2="12"/></svg></button>
          <button type="button" class="init-conc${c.concentration ? " active" : ""}" data-act="toggle-conc" title="Concentration" aria-label="Concentration">C</button>
          <input class="init-init" type="number" data-field="init" value="${c.init}" title="Initiative">
          <button type="button" class="init-remove" data-act="remove" title="Remove" aria-label="Remove">&times;</button>
        </div>
```

- [ ] **Step 4: Wire the click handler**

In `app.js`, the `controls.initList` click listener (lines 872-881) currently reads:

```js
  controls.initList?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-id]");
    if (!row) return;
    const id = row.dataset.id;
    if (event.target.closest("[data-act='remove']")) removeCombatant(id);
    else if (event.target.closest("[data-act='hp-down']")) adjustHp(id, -1);
    else if (event.target.closest("[data-act='hp-up']")) adjustHp(id, 1);
    else if (event.target.closest("[data-act='link']")) onInitLink(id, event.altKey);
    else if (event.target.closest("[data-act='set-turn']")) setTurnToId(id);
  });
```

Add a new `else if` branch:

```js
  controls.initList?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-id]");
    if (!row) return;
    const id = row.dataset.id;
    if (event.target.closest("[data-act='remove']")) removeCombatant(id);
    else if (event.target.closest("[data-act='hp-down']")) adjustHp(id, -1);
    else if (event.target.closest("[data-act='hp-up']")) adjustHp(id, 1);
    else if (event.target.closest("[data-act='link']")) onInitLink(id, event.altKey);
    else if (event.target.closest("[data-act='set-turn']")) setTurnToId(id);
    else if (event.target.closest("[data-act='toggle-conc']")) toggleConcentration(id);
  });
```

- [ ] **Step 5: Add CSS for the button**

In `styles.css`, immediately after the `.init-remove:hover` rule (ends line 1693) and before `.init-hp-line` (line 1695), add:

```css
.init-conc {
  background: none;
  border: 1px solid var(--line);
  border-radius: 5px;
  color: var(--muted);
  flex-shrink: 0;
  font-size: 0.78rem;
  font-weight: 700;
  min-height: 0;
  padding: 2px 6px;
}

.init-conc:hover {
  border-color: var(--accent);
  color: var(--text);
}

.init-conc.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #1b1508;
}
```

(`var(--accent)` is the app's existing highlight color — the same one used for `.init-row.current` and the "linked" state of `.init-link`. `#1b1508` matches the dark text already used on accent-colored buttons, e.g. `.init-add button[type="submit"]`.)

- [ ] **Step 6: Manual verification**

Open `index.html` directly in a browser (no server needed). Open the Initiative panel, add a combatant. Confirm:
1. A "C" button appears between the link icon and the initiative-number input.
2. Clicking it toggles a visibly highlighted (olive/accent-colored) background on/off, with no page reload or console errors (check DevTools console).
3. Toggling HP (`−`/`+`) or advancing the turn does **not** clear the C state — it stays independently on/off.
4. Reload the page — combatant list is fresh (in-memory only, expected) — no crash on empty state.

- [ ] **Step 7: Commit**

```bash
git add app.js styles.css
git commit -m "feat: add GM concentration (C) toggle to initiative rows"
```

---

### Task 2: Player/GM-shared overlay badge

**Files:**
- Modify: `app.js:4187-4193` (`renderInitiativeOverlay` row markup)
- Modify: `styles.css:2216-2221` (add `.init-conc-badge` after `.initiative-overlay .init-ov-name`)

**Interfaces:**
- Consumes: `combatant.concentration: boolean` (produced by Task 1). No other consumption — this task only reads the field, it doesn't need `toggleConcentration`.
- Produces: nothing consumed by later tasks (this is the final task).

- [ ] **Step 1: Add the badge to the overlay row markup**

In `app.js`, `renderInitiativeOverlay()`, the row-mapping code (lines 4188-4193) currently reads:

```js
  const rows = list
    .map((c, i) => {
      const hp = !isPlayer && c.hp != null ? ` <em>${c.hp}${c.maxHp != null ? `/${c.maxHp}` : ""}</em>` : "";
      return `<li class="${i === init.turn ? "current" : ""}"><span class="init-dot ${c.type}"></span><span class="init-ov-name">${escapeHtml(c.name)}</span>${hp}</li>`;
    })
    .join("");
```

Change it to add a conditional badge right after the name span:

```js
  const rows = list
    .map((c, i) => {
      const hp = !isPlayer && c.hp != null ? ` <em>${c.hp}${c.maxHp != null ? `/${c.maxHp}` : ""}</em>` : "";
      const conc = c.concentration ? `<span class="init-conc-badge">C</span>` : "";
      return `<li class="${i === init.turn ? "current" : ""}"><span class="init-dot ${c.type}"></span><span class="init-ov-name">${escapeHtml(c.name)}</span>${conc}${hp}</li>`;
    })
    .join("");
```

This function already runs for both GM (`isPlayer === false`) and player (`isPlayer === true`) windows — no branching needed for who sees it, matching the design ("shown to both GM and players").

- [ ] **Step 2: Add CSS for the badge**

In `styles.css`, immediately after `.initiative-overlay .init-ov-name` (ends line 2221) and before `.initiative-overlay em` (line 2223), add:

```css
.init-conc-badge {
  background: var(--accent);
  border-radius: 4px;
  color: #1b1508;
  flex: none;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 1px 5px;
}
```

- [ ] **Step 3: Manual verification (two-window sync check)**

1. Open `index.html` as the GM window.
2. Open a second browser tab/window at the same path with `?view=player` appended (e.g. `index.html?view=player`) — this is the existing player-view mechanism (`isPlayer` flag, `app.js:238`).
3. In the GM window, turn on Initiative, add a combatant, and turn on the "Players" overlay toggle (`showPlayers`) so the overlay is visible on both screens.
4. In the GM window's initiative panel, click that combatant's C button.
5. Confirm: a small "C" badge appears next to the combatant's name in **both** the GM overlay and the player-view overlay, within a moment (no manual refresh).
6. Click C again — confirm the badge disappears from both windows.
7. Check both windows' DevTools consoles for errors during the toggle.

- [ ] **Step 4: Commit**

```bash
git add app.js styles.css
git commit -m "feat: mirror concentration (C) badge to initiative overlay"
```
