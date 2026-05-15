# Monster Studio

Browser-based editor for the OBR Suite's **custom monster format**
(5etools-shape monster objects). Import a JSON file, edit it in a
form, watch a live stat-block preview, export the JSON back out.

Sibling tool to `tools/buff-fx-studio/`. Page 1 of the planned
two-page studio — Page 2 (buff preset compositor) is not built yet.

## What it does

1. **Load** — import a `.json` file, drag one onto the window, paste
   into the raw-JSON box, or start from a blank / sample monster.
   Accepts three shapes: `{"monster":[ … ]}`, a bare `[ … ]` array,
   or a single `{ … }` object. Export reproduces the same shape.
2. **Quick-edit** — form fields for the common stuff: name / source /
   size / type / CR, AC / HP / speeds, the six ability scores +
   saves, skills / senses / languages / resistances.
3. **Section rows** — add / edit / delete trait · action · bonus ·
   reaction · legendary entries. `{@tag …}` token syntax is kept
   verbatim so it round-trips.
4. **Raw JSON** — the textarea is the source of truth. Anything the
   form can't express (spellcasting, nested entries, lair actions)
   is editable here; the form and preview re-sync on every edit.
5. **Preview** — the right pane renders the stat-block with the same
   layout, palette and section colours as the in-OBR bestiary
   monster-info popover.

## Architecture

Pure static page — no backend, no build step, no dependencies.

```
index.html  →  app.js (editor logic: load / form <-> state / export)
                └─ statblock.js  (stat-block renderer, ported from
                                  src/modules/bestiary/monster-info-page.ts)
               style.css         (dark theme + .sb-* popover styles)
```

- `statblock.js` exports `renderStatBlock(monster)` → HTML string,
  plus `flattenEntries()` (reused by the editor to show `entries`
  as editable text). It is a pure-rendering port — no dice rolls,
  no token HP/AC editing, no pin/drag chrome.
- `app.js` keeps the parsed document in `state.doc`; the form and
  section rows mutate the monster objects in place, then re-serialize
  to the textarea + re-render the preview.
- The `.sb-*` CSS in `style.css` mirrors `bestiary-monster-info.html`
  so the preview is a 1:1 visual match of the OBR popover.

## Running locally

```bash
# Any static file server works.
cd tools/monster-studio
python -m http.server 8000
# then visit http://localhost:8000/
```

## Deploying

Fully static — push the directory to any HTTP host alongside
`buff-fx-studio`.

## Custom monster format

The "custom monster format" is just the 5etools `Monster` schema —
the same objects the suite stores in IndexedDB via
`src/utils/localContent.ts` and renders in the bestiary. Fields the
editor understands:

| Field | Shape | Notes |
|-------|-------|-------|
| `name`, `ENG_name`, `source`, `alignment` | string | |
| `size` | string or `["M"]` | edited as a single code (T/S/M/L/H/G) |
| `type` | string or `{type, tags}` | edited as a string (tags kept only via raw JSON) |
| `ac` | number / `[n]` / `[{ac, from}]` | `"17（链甲、盾牌）"` parses to `{ac, from}` |
| `hp` | number / `{average, formula}` | `"21, 6d6"` parses to `{average, formula}` |
| `speed` | `{walk, fly, swim, climb, burrow}` | per-mode number inputs |
| `str`…`cha` | number | |
| `save` | `{dex:"+4", …}` | per-ability text input in the ability grid |
| `skill` | `{stealth:"+6", …}` | `key:value` pairs, comma-separated, English keys |
| `senses`, `languages`, `resist`, `immune`, `vulnerable`, `conditionImmune` | string[] | comma-separated |
| `passive` | number | |
| `cr` | string or `{cr}` | edited as a string |
| `trait`, `action`, `bonus`, `reaction`, `legendary` | `[{name, entries}]` | section rows |

Anything else on the object (e.g. `spellcasting`, `legendaryActions`,
`legendaryHeader`, image fields) is preserved untouched — edit it in
the raw JSON box.
