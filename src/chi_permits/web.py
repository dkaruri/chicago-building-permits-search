from __future__ import annotations

import threading

import duckdb
import httpx
import uvicorn
from starlette.applications import Starlette
from starlette.responses import HTMLResponse, JSONResponse
from starlette.routing import Route

from .config import DATASET_ID, OPEN_STATUS_SQL, SOCRATA_DOMAIN, db_path, jsonable
from .db import connect
from .ingest import run_ingest
from .tools.permits import contact_detail_from, contact_summary_from, open_permits_from

UPDATE_STATE = {"running": False, "last_result": None, "error": None}


def _json(data, status_code: int = 200):
    return JSONResponse(jsonable(data), status_code=status_code)


def _read_con():
    """Open a read-only connection, returning (con, None) or (None, error_response)."""
    try:
        return connect(read_only=True), None
    except (OSError, RuntimeError) as e:
        return None, _json({"error": "Database unavailable, possibly refreshing", "detail": str(e)}, 503)


def _remote_rows_updated_at() -> int | None:
    url = f"https://{SOCRATA_DOMAIN}/api/views/{DATASET_ID}"
    with httpx.Client(timeout=30.0, follow_redirects=True) as client:
        r = client.get(url)
        r.raise_for_status()
        return int(r.json().get("rowsUpdatedAt") or 0)


def _local_meta():
    con = connect(read_only=True)
    try:
        row = con.execute("""
            SELECT row_count, ingested_at, rows_updated_at, source_url
            FROM meta
        """).fetchone()
        span = con.execute("""
            SELECT min(issue_date), max(issue_date),
                   count(*) FILTER (WHERE permit_status IN {OPEN_STATUS_SQL})
            FROM permits
        """).fetchone()
    finally:
        con.close()
    return {
        "row_count": row[0],
        "ingested_at": row[1],
        "rows_updated_at": row[2],
        "source_url": row[3],
        "first_issue_date": span[0],
        "latest_issue_date": span[1],
        "open_permit_count": span[2],
    }


async def home(request):
    return HTMLResponse(INDEX_HTML)


async def api_status(request):
    meta = _local_meta()
    try:
        remote = _remote_rows_updated_at()
    except Exception as e:
        remote = None
        meta["remote_check_error"] = str(e)
    meta["remote_rows_updated_at"] = remote
    meta["update_available"] = remote is not None and int(meta["rows_updated_at"] or 0) < remote
    meta["auto_update_started"] = False
    if meta["update_available"]:
        meta["auto_update_started"] = _start_update_if_idle()
    meta["update_state"] = UPDATE_STATE
    return _json(meta)


async def api_contacts(request):
    q = request.query_params.get("q") or None
    category = request.query_params.get("category") or "general_contractor"
    n = min(int(request.query_params.get("n", "50")), 200)
    con, err = _read_con()
    if err:
        return err
    try:
        return _json(contact_summary_from(con, category, q, n))
    finally:
        con.close()


async def api_contact_detail(request):
    name = request.query_params.get("name")
    category = request.query_params.get("category") or None
    n = min(int(request.query_params.get("n", "80")), 300)
    if not name:
        return _json({"error": "name is required"}, 400)
    con, err = _read_con()
    if err:
        return err
    try:
        return _json(contact_detail_from(con, name, category, n))
    finally:
        con.close()


async def api_open_permits(request):
    q = request.query_params.get("q") or None
    category = request.query_params.get("category") or None
    ward_raw = request.query_params.get("ward")
    ward = int(ward_raw) if ward_raw else None
    n = min(int(request.query_params.get("n", "80")), 300)
    con, err = _read_con()
    if err:
        return err
    try:
        return _json(open_permits_from(con, n=n, query=q, contact_category=category, ward=ward))
    finally:
        con.close()


def _update_worker():
    UPDATE_STATE.update({"running": True, "error": None})
    try:
        UPDATE_STATE["last_result"] = run_ingest()
    except Exception as e:
        UPDATE_STATE["error"] = str(e)
    finally:
        UPDATE_STATE["running"] = False


def _start_update_if_idle() -> bool:
    if UPDATE_STATE["running"]:
        return False
    t = threading.Thread(target=_update_worker, daemon=True)
    t.start()
    return True


async def api_update(request):
    return _json({"started": _start_update_if_idle(), "state": UPDATE_STATE})


routes = [
    Route("/", home),
    Route("/api/status", api_status),
    Route("/api/contacts", api_contacts),
    Route("/api/contact-detail", api_contact_detail),
    Route("/api/open-permits", api_open_permits),
    Route("/api/update", api_update, methods=["POST"]),
]

