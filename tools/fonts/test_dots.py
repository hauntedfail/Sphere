"""Tests for the dot conversion. Run: uv run --with pytest --with fonttools pytest tools/fonts"""

import math

import pytest
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import RecordingPen

from dotfont import component_offsets, draw_dot, lit_cells


def l_shape(pen):
    """Three cells of 100 units: (0, 0), (0, 1) and (1, 0), as one outline."""
    pen.moveTo((0, 0))
    pen.lineTo((200, 0))
    pen.lineTo((200, 100))
    pen.lineTo((100, 100))
    pen.lineTo((100, 200))
    pen.lineTo((0, 200))
    pen.closePath()


def two_separate_cells(pen):
    for x, y in ((0, 0), (200, -100)):
        pen.moveTo((x, y))
        pen.lineTo((x + 100, y))
        pen.lineTo((x + 100, y + 100))
        pen.lineTo((x, y + 100))
        pen.closePath()


def test_lit_cells_of_an_l_shape():
    assert lit_cells(l_shape, cell=100) == {(0, 0), (0, 1), (1, 0)}


def test_lit_cells_below_the_baseline_and_apart():
    assert lit_cells(two_separate_cells, cell=100) == {(0, 0), (2, -1)}


def test_an_empty_outline_lights_nothing():
    assert lit_cells(lambda pen: None, cell=100) == set()


def test_one_offset_per_lit_cell_in_a_fixed_order():
    assert component_offsets({(2, 1), (0, 0), (0, -1)}, cell=100) == [(0, -100), (0, 0), (200, 100)]
    assert component_offsets(set(), cell=100) == []


def test_the_dot_is_a_circle_in_the_middle_of_its_cell():
    pen = RecordingPen()
    draw_dot(pen, cell=100, ratio=0.9)
    assert [op for op, _ in pen.value].count("qCurveTo") == 1

    bounds = BoundsPen(None)
    pen.replay(bounds)
    assert bounds.bounds == pytest.approx((5, 5, 95, 95), abs=1)


def test_the_dot_is_round():
    pen = RecordingPen()
    draw_dot(pen, cell=1000, ratio=0.9)
    (_, points), = [entry for entry in pen.value if entry[0] == "qCurveTo"]
    control = [point for point in points if point is not None]
    assert len(control) == 8
    radii = [math.hypot(x - 500, y - 500) for x, y in control]
    # Eight control points on one circle (to the nearest font unit), a touch outside the dot they describe.
    assert max(radii) - min(radii) < 1.5
    assert 450 < min(radii) < 500
