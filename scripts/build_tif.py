"""Build docs/data/tif.geojson — the map's TIF-district overlay.

Source: City of Chicago "Boundaries - Tax Increment Financing Districts"
(Socrata eejr-xtfb). Same approach as build_zoning.py: simplify server-side and
round coordinates so the ~100 active districts ship as one small static file,
lazy-loaded when the user toggles the TIF layer on.

Re-run after the city updates TIF boundaries: `python scripts/build_tif.py`.
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from pathlib import Path

DATASET = "eejr-xtfb"
DOMAIN = "data.cityofchicago.org"
SIMPLIFY_TOLERANCE = 0.00003  # ~3 m — plenty for an overlay
COORD_DECIMALS = 5
OUT = Path(__file__).resolve().parents[1] / "docs" / "data" / "tif.geojson"


def _round_coords(node):
    if isinstance(node, list):
        if node and isinstance(node[0], (int, float)):
            return [round(float(c), COORD_DECIMALS) for c in node]
        return [_round_coords(child) for child in node]
    return node


def fetch() -> dict:
    params = urllib.parse.urlencode(
        {
            "$select": f"simplify(the_geom,{SIMPLIFY_TOLERANCE}) as the_geom,name,ref,expiration",
            "$limit": "500",
        }
    )
    url = f"https://{DOMAIN}/resource/{DATASET}.geojson?{params}"
    with urllib.request.urlopen(url, timeout=120) as resp:
        return json.load(resp)


def main() -> None:
    fc = fetch()
    features = []
    for feat in fc.get("features", []):
        geom = feat.get("geometry")
        if not geom:
            continue
        props = feat.get("properties", {})
        geom["coordinates"] = _round_coords(geom.get("coordinates", []))
        features.append(
            {
                "type": "Feature",
                "geometry": geom,
                "properties": {
                    "name": (props.get("name") or "").strip(),
                    "ref": (props.get("ref") or "").strip(),
                    "exp": (props.get("expiration") or "")[:4],  # expiration year
                },
            }
        )
    out = {"type": "FeatureCollection", "features": features}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    size_mb = OUT.stat().st_size / 1_048_576
    print(f"wrote {len(features)} TIF districts -> {OUT} ({size_mb:.2f} MB)")


if __name__ == "__main__":
    main()
