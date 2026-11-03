"""Build data.json for the Meridian Watch site.

Usage: python3 -I tools/build_data.py EXPORT_DIR data.json
EXPORT_DIR holds one folder per collection (hotspots, news, timeline,
chokepoints, markets, measures, meta), each with <doc_id>.json files as
saved by the ArtifactData tool's `out_dir` option.
"""
import glob, json, os, sys

src, dst = sys.argv[1], sys.argv[2]
out = {}
for col in ["hotspots", "news", "timeline", "chokepoints", "markets", "measures"]:
    rows = []
    for f in sorted(glob.glob(os.path.join(src, col, "*.json"))):
        j = json.load(open(f))
        d = dict(j.get("data", j))
        d["id"] = os.path.basename(f)[:-5]
        rows.append(d)
    if not rows:
        sys.exit(f"refusing to write: collection '{col}' is empty in {src}")
    out[col] = rows
m = os.path.join(src, "meta", "status.json")
out["meta"] = json.load(open(m)).get("data", {}) if os.path.exists(m) else {}
json.dump(out, open(dst, "w"), ensure_ascii=False, separators=(",", ":"))
print({k: len(v) for k, v in out.items() if isinstance(v, list)})
