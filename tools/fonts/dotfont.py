"""Turn a pixel font into a dot-matrix font.

A pixel font draws each glyph as squares on a grid. Doto, the face Sphere sets
its labels in, draws them as round dots on a grid. This redraws a pixel font
the same way: every square that is lit becomes one round dot in the same
place. Which squares are lit is the source font's doing and is not changed.

The result is a TrueType font in which every glyph is a set of references to
one shared dot. That keeps the file small: a glyph costs a few bytes a dot.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Iterable

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.pointInsidePen import PointInsidePen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

DOT_GLYPH = ".dot"
Cell = tuple[int, int]


def lit_cells(draw: Callable[[object], None], cell: float) -> set[Cell]:
    """The grid squares an outline covers, as (column, row) from the origin.

    `draw` draws the outline onto whatever pen it is given. A square counts
    as lit when its centre is inside the outline.
    """
    bounds_pen = BoundsPen(None)
    draw(bounds_pen)
    if bounds_pen.bounds is None:
        return set()
    x_min, y_min, x_max, y_max = bounds_pen.bounds
    lit: set[Cell] = set()
    for column in range(math.floor(x_min / cell), math.ceil(x_max / cell)):
        for row in range(math.floor(y_min / cell), math.ceil(y_max / cell)):
            probe = PointInsidePen(None, ((column + 0.5) * cell, (row + 0.5) * cell))
            draw(probe)
            if probe.getResult():
                lit.add((column, row))
    return lit


def component_offsets(cells: Iterable[Cell], cell: float) -> list[tuple[int, int]]:
    """Where to put the shared dot for each lit square, in a fixed order."""
    return [(round(column * cell), round(row * cell)) for column, row in sorted(cells)]


def draw_dot(pen, cell: float, ratio: float) -> None:
    """One round dot in the middle of the square at the origin.

    `ratio` is the dot's diameter over the grid pitch. The circle is eight
    quadratic curves given by their control points alone; TrueType puts the
    points on the curve halfway between them, which is where a circle needs
    them when the control points sit at radius / cos(22.5 degrees).
    """
    centre = cell / 2
    reach = (cell * ratio / 2) / math.cos(math.pi / 8)
    controls = [
        (
            round(centre + reach * math.cos(step * math.pi / 4)),
            round(centre + reach * math.sin(step * math.pi / 4)),
        )
        for step in range(8)
    ]
    pen.qCurveTo(*controls, None)
    pen.closePath()


def build_dot_font(
    source: TTFont,
    code_points: Iterable[int],
    family: str,
    *,
    cells_per_em: int,
    ratio: float,
    ascent: int,
    descent: int,
) -> TTFont:
    """A dot font holding `code_points`, drawn from `source`'s pixels.

    Characters `source` does not have are left out. `ascent` and `descent`
    are in font units and replace the source's, so the caller decides how
    tall a line of this font is.
    """
    units_per_em = source["head"].unitsPerEm
    cell = units_per_em / cells_per_em
    glyph_set = source.getGlyphSet()
    cmap = source.getBestCmap()

    dot_pen = TTGlyphPen(None)
    draw_dot(dot_pen, cell, ratio)
    glyphs = {".notdef": TTGlyphPen(None).glyph(), DOT_GLYPH: dot_pen.glyph()}
    advances = {".notdef": units_per_em // 2, DOT_GLYPH: 0}
    character_map: dict[int, str] = {}

    for code_point in sorted(set(code_points)):
        source_name = cmap.get(code_point)
        if source_name is None:
            continue
        name = f"u{code_point:04X}"
        outline = glyph_set[source_name]
        pen = TTGlyphPen(glyphs)
        for offset in component_offsets(lit_cells(outline.draw, cell), cell):
            pen.addComponent(DOT_GLYPH, (1, 0, 0, 1, *offset))
        glyphs[name] = pen.glyph()
        advances[name] = round(outline.width)
        character_map[code_point] = name

    builder = FontBuilder(unitsPerEm=units_per_em, isTTF=True)
    builder.setupGlyphOrder(list(glyphs))
    builder.setupCharacterMap(character_map)
    builder.setupGlyf(glyphs)
    glyf = builder.font["glyf"]
    metrics = {}
    for name in glyphs:
        glyph = glyf[name]
        glyph.recalcBounds(glyf)
        metrics[name] = (advances[name], getattr(glyph, "xMin", 0) if glyph.numberOfContours else 0)
    builder.setupHorizontalMetrics(metrics)
    builder.setupHorizontalHeader(ascent=ascent, descent=-descent, lineGap=0)
    builder.setupNameTable({"familyName": family, "styleName": "Regular"})
    builder.setupOS2(
        version=4,
        sTypoAscender=ascent,
        sTypoDescender=-descent,
        sTypoLineGap=0,
        usWinAscent=ascent,
        usWinDescent=descent,
        fsSelection=0x40 | 0x80,  # regular, and: use the typographic metrics
    )
    builder.setupPost()
    return builder.font
