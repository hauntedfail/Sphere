"""Tests for the font builder. Run: pnpm fonts:test"""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent

# A locale whose encoding is not UTF-8, where the host has one.
LATIN1 = "en_US.ISO8859-1"


def test_reads_chars_json_as_utf8_whatever_the_locale(tmp_path):
    """`pnpm fonts:chars` writes UTF-8; the builder must not read it in the locale's encoding."""
    manifest = tmp_path / "chars.json"
    manifest.write_text(json.dumps({"zh-Hant": "電"}, ensure_ascii=False), encoding="utf-8")
    env = {**os.environ, "LC_ALL": LATIN1, "LANG": LATIN1, "PYTHONUTF8": "0"}
    env.pop("PYTHONIOENCODING", None)
    script = (
        "import locale, sys, build\n"
        "print(locale.getpreferredencoding(False))\n"
        "print(ascii(build.read_json(__import__('pathlib').Path(sys.argv[1]))))\n"
    )
    result = subprocess.run(
        [sys.executable, "-X", "utf8=0", "-c", script, str(manifest)],
        cwd=HERE,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )
    encoding, read = result.stdout.splitlines()
    if encoding.lower().replace("-", "") in {"utf8", "ascii", "ansi_x3.41968"}:
        pytest.skip(f"no {LATIN1} locale on this host")
    assert read == ascii({"zh-Hant": "電"})
