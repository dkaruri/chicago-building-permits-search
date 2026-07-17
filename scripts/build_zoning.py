"""Build docs/data/zoning.geojson — the map's zoning overlay.

Source: City of Chicago "Boundaries - Zoning Districts (current)" (Socrata
dj47-wfun). We simplify the geometry server-side and round coordinates so the
~15k polygons ship as one ~8 MB static file (about 2.3 MB gzipped over Pages),
loaded once when the user toggles the zoning layer on. No PMTiles/tippecanoe
toolchain needed — MapLibre renders the simplified GeoJSON directly.

Re-run after the city updates zoning: `python scripts/build_zoning.py`.
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from pathlib import Path

DATASET = "dj47-wfun"
DOMAIN = "data.cityofchicago.org"
SIMPLIFY_TOLERANCE = 0.00003  # ~3 m in lat/lon degrees — plenty for an overlay
COORD_DECIMALS = 5  # ~1 m; further precision is wasted on a simplified overlay
OUT = Path(__file__).resolve().parents[1] / "docs" / "data" / "zoning.geojson"


def zone_category(zone_class: str) -> str:
    """Collapse the ~90 zone classes into the buckets the map colors by."""
    z = (zone_class or "").strip().upper()
    if not z:
        return "other"
    if z.startswith("PD") or "PD " in z:
        return "planned_development"
    if z.startswith("PMD"):
        return "manufacturing"
    if z.startswith("POS"):
        return "open_space"
    if z.startswith(("RS", "RT", "RM")):
        return "residential"
    if z.startswith("B"):
        return "business"
    if z.startswith("C"):
        return "commercial"
    if z.startswith("M"):
        return "manufacturing"
    if z.startswith("D"):  # DX, DC, DR, DS — downtown
        return "downtown"
    if z.startswith("T"):
        return "transportation"
    return "other"


def _round_coords(node):
    """Recursively round coordinate numbers in a GeoJSON geometry."""
    if isinstance(node, list):
        if node and isinstance(node[0], (int, float)):
            return [round(float(c), COORD_DECIMALS) for c in node]
        return [_round_coords(child) for child in node]
    return node


def fetch() -> dict:
    params = urllib.parse.urlencode(
        {
            "$select": f"simplify(the_geom,{SIMPLIFY_TOLERANCE}) as the_geom,zone_class,pd_num",
            "$limit": "20000",
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
            continue  # a few rows carry no geometry; nothing to draw
        props = feat.get("properties", {})
        zone_class = props.get("zone_class") or ""
        geom["coordinates"] = _round_coords(geom.get("coordinates", []))
        features.append(
            {
                "type": "Feature",
                "geometry": geom,
                "properties": {
                    "zone_class": zone_class,
                    "zcat": zone_category(zone_class),
                },
            }
        )
    out = {"type": "FeatureCollection", "features": features}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    size_mb = OUT.stat().st_size / 1_048_576
    print(f"wrote {len(features)} zoning polygons -> {OUT} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