app = Starlette(debug=False, routes=routes)


INDEX_HTML = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chicago Open Permits Search</title>
<style>
:root{--bg:#10131c;--panel:#171d2a;--ink:#f5eddc;--muted:#aeb6c6;--edge:#30394d;--mint:#82efb4;--berry:#ff638e;--violet:#b9a8ff;--brass:#d8b85d}
*{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,Segoe UI,Arial,sans-serif}
body:before{content:"";position:fixed;inset:0;pointer-events:none;background-image:linear-gradient(rgba(174,182,198,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(174,182,198,.06) 1px,transparent 1px);background-size:32px 32px}
header{position:relative;padding:28px 32px 14px;border-bottom:1px solid var(--edge);background:rgba(16,19,28,.85);backdrop-filter:blur(10px)}
h1{font-family:Georgia,serif;font-weight:400;font-size:clamp(32px,5vw,68px);margin:8px 0 4px}.kicker{letter-spacing:.25em;text-transform:uppercase;color:var(--mint);font-size:12px}.sub{color:var(--muted);max-width:920px;line-height:1.45}
main{position:relative;max-width:1320px;margin:0 auto;padding:22px}.status,.panel{background:rgba(23,29,42,.96);border:1px solid var(--edge);border-radius:6px;padding:16px}.status{display:flex;gap:18px;flex-wrap:wrap;align-items:center;margin-bottom:18px}.status b{color:var(--mint)}
.grid{display:grid;grid-template-columns:360px minmax(0,1fr);gap:18px}.controls{display:grid;gap:12px;align-content:start}label{display:grid;gap:6px;color:var(--muted);font-size:12px;letter-spacing:.08em;text-transform:uppercase}
input,select,button{background:#111722;color:var(--ink);border:1px solid var(--edge);border-radius:5px;padding:10px;font:inherit}button{cursor:pointer}button.primary{background:var(--mint);color:#10131c;font-weight:700;border-color:var(--mint)}
.tabs{display:flex;gap:8px;flex-wrap:wrap}.tabs button.active{background:var(--berry);border-color:var(--berry);color:white}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{border-bottom:1px solid var(--edge);padding:9px 7px;text-align:left;vertical-align:top}th{color:var(--violet);font-size:11px;text-transform:uppercase;letter-spacing:.12em}tr{cursor:pointer}tr:hover{background:rgba(130,239,180,.06)}
.split{display:grid;grid-template-columns:minmax(0,1fr) minmax(360px,.75fr);gap:18px}.detail{max-height:680px;overflow:auto}.pill{display:inline-block;border:1px solid var(--edge);border-radius:999px;padding:2px 7px;color:var(--muted);font-size:12px;margin:2px}.small{color:var(--muted);font-size:13px}.money{color:var(--brass)}.spec{border-top:1px solid var(--edge);border-bottom:1px solid var(--edge);padding:12px 0;margin:12px 0}.spec h4{margin:8px 0 5px;color:var(--violet);font-size:12px;letter-spacing:.12em;text-transform:uppercase}.spec .pill{color:var(--ink)}@media(max-width:960px){.grid,.split{grid-template-columns:1fr}}
</style>
</head>
<body>
<header><div class="kicker">Chicago Building Permits Search</div><h1>Open Permits + Contacts</h1><p class="sub">Search open permits, General Contractors, and Open Subs using the local DuckDB generated from Chicago Data Portal Building Permits.</p></header>
<main>
  <section class="status" id="status">Loading status...</section>
  <section class="grid">
    <aside class="panel controls">
      <div class="tabs">
        <button id="tab-gc" class="active" onclick="setMode('general_contractor')">General Contractors</button>
        <button id="tab-tech" onclick="setMode('open_tech')">Open Subs</button>
        <button id="tab-open" onclick="setMode('open_permits')">Open Permits</button>
      </div>
      <label>Search <input id="q" placeholder="Name, permit, address, work..." onkeydown="if(event.key==='Enter') search()"></label>
      <label>Ward <input id="ward" placeholder="Optional, open permits only" onkeydown="if(event.key==='Enter') search()"></label>
      <button class="primary" onclick="search()">Search</button>
      <button onclick="updateData()">Check portal + refresh data</button>
      <p class="small">Open permits are statuses ACTIVE, SUSPENDED, or PHASED PERMITTING. Contact information is limited to public portal fields: name, type, city, state, ZIP.</p>
    </aside>
    <section class="split">
      <div class="panel"><h2 id="results-title">Results</h2><div id="results"></div></div>
      <div class="panel detail"><h2>Detail</h2><div id="detail" class="small">Select a result.</div></div>
    </section>
  </section>
</main>
<script>
let mode='general_contractor';
const $=id=>document.getElementById(id);
const fmt=n=>n==null?'':Number(n).toLocaleString();
const money=n=>n==null?'':('$'+Number(n).toLocaleString(undefined,{maximumFractionDigits:0}));
async function loadStatus(){
 const s=await fetch('/api/status').then(r=>r.json());
 $('status').innerHTML=`<span><b>${fmt(s.row_count)}</b> permits</span><span><b>${fmt(s.open_permit_count)}</b> open permits</span><span>Issue dates <b>${s.first_issue_date}</b> to <b>${s.latest_issue_date}</b></span><span>Ingested <b>${s.ingested_at}</b></span><span>${s.update_available?'Update available':'Up to date'}</span>`;
}
function setMode(m){mode=m; ['gc','tech','open'].forEach(x=>$('tab-'+x).classList.remove('active')); $(m==='general_contractor'?'tab-gc':m==='open_tech'?'tab-tech':'tab-open').classList.add('active'); search();}
async function search(){
 const q=encodeURIComponent($('q').value.trim()); const ward=$('ward').value.trim();
 if(mode==='open_permits'){
  const url=`/api/open-permits?q=${q}&n=100${ward?'&ward='+encodeURIComponent(ward):''}`;
  const data=await fetch(url).then(r=>r.json()); renderPermits(data.rows||[]);
 } else {
  const data=await fetch(`/api/contacts?category=${mode}&q=${q}&n=100`).then(r=>r.json()); renderContacts(data.rows||[]);
 }
}
function renderContacts(rows){
 $('results-title').textContent=mode==='general_contractor'?'General Contractors':'Open Subs';
 $('results').innerHTML=`<table><thead><tr><th>Name</th><th>Type</th><th>Contact</th><th>Open Jobs</th><th>Avg Days</th></tr></thead><tbody>${rows.map(r=>`<tr onclick='detail(${JSON.stringify(r.contact_name)})'><td>${r.contact_name||''}</td><td>${r.sample_contact_type||''}</td><td>${[r.city,r.state,r.zipcode].filter(Boolean).join(', ')}</td><td>${fmt(r.open_jobs)}</td><td>${r.avg_processing_days==null?'':Number(r.avg_processing_days).toFixed(1)}</td></tr>`).join('')}</tbody></table>`;
}
async function detail(name){
 const data=await fetch(`/api/contact-detail?category=${mode}&name=${encodeURIComponent(name)}&n=80`).then(r=>r.json());
 const s=data.summary||{};
 $('detail').innerHTML=`<h3>${name}</h3><p><span class="pill">${fmt(s.open_jobs)} open jobs</span> <span class="pill">${fmt(s.total_jobs)} total jobs</span> <span class="pill">${s.avg_processing_days==null?'':Number(s.avg_processing_days).toFixed(1)} avg processing days</span></p>${renderSpecialties(data.specialties||{})}`+renderPermitTable(data.jobs||[]);
}
function specPills(rows,labelKey){return (rows||[]).map(r=>`<span class="pill">${r[labelKey]||''} · ${fmt(r.jobs)} jobs${r.open_jobs?`, ${fmt(r.open_jobs)} open`:''}</span>`).join('')||'<span class="small">No clear pattern in available records.</span>'}
function renderSpecialties(s){return `<div class="spec"><h4>Specializes in: work types</h4>${specPills(s.work_types,'work_type')}<h4>Permit mix</h4>${specPills(s.permit_types,'permit_type')}<h4>Public contact roles</h4>${specPills(s.contact_types,'contact_type')}</div>`}
function renderPermits(rows){$('results-title').textContent='Open Permits'; $('results').innerHTML=renderPermitTable(rows);}
function renderPermitTable(rows){return `<table><thead><tr><th>Permit</th><th>Status</th><th>Issued</th><th>Address</th><th>Ward</th><th>Cost</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.permit_number||''}</td><td>${r.permit_status||''}</td><td>${r.issue_date||''}</td><td>${r.address||''}<br><span class="small">${r.permit_type||''}</span></td><td>${r.ward||''}</td><td class="money">${money(r.reported_cost)}</td></tr>`).join('')}</tbody></table>`}
async function updateData(){const r=await fetch('/api/update',{method:'POST'}).then(r=>r.json()); alert(r.started?'Refresh started. Reload status in a few minutes.':'Refresh already running.');}
loadStatus(); search();
</script>
</body>
</html>"""


def main() -> None:
    uvicorn.run("chi_permits.web:app", host="127.0.0.1", port=8765, reload=False)
