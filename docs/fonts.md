# Fonts for the other languages

Doto and Instrument Sans are Latin faces. A language written in another
script ships two faces of its own, made by `tools/fonts/` and committed under
`src/assets/fonts/`:

- `dots-<language>.woff2`, **Sphere Dots**: the label face, to sit beside Doto.
- `text-<language>.woff2`, **Sphere Text**: the sentence face, to sit beside
  Instrument Sans.

English and Italian need neither: `tests/fonts.test.ts` checks that their
dictionaries use nothing the two Latin faces lack.

## What "made" means

No glyph is drawn or corrected by hand. Two mechanical steps:

- **Cut down.** A face keeps only the characters the language's dictionary
  uses, and those characters in capitals, because labels are set in capitals.
  The text face also keeps only the weights from 400 to 600.
- **Redrawn as dots** (label face only). The source, Fusion Pixel 12px, draws
  each character as squares on a grid of twelve to the em. Every square that
  is lit becomes one round dot in the same place. Which squares are lit is
  Fusion Pixel's doing and is not changed.

A character the dictionary does not use (a device name, a label someone
typed) falls through to the system's fonts.

## Rebuilding

Needed whenever a translation uses a character it did not use before;
`pnpm test` fails until it is done.

```bash
pnpm fonts:chars   # writes tools/fonts/chars.json from the dictionaries
pnpm fonts:build   # fetches the sources and writes the fonts
```

`pnpm fonts:build` needs [uv](https://docs.astral.sh/uv/), which supplies
Python and the pinned fontTools. It is not part of `pnpm build` or of CI: the
fonts it writes are committed, like the two Latin ones. The sources are
pinned by URL and SHA-256 in `tools/fonts/sources.json` and cached, untracked,
in `tools/fonts/.cache/`.

The conversion has tests of its own, run with the same fontTools as the
build:

```bash
pnpm fonts:test
```

`tests/fonts.test.ts` does not take the tool's word for what it wrote. It
reads each font file's character map (`tests/woff2.ts`), the two Latin ones
included, and holds every dictionary to that.

## The numbers behind the dot face

Measured from `src/assets/fonts/doto-latin-full.woff2` at the weight and
roundness the stylesheet uses (`wght` 900, `ROND` 100):

| | Doto | Sphere Dots |
| --- | --- | --- |
| Grid | 10 dots to the em | 12 dots to the em |
| Dot diameter, as a share of the pitch | 0.9 | 0.9 |
| Ascent and descent | 0.95 em, 0.25 em | the same |

Every glyph is a set of references to one shared dot, which is why a face
with some 300 characters is under 10 kB.

The dot face is not enlarged. Its dots are therefore a sixth closer together
than Doto's, and a character is as large as the text around it. Enlarging it
by 120% (`size-adjust`, and `DOTS_SIZE_ADJUST` in `tools/fonts/build.py`)
would put the dots exactly as far apart as Doto's, at the cost of characters
a fifth larger: long titles then wrap and rows of chips break.

## The text face

Cut from the variable font, keeping the 400 to 600 range in one file. For
Japanese that is 67 kB; three static files (400, 500 and 600) came to 121 kB
together.

## Licences

Every source is under the SIL Open Font License 1.1. The faces made here are
Modified Versions in its terms, so they carry names of their own (Noto Sans
reserves the name "Source") and are distributed under the same licence.
`public/font-license.txt` lists each source and its copyright.
