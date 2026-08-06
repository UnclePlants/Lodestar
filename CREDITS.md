# Third-party credits

Lodestar bundles icon artwork from the following open-source projects. The icon
paths are embedded directly in `index.html` and `app.js`. Each is used under the
MIT License, reproduced below.

Demo/screenshot artwork is credited separately at the bottom of this file.

## Feature ideas

Thanks to **u/Odd_Maybe2168** on Reddit for sharing their Lodestar experiments, which
inspired the initiative tracker, the red "player frame" indicator, and the area-of-effect
tool added in this version.

Thanks to **u/D3XR** on Reddit for sharing ideas, which inspired two features: a draggable player-view frame (grab the red rectangle
on the GM screen to pan the player display in real time) and a player-square lock that keeps
one grid square a constant physical size on a TV battlemap across maps of different
resolutions.

Thanks to **u/Plebian_Donkey_Konga** on Reddit for suggesting undo/redo (`Ctrl+Z`), middle-mouse
drag to pan the map in any tool, and the drag-to-draw fog-of-war shapes.

Thanks to **u/DungeonDadofDadJokes** (music/SFX player and PDF reader), **u/DerekT0341** and
**u/Tommyruin** (tying tokens to the initiative tracker), and **u/FaceDeer** (the in-app
shortcut overlay) on Reddit, whose suggestions shaped the v1.2.0 features.

Concentration tracking, contributed by @romanmok in #9: a GM-clickable **C** toggle per combatant in the Initiative sidebar, mirrored as a read-only badge in the turn-order overlay for players. Syncs over the existing state broadcast, documented in the manual and README.

---

## Lucide

Toolbar and UI icons.

- Project: https://lucide.dev
- Source: https://github.com/lucide-icons/lucide
- License: ISC (Lucide), originating from Feather (MIT)

```
ISC License

Copyright (c) 2020, Lucide Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```

---

## Tabler Icons

Staircase markers (`stairs`, `stairs-up`, `stairs-down`) used for the floor-link
map markers and the stair tool button.

- Project: https://tabler.io/icons
- Source: https://github.com/tabler/tabler-icons
- License: MIT

```
MIT License

Copyright (c) 2020-2024 Paweł Kuna

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Demo / screenshot artwork

The battlemap shown in Lodestar's screenshots is **not** part of the software and
is **not** redistributed in this repository — it is used only to demonstrate the
tool. It is credited here in accordance with its license.

- Map: **"Chapel of the Bountiful Harvest"** (Map #287, player version)
- Creator: **Elven Tower Adventures** — https://elventower.com
- License: **CC BY 4.0** — https://creativecommons.org/licenses/by/4.0/
- Changes: displayed in Lodestar with a fog-of-war overlay added.

---

## Bundled demo content

The in-app **Demo** button loads a sample map plus music, ambiance, and an SFX,
all bundled in this repository (`demo-map.js`, `demo-music.mp3`,
`demo-ambiance.mp3`, `demo-explosion.mp3`).

### Map

- Map: **"Tearooms"** by **Fantasy Atlas**
- Creator / support: https://www.patreon.com/c/Fantasy_Atlas/home
- Bundled as Lodestar's demo map, credited in-app with a link to support the creator.

### Music

- Track: **"Invented Rooms"** by **Savfk**
- Artist: https://www.savfk.com
- Source: https://breakingcopyright.com/song/savfk-invented-rooms
- Promoted by: https://www.breakingcopyright.com
- License: **CC BY 4.0** — https://creativecommons.org/licenses/by/4.0/
- Changes: none; played as-is in the demo's music player.

### Ambiance

- Sound: **"Creepy Ambiance"** by **freesound_community**
- Source: Pixabay — https://pixabay.com
- License: **Pixabay Content License** — https://pixabay.com/service/license-summary/
- Changes: none; looped as the ambiance layer in the demo's music player.

### Sound effect

- Sound: **"Loud Explosion"** by **DRAGON-STUDIO**
- Source: Pixabay — https://pixabay.com
- License: **Pixabay Content License** — https://pixabay.com/service/license-summary/
- Changes: none; a one-shot pad in the demo's SFX soundboard.
