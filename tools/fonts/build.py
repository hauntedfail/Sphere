# /// script
# requires-python = ">=3.11"
# dependencies = ["fonttools==4.68.0", "brotli==1.2.0"]
# ///
"""Build the fonts Sphere ships for each language. Run: pnpm fonts:build

For every language in sources.json this writes two files into
src/assets/fonts/:

  dots-<language>.woff2   the label face: a pixel font redrawn as round dots
  text-<language>.woff2   the sentence face: a subset of a text font

Each holds only the characters the language's dictionary uses, which
`pnpm fonts:chars` writes into chars.json. coverage.json records what each
file ended up holding, and tests/fonts.test.ts checks the dictionaries
against it.

Sources are fetched once into .cache/ and checked against the SHA-256 in
sources.json. Nothing here runs during `pnpm build`.
"""

from __future__ import annotations

import hashlib
import io
import json
import sys
import urllib.request
import zipfile
from pathlib import Path

from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

from dotfont import build_dot_font

HERE = Path(__file__).resolve().parent
CACHE = HERE / ".cache"
OUTPUT = HERE.parent.parent / "src" / "assets" / "fonts"

# Doto at the weight and roundness the stylesheet uses (wght 900, ROND 100):
# ten dots to the em, each 0.9 of the pitch across, 0.95 em above the baseline
# and 0.25 em below. Measured from src/assets/fonts/doto-latin-full.woff2.
DOTO_DOTS_PER_EM = 10
DOTO_DOT_RATIO = 0.9
DOTO_ASCENT_EM = 0.95
DOTO_DESCENT_EM = 0.25

# Fusion Pixel 12px draws on twelve squares to the em.
PIXELS_PER_EM = 12
# How much the stylesheet enlarges the dot face (`size-adjust`). The line
# metrics are divided by it here, so that a line of the face stays as tall as
# a line of Doto. At 1.0 it is not enlarged: a character is as large as the
# text around it, and its dots sit a sixth closer together than Doto's. At
# PIXELS_PER_EM / DOTO_DOTS_PER_EM (1.2) the dots would be as far apart as
# Doto's and every character a fifth larger. See docs/fonts.md.
DOTS_SIZE_ADJUST = 1.0

# The weights the stylesheet asks of the text face.
TEXT_WEIGHTS = (400, 600)

# 2026-01-01T00:00:00Z, in the seconds since 1904 that a font counts in.
FIXED_TIMESTAMP = 3850070400


def fetch(source: dict) -> bytes:
    """The bytes of a source, from the cache or the network, checksum verified."""
    CACHE.mkdir(exist_ok=True)
    path = CACHE / source["file"]
    if not path.exists():
        print(f"  fetching {source['url']}")
        with urllib.request.urlopen(source["url"]) as response:  # noqa: S310 - the URL is ours, pinned in sources.json
            path.write_bytes(response.read())
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != source["sha256"]:
        raise SystemExit(f"{path.name}: SHA-256 is {digest}, sources.json says {source['sha256']}")
    return data


def open_font(source: dict, member: str | None) -> TTFont:
    data = fetch(source)
    if member is not None:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            data = archive.read(member)
    return TTFont(io.BytesIO(data))


def rename(font: TTFont, family: str) -> None:
    """Give a derived font a name of its own, as the Open Font License asks."""
    name = font["name"]
    for record in list(name.names):
        if record.nameID in (1, 3, 4, 6, 16, 17, 25):
            name.removeNames(nameID=record.nameID)
    postscript = family.replace(" ", "")
    for name_id, text in ((1, family), (2, "Regular"), (3, f"{family}; Sphere"), (4, family), (6, postscript)):
        name.setName(text, name_id, 3, 1, 0x409)


def dots(source: TTFont, code_points: set[int], family: str) -> TTFont:
    units = source["head"].unitsPerEm
    return build_dot_font(
        source,
        code_points,
        family,
        cells_per_em=PIXELS_PER_EM,
        ratio=DOTO_DOT_RATIO,
        ascent=round(DOTO_ASCENT_EM * units / DOTS_SIZE_ADJUST),
        descent=round(DOTO_DESCENT_EM * units / DOTS_SIZE_ADJUST),
    )


def text(source: TTFont, code_points: set[int], family: str) -> TTFont:
    """The text face cut down to `code_points`, keeping only the weights in use.

    Cut the characters first and the weights second: the other way round,
    fontTools 4.68 trips over glyphs the narrowed font no longer varies.
    """
    options = Options()
    options.layout_features = ["kern"]
    options.name_IDs = [1, 2, 3, 4, 6]
    options.notdef_outline = True
    options.hinting = False
    options.desubroutinize = True
    subsetter = Subsetter(options)
    subsetter.populate(unicodes=sorted(code_points))
    subsetter.subset(source)
    font = instancer.instantiateVariableFont(source, {"wght": TEXT_WEIGHTS})
    rename(font, family)
    return font


def save(font: TTFont, name: str) -> list[int]:
    """Write `font` as WOFF2 and return the code points it holds.

    The dates inside the file are fixed, so the same sources and the same
    characters give the same bytes and a rebuild that changes nothing shows
    no difference to commit.
    """
    font.flavor = "woff2"
    font.recalcTimestamp = False
    font["head"].created = font["head"].modified = FIXED_TIMESTAMP
    path = OUTPUT / name
    font.save(path)
    print(f"  {name}: {path.stat().st_size} bytes, {len(font.getBestCmap())} characters")
    return sorted(font.getBestCmap())


def main() -> None:
    config = json.loads((HERE / "sources.json").read_text())
    chars_path = HERE / "chars.json"
    if not chars_path.exists():
        raise SystemExit("chars.json is missing: run pnpm fonts:chars first")
    chars = json.loads(chars_path.read_text())

    coverage: dict[str, list[int]] = {}
    for locale, faces in config["locales"].items():
        if locale not in chars:
            raise SystemExit(f"chars.json has nothing for {locale}: run pnpm fonts:chars")
        code_points = {ord(character) for character in chars[locale]}
        tag = locale.upper()
        slug = locale.lower()
        print(f"{locale}: {len(code_points)} characters")

        dots_source = config["sources"][faces["dots"]["source"]]
        dots_font = dots(open_font(dots_source, faces["dots"].get("member")), code_points, f"Sphere Dots {tag}")
        coverage[f"dots-{slug}.woff2"] = save(dots_font, f"dots-{slug}.woff2")

        text_source = config["sources"][faces["text"]["source"]]
        text_font = text(open_font(text_source, faces["text"].get("member")), code_points, f"Sphere Text {tag}")
        coverage[f"text-{slug}.woff2"] = save(text_font, f"text-{slug}.woff2")

    (OUTPUT / "coverage.json").write_text(json.dumps(coverage, separators=(",", ":")) + "\n")
    print("wrote coverage.json")


if __name__ == "__main__":
    sys.exit(main())
