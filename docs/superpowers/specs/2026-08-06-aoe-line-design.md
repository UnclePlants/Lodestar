# AoE Line — design spec

## Мета

Додати четверту форму до Area of Effect: тонку ламану лінію (polyline) для
заклинань типу Wall of Fire, Wind Wall, Lightning Bolt тощо. Ширина
регульована (фт), дефолт 1фт.

## Поза межами

- Перетягування (move) вже розміщеної лінії — circle/square/cone теж не
  тягаються зараз, лінія узгоджена з ними.
- Прив'язка до сітки — не додається; всі AoE-маркери зараз ставляться по
  сирій позиції курсора (без снапу), лінія робить так само.
- Live-«гумка» від останньої вершини до курсора під час малювання — не
  додається; існуючий fog-полігон (`polygon`/`namedPolygon`) малює лише
  зафіксовані сегменти без прев'ю до курсора, лінія повторює цей паттерн.
- Зміни протоколу синхронізації (`message.aoe`) — не потрібні; готова лінія
  йде тим самим каналом, що й інші персистентні AoE-маркери
  (`state.aoeMarkers` + `renderAndSync()`).

## Дані

`state.aoeMarkers` вже містить об'єкти `{ id, shape, x, y, sizeFt, angle,
color, label, showPlayers }`. Для лінії:

```js
{
  id, shape: "line",
  points: [{x, y}, ...],   // ≥2 точки, native coords, без снапу
  sizeFt,                  // ширина лінії у футах (замість radius/half-side)
  color, label, showPlayers,
  // angle не використовується для line
}
```

`aoeShape` отримує нове значення `"line"`. Під час малювання чернетка
живе окремо від готових маркерів у новій змінній модуля:

```js
let aoeLineDraft = []; // native points чернетки, поки лінія не завершена
```

## UI

- Новий кнопка `aoeLine` в `#aoeShapeRow` (index.html), поруч з
  circle/square/cone, проста zigzag-іконка (SVG без inline fill/stroke —
  CSS `.icon-segmented svg` вже задає `fill:none; stroke:currentColor`).
- `AOE_PRESETS.line = [1, 5, 10]` (1фт — стіни, 5фт — Lightning Bolt-типу
  ефекти, 10фт — ширші).
- Поле «Custom (ft)» перевикористовується як ширина лінії; при перемиканні
  на `line` дефолтне значення виставляється в 1 (якщо користувач ще не
  задав своє).
- `aoeAngleRow` продовжує ховатись (лінія не має єдиного кута).
- `controls.modeHint` під час `aoe`+`line` показує окремий текст:
  «Click each point of the line. Enter or double-click to place it (≥2
  points, prompts for a label). Ctrl+Z/Backspace removes the last point,
  Escape cancels the draft. Right-click a placed line to remove it.»

## Взаємодія (placement flow)

Повторює існуючий паттерн `drawingRoom` (fog-полігон):

1. `mode === "aoe"` і `aoeShape === "line"`: клік (`onPointerDown`) → якщо
   картинка завантажена, `aoeLineDraft.push(native)`; `render()`.
2. `onDoubleClick`: якщо `mode === "aoe"` і `aoeShape === "line"` і
   `aoeLineDraft.length >= 2` → `finishAoeLine()`.
3. `onKeyDown`:
   - `Enter` при тих же умовах → `finishAoeLine()` (той самий tick-guard,
     що вже є для `namedPolygon`, тут не потрібен — лінія не відкриває
     діалог).
   - `Ctrl+Z`/`Backspace`/`Delete` while `aoeLineDraft.length` → pop
     останню точку, `render()` (той самий підхід, що для `drawingRoom`).
   - `Escape` while `aoeLineDraft.length` → `aoeLineDraft = []`, `render()`.
4. `finishAoeLine()`: prompt лейбл (як `placeAoeMarker`), пушить маркер
   `{ id: uuid(), shape: "line", points: [...aoeLineDraft], sizeFt:
   aoeSizeFt, color: aoeColor, label, showPlayers: true }` у
   `state.aoeMarkers`, чистить `aoeLineDraft`, `renderAndSync()`.
5. Вихід з `aoe`-режиму або зміна `aoeShape` під час малювання чистить
   `aoeLineDraft` (аналогічно тому, як `setMode`/`setAoeShape` вже чистять
   `drawingRoom`/скасовують hover-темплейт).

## Рендер

Два місця, обидва — товстий stroke через усі точки (без окремого
"fill+thin border" геометричного полігона — простіше і достатньо для
тонкої лінії):

```js
ctx.lineJoin = "round";
ctx.lineCap = "round";
ctx.beginPath();
points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
ctx.globalAlpha = 0.28;
ctx.lineWidth = widthPx;              // sizeFt * pxPerFt
ctx.strokeStyle = color;
ctx.stroke();
ctx.globalAlpha = 0.9;
ctx.lineWidth = 2 / (curK * curMs);   // тонка "вісь", як border в інших форм
ctx.stroke();
```

- **Чернетка** (`drawAoeLineDraft`, викликається з `render()` поруч із
  `drawDraftRoom()`): малює `aoeLineDraft` тим самим способом + маленькі
  кружечки-вершини (як `drawDraftRoom` робить для `drawingRoom`).
- **Готовий маркер** (`drawAoeMarkers`, новий `else if (m.shape ===
  "line")` поруч із circle/square/cone): та ж логіка, `widthPx =
  aoePxSize(m)` (перейменувати сенс: для line це ширина, не radius —
  функція `aoePxSize` не змінюється, просто інша інтерпретація значення).
- Виділення (selected outline) — той самий stroke-прохід з
  `#b1c301`/dash, що вже є для інших форм.

## Hit-test / вибір / видалення

`hitAoeMarker` отримує `else if (m.shape === "line")` гілку:
point-to-polyline distance (мін. відстань до будь-якого сегмента) ≤
`aoePxSize(m) / 2`. Потрібна нова маленька утиліта
`distanceToSegment(p, a, b)` (у файлі така ще не існує).

Double-click / right-click на лінії — вже узагальнено через
`hitAoeMarker`, працює без змін в `onDoubleClick`/`onContextMenu`.

## Синхронізація / player view

Без змін до протоколу: `state.aoeMarkers` вже йде в снапшот
(`renderAndSync`) і в player-view. Чернетка (`aoeLineDraft`) не
синхронізується і не транслюється гравцям — тільки GM бачить процес
малювання, гравці бачать готову лінію одразу після `finishAoeLine()`
(так само, як fog-полігон: draft лише в GM-вікні).

## Ручна перевірка (немає test-раннера в проєкті)

- Line-кнопка з'являється в AoE-панелі, перемикає `aoeShape`.
- 2-точкова та 4+ точкова (ламана) лінія малюється і фіксується.
- Ширина: preset-кнопки 1/5/10фт і custom-поле відпрацьовують,
  дефолт 1фт при першому перемиканні на line.
- Ctrl+Z/Backspace під час малювання прибирає останню точку, не всю лінію.
- Escape скасовує чернетку.
- Enter і дабл-клік обидва завершують лінію, питають лейбл.
- Right-click на готовій лінії видаляє її; double-click редагує лейбл.
- Лінія видима на player-екрані (showPlayers=true за замовчуванням),
  колір/ширина збігаються з GM-екраном.
- Undo/redo (`pushHistory`) коректно повертає/накатує розміщення лінії.
