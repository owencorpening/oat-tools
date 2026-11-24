#!/usr/bin/env python3
"""Generate a single self-contained dashboard.html from the OAT data CSVs.

Reads (all local, all optional — a missing source renders as an empty panel):
  ~/oat-data/stats/stats-log.csv          LinkedIn + Substack post snapshots
  ~/oat-data/stats/github-traffic-daily.csv   GitHub repo traffic per day
  ~/dev/oat-analytics/data/pageviews.csv  GoatCounter site pageviews

Writes:
  ~/oat-data/stats/dashboard.html         standalone, data baked in, no server

Design per the data-viz skill: one coherent system, categorical hue per
platform, light/dark aware, charts drawn in inline SVG (offline-safe).
Run with -I; no third-party deps.
"""
import csv, json, os, re, html, subprocess
from collections import defaultdict, OrderedDict
from datetime import datetime, date

HOME = os.path.expanduser("~")
STATS = os.path.join(HOME, "oat-data/stats/stats-log.csv")
GH = os.path.join(HOME, "oat-data/stats/github-traffic-daily.csv")
PV = os.environ.get("OAT_PAGEVIEWS") or os.path.join(HOME, "dev/oat-analytics/data/pageviews.csv")
OUT = os.path.join(HOME, "oat-data/stats/dashboard.html")

def num(x):
    try: return int(str(x).replace(",", ""))
    except: return 0

def pct(x):
    try: return float(str(x).replace("%", ""))
    except: return None

# ---------- LinkedIn + Substack ----------
def load_stats():
    rows = []
    if os.path.exists(STATS):
        with open(STATS, newline="") as f:
            rows = list(csv.DictReader(f))
    by_plat = defaultdict(list)
    for r in rows:
        by_plat[r["Platform"]].append(r)

    def platform(plat, value_col):
        rs = by_plat.get(plat, [])
        if not rs:
            return {"trend": [], "top": [], "tiles": {}}
        captures = sorted({r["Captured At"] for r in rs})
        latest = captures[-1]
        latest_rows = [r for r in rs if r["Captured At"] == latest]
        # cohort = URLs present in the latest capture; sum those across captures
        cohort = {r["URL"] for r in latest_rows}
        trend = []
        for cap in captures:
            s = sum(num(r[value_col]) for r in rs
                    if r["Captured At"] == cap and r["URL"] in cohort)
            trend.append({"x": cap, "y": s})
        top = sorted(latest_rows, key=lambda r: num(r[value_col]), reverse=True)[:8]
        top = [{"label": r["Title"], "value": num(r[value_col]), "url": r["URL"]} for r in top]
        tiles = {}
        tiles["total"] = sum(num(r[value_col]) for r in latest_rows)
        tiles["posts"] = len(latest_rows)
        if plat == "LinkedIn":
            tiles["comments"] = sum(num(r["Comments"]) for r in latest_rows)
        if plat == "Substack":
            ors = [pct(r["Open Rate"]) for r in latest_rows if pct(r["Open Rate"]) is not None]
            ers = [pct(r["Engagement Rate"]) for r in latest_rows if pct(r["Engagement Rate"]) is not None]
            tiles["open"] = round(sum(ors)/len(ors), 1) if ors else None
            tiles["eng"] = round(sum(ers)/len(ers), 1) if ers else None
        return {"trend": trend, "top": top, "tiles": tiles, "latest": latest}

    return platform("LinkedIn", "Views"), platform("Substack", "Views")

# ---------- GitHub ----------
def load_github():
    if not os.path.exists(GH):
        return {"trend": [], "top": [], "tiles": {}}
    with open(GH, newline="") as f:
        rows = list(csv.DictReader(f))
    by_day = defaultdict(lambda: {"views": 0, "clones": 0, "uv": 0})
    by_repo = defaultdict(lambda: {"views": 0, "clones": 0})
    for r in rows:
        d = r["date"]
        by_day[d]["views"] += num(r["views"])
        by_day[d]["clones"] += num(r["clones"])
        by_day[d]["uv"] += num(r["unique_visitors"])
        by_repo[r["repo"]]["views"] += num(r["views"])
        by_repo[r["repo"]]["clones"] += num(r["clones"])
    days = sorted(by_day)
    trend = [{"x": d, "y": by_day[d]["clones"], "y2": by_day[d]["views"]} for d in days]
    top = sorted(by_repo.items(), key=lambda kv: kv[1]["clones"], reverse=True)[:8]
    top = [{"label": k, "value": v["clones"],
            "sub": (f'{v["views"]} view' + ("" if v["views"] == 1 else "s")) if v["views"] else ""}
           for k, v in top if v["clones"] or v["views"]]
    tiles = {
        "clones": sum(by_day[d]["clones"] for d in days),
        "views": sum(by_day[d]["views"] for d in days),
        "repos": len([k for k, v in by_repo.items() if v["clones"] or v["views"]]),
        "span": f"{days[0]} → {days[-1]}" if days else "",
    }
    return {"trend": trend, "top": top, "tiles": tiles}

# ---------- OAT site (GoatCounter) ----------
def load_site():
    rows = []
    if os.path.exists(PV):
        with open(PV, newline="") as f:
            rows = list(csv.DictReader(f))
    by_day = defaultdict(int)
    by_path = defaultdict(int)
    for r in rows:
        d = (r.get("Date") or "")[:10]
        if d:
            by_day[d] += 1
            by_path[r.get("Path", "")] += 1
    days = sorted(by_day)
    trend = [{"x": d, "y": by_day[d]} for d in days]
    top = sorted(by_path.items(), key=lambda kv: kv[1], reverse=True)[:8]
    top = [{"label": k or "/", "value": v} for k, v in top]
    tiles = {"views": len(rows), "days": len(days)}
    return {"trend": trend, "top": top, "tiles": tiles, "empty": len(rows) == 0}

# ---------- Work: open items from GitHub Project "OAT" (number 2) ----------
# Pulled via local `gh` at generation time. A successful pull is cached to
# PROJECT_CACHE so a headless run (e.g. the 04:00 systemd timer, where the gh
# keyring may be locked) can still render the panel from the last good fetch.
PROJECT_CACHE = os.path.join(HOME, "oat-data/stats/project-items.json")
STATUS_ORDER = {"In progress": 0, "Next": 1}
PRIO_ORDER = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}

def load_work():
    items = None
    try:
        r = subprocess.run(
            ["gh", "project", "item-list", "2", "--owner", "owencorpening",
             "--format", "json", "--limit", "100"],
            capture_output=True, text=True, timeout=30)
        if r.returncode == 0:
            items = json.loads(r.stdout).get("items", [])
            try:
                with open(PROJECT_CACHE, "w") as f:
                    json.dump({"items": items, "fetched": datetime.now().isoformat()}, f)
            except Exception:
                pass
    except Exception:
        items = None
    if items is None:  # gh unavailable/unauthed — fall back to the cache
        try:
            with open(PROJECT_CACHE) as f:
                items = json.load(f).get("items", [])
        except Exception:
            items = []
    work = [it for it in items if it.get("status") in STATUS_ORDER]
    work.sort(key=lambda it: (
        STATUS_ORDER.get(it.get("status"), 9),
        PRIO_ORDER.get(it.get("priority"), 9),
        it.get("target date") or "9999-12-31",
        (it.get("content", {}).get("title") or it.get("title", "")).lower(),
    ))
    out = []
    for it in work:
        c = it.get("content", {})
        repo = (it.get("repository") or c.get("repository") or "").rsplit("/", 1)[-1]
        out.append({
            "title": c.get("title") or it.get("title", ""),
            "url": c.get("url", ""),
            "repo": repo,
            "status": it.get("status", ""),
            "priority": it.get("priority") or "",
            "target": it.get("target date") or "",
        })
    return out

DATA = {
    "github": load_github(),
    "linkedin": None,
    "substack": None,
    "site": load_site(),
    "work": load_work(),
}
DATA["linkedin"], DATA["substack"] = load_stats()

# "Data through" = the freshest date across all sources, NOT wall-clock time.
# This makes generation deterministic: a rebuild with no new data produces a
# byte-identical file (no spurious git commit when run nightly).
_dates = [t["x"] for t in DATA["github"]["trend"]] + [t["x"] for t in DATA["site"]["trend"]]
for _p in ("linkedin", "substack"):
    _lt = DATA[_p].get("latest")
    if _lt:
        _dates.append(_lt)
_dates = [d for d in _dates if d]
DATA["generated"] = max(_dates) if _dates else datetime.now().strftime("%Y-%m-%d")

HTML = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OAT Dashboard</title>
<style>
  :root{
    --bg:#f4f3f0; --surface:#fcfcfb; --border:#e3e1db;
    --text:#0b0b0b; --muted:#52514e; --faint:#8a8980;
    --github:#2a78d6; --linkedin:#eb6834; --substack:#1baf7a; --site:#eda100;
    --grid:#eceae4;
    --brass:#b8860b; --granite:#4a4f54;
    --p0:#d03b3b; --p1:#b8860b; --p2:#5c6166; --p3:#8a8980;
  }
  @media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
    --bg:#121211; --surface:#1a1a19; --border:#33322e;
    --text:#f0efec; --muted:#c3c2b7; --faint:#8f8e85;
    --github:#3987e5; --linkedin:#d95926; --substack:#199e70; --site:#c98500;
    --grid:#262521;
    --brass:#d4a017; --granite:#c9ccd0;
    --p0:#e66767; --p1:#d4a017; --p2:#a3a8ad; --p3:#8f8e85;
  }}
  :root[data-theme="dark"]{
    --bg:#121211; --surface:#1a1a19; --border:#33322e;
    --text:#f0efec; --muted:#c3c2b7; --faint:#8f8e85;
    --github:#3987e5; --linkedin:#d95926; --substack:#199e70; --site:#c98500;
    --grid:#262521;
    --brass:#d4a017; --granite:#c9ccd0;
    --p0:#e66767; --p1:#d4a017; --p2:#a3a8ad; --p3:#8f8e85;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);zoom:var(--zoom,1.3);
    font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  header{padding:24px 16px 8px;max-width:1200px;margin:0 auto;
    display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
  h1{font-size:22px;margin:0;font-weight:650}
  .fontctl{display:flex;gap:6px;flex:none}
  .fontctl button{font:650 15px/1 inherit;cursor:pointer;background:var(--surface);color:var(--text);
    border:1px solid var(--border);border-radius:8px;padding:5px 11px;min-width:34px}
  .fontctl button:hover{border-color:var(--faint)}
  .sub{color:var(--muted);font-size:13px;margin-top:2px}
  .grid{max-width:1200px;margin:0 auto;padding:16px;display:grid;gap:16px;
    grid-template-columns:repeat(2,minmax(0,1fr))}
  @media (max-width:760px){.grid{grid-template-columns:1fr}}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px}
  .card h2{font-size:15px;margin:0 0 2px;display:flex;align-items:center;gap:8px;font-weight:620}
  .dot{width:10px;height:10px;border-radius:3px;display:inline-block}
  .card .meta{color:var(--faint);font-size:12px;margin:0 0 14px}
  .card.wide{grid-column:1 / -1;border-top:3px solid var(--brass)}
  .work{display:flex;flex-direction:column}
  .wi{display:grid;grid-template-columns:auto 1fr auto;align-items:baseline;gap:12px;
    padding:10px 2px;border-top:1px solid var(--grid)}
  .wi:first-child{border-top:0}
  .wi .pri{font:800 11px/1.1 inherit;font-variant-numeric:tabular-nums;white-space:nowrap;
    padding:3px 8px;border-radius:999px}
  .wi .pri.P0{color:var(--p0);background:color-mix(in srgb,var(--p0) 15%,transparent)}
  .wi .pri.P1{color:var(--p1);background:color-mix(in srgb,var(--p1) 16%,transparent)}
  .wi .pri.P2{color:var(--p2);background:color-mix(in srgb,var(--p2) 16%,transparent)}
  .wi .pri.P3{color:var(--p3);background:color-mix(in srgb,var(--p3) 16%,transparent)}
  .wi a.t{color:var(--text);text-decoration:none;font-weight:600;overflow-wrap:anywhere}
  .wi a.t:hover{color:var(--brass);text-decoration:underline}
  .wi .m{color:var(--faint);font-size:12px;white-space:nowrap;text-align:right}
  .wi .m .repo{color:var(--muted)} .wi .m .st{color:var(--brass);font-weight:600}
  .wi .m .due.late{color:var(--p0);font-weight:700}
  .tiles{display:flex;flex-wrap:wrap;gap:18px;margin-bottom:14px}
  .tile .n{font-size:24px;font-weight:680;line-height:1.1;font-variant-numeric:tabular-nums}
  .tile .l{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
  svg{display:block;width:100%;height:auto;overflow:visible}
  .axis{fill:var(--faint);font-size:10px}
  .toplist{margin-top:14px;display:flex;flex-direction:column;gap:7px}
  .row{display:grid;grid-template-columns:1fr auto;align-items:center;gap:10px}
  .row .bar{position:relative;height:22px;border-radius:4px;background:var(--grid);overflow:hidden}
  .row .fill{position:absolute;inset:0 auto 0 0;border-radius:4px;opacity:.85}
  .row .lab{position:absolute;left:8px;top:0;height:22px;display:flex;align-items:center;
    font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:calc(100% - 12px)}
  .row .val{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums;text-align:right;min-width:52px}
  .row .val small{color:var(--faint)}
  .empty{color:var(--faint);font-style:italic;padding:18px 0;font-size:13px}
  .tip{position:fixed;pointer-events:none;background:var(--surface);border:1px solid var(--border);
    border-radius:8px;padding:6px 9px;font-size:12px;box-shadow:0 4px 14px rgba(0,0,0,.14);
    opacity:0;transition:opacity .08s;z-index:10;white-space:nowrap}
  .tip b{font-variant-numeric:tabular-nums}
  footer{max-width:1200px;margin:0 auto;padding:4px 16px 32px;color:var(--faint);font-size:12px}
</style>
</head>
<body>
<header>
  <div>
    <h1>OAT Dashboard</h1>
    <div class="sub" id="sub"></div>
  </div>
  <div class="fontctl">
    <button id="fdn" title="Smaller text" aria-label="Smaller text">A&minus;</button>
    <button id="fup" title="Larger text" aria-label="Larger text">A+</button>
  </div>
</header>
<div class="grid" id="grid"></div>
<footer id="foot"></footer>
<div class="tip" id="tip"></div>
<script id="data" type="application/json">__DATA__</script>
<script>
const DATA = JSON.parse(document.getElementById('data').textContent);
const tip = document.getElementById('tip');
const fmt = n => n.toLocaleString();
const shortDate = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? m[2]+'/'+m[3] : s; };
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmtDate = s => { const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? MON[+m[2]-1]+' '+(+m[3]) : s; };

function workPanel(items){
  const c=document.createElement('div'); c.className='card wide';
  c.innerHTML=`<h2><span class="dot" style="background:var(--brass)"></span>Work</h2>`+
    `<div class="meta">In progress &amp; Next · from GitHub Project “OAT” · ${items.length} item${items.length===1?'':'s'}</div>`;
  if(!items.length){ const e=document.createElement('div'); e.className='empty'; e.textContent='Nothing in progress or queued.'; c.appendChild(e); return c; }
  const wrap=document.createElement('div'); wrap.className='work';
  const today=new Date().toISOString().slice(0,10);
  items.forEach(it=>{
    const row=document.createElement('div'); row.className='wi';
    const pri=document.createElement('span'); pri.className='pri '+(it.priority||''); pri.textContent=it.priority||'—';
    const a=document.createElement('a'); a.className='t'; a.href=it.url||'#'; a.target='_blank'; a.rel='noopener'; a.textContent=it.title;
    const m=document.createElement('div'); m.className='m';
    let h=`<span class="repo">${it.repo}</span> · <span class="st">${it.status}</span>`;
    if(it.target){ const late=it.target<today; h+=` · <span class="due${late?' late':''}">${fmtDate(it.target)}</span>`; }
    m.innerHTML=h;
    row.appendChild(pri); row.appendChild(a); row.appendChild(m);
    wrap.appendChild(row);
  });
  c.appendChild(wrap); return c;
}

function lineChart(series, color, {baseline='auto', area=false, labelFmt=fmt}={}){
  // Uniform-scaled SVG (no preserveAspectRatio=none, so text isn't stretched).
  const W=400,H=150,padT=16,padB=22,padL=8,padR=10;
  const ns='http://www.w3.org/2000/svg';
  const svg=document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
  if(series.length===0) return svg;
  const ys=series.map(d=>d.y);
  let lo=Math.min(...ys), hi=Math.max(...ys);
  if(baseline==='zero'){ lo=0; }
  else { const r=(hi-lo)||Math.max(1,hi*0.1); lo=Math.max(0,lo-r*0.35); hi=hi+r*0.35; }
  if(hi===lo) hi=lo+1;
  const n=series.length;
  const X=i=> padL + (n===1?(W-padL-padR)/2 : i*(W-padL-padR)/(n-1));
  const Y=v=> padT + (1-(v-lo)/(hi-lo))*(H-padT-padB);
  // baseline gridline
  const g=document.createElementNS(ns,'line');
  g.setAttribute('x1',padL);g.setAttribute('x2',W-padR);
  g.setAttribute('y1',H-padB);g.setAttribute('y2',H-padB);
  g.setAttribute('stroke','var(--grid)');g.setAttribute('stroke-width','1');
  svg.appendChild(g);
  if(area){
    const a=document.createElementNS(ns,'path');
    let ap=`M ${X(0)} ${Y(series[0].y)}`; series.forEach((d,i)=>ap+=` L ${X(i)} ${Y(d.y)}`);
    ap+=` L ${X(n-1)} ${H-padB} L ${X(0)} ${H-padB} Z`;
    a.setAttribute('d',ap);a.setAttribute('fill',color);a.setAttribute('opacity','.11');svg.appendChild(a);
  }
  const path=document.createElementNS(ns,'path');
  let p=`M ${X(0)} ${Y(series[0].y)}`; series.forEach((d,i)=>p+=` L ${X(i)} ${Y(d.y)}`);
  path.setAttribute('d',p);path.setAttribute('fill','none');path.setAttribute('stroke',color);
  path.setAttribute('stroke-width','2');path.setAttribute('stroke-linejoin','round');path.setAttribute('stroke-linecap','round');
  svg.appendChild(path);
  // endpoint dots
  [0,n-1].forEach(i=>{ const c=document.createElementNS(ns,'circle');
    c.setAttribute('cx',X(i));c.setAttribute('cy',Y(series[i].y));c.setAttribute('r','3.5');c.setAttribute('fill',color);svg.appendChild(c);});
  // x labels first/last
  const mk=(i,anchor)=>{const t=document.createElementNS(ns,'text');
    t.setAttribute('x',X(i));t.setAttribute('y',H-6);t.setAttribute('class','axis');
    t.setAttribute('text-anchor',anchor);t.textContent=shortDate(series[i].x);svg.appendChild(t);};
  mk(0,'start'); if(n>1) mk(n-1,'end');
  // value label on last point
  const vt=document.createElementNS(ns,'text');
  vt.setAttribute('x',X(n-1));vt.setAttribute('y',Math.max(11,Y(series[n-1].y)-7));
  vt.setAttribute('text-anchor','end');vt.setAttribute('fill',color);
  vt.setAttribute('font-size','11');vt.setAttribute('font-weight','650');
  vt.textContent=labelFmt(series[n-1].y);svg.appendChild(vt);
  // hover crosshair + marker
  const cross=document.createElementNS(ns,'line');
  cross.setAttribute('stroke','var(--faint)');cross.setAttribute('stroke-width','1');cross.setAttribute('opacity','0');svg.appendChild(cross);
  const hv=document.createElementNS(ns,'circle');hv.setAttribute('r','4');hv.setAttribute('fill',color);
  hv.setAttribute('stroke','var(--surface)');hv.setAttribute('stroke-width','1.5');hv.setAttribute('opacity','0');svg.appendChild(hv);
  svg.addEventListener('pointermove',e=>{
    const r=svg.getBoundingClientRect(); const rel=(e.clientX-r.left)/r.width*W;
    let bi=0,bd=1e9;series.forEach((d,i)=>{const dd=Math.abs(X(i)-rel);if(dd<bd){bd=dd;bi=i;}});
    const cx=X(bi),cy=Y(series[bi].y);
    cross.setAttribute('x1',cx);cross.setAttribute('x2',cx);cross.setAttribute('y1',padT);cross.setAttribute('y2',H-padB);cross.setAttribute('opacity','1');
    hv.setAttribute('cx',cx);hv.setAttribute('cy',cy);hv.setAttribute('opacity','1');
    tip.innerHTML=`${series[bi].x}<br><b>${labelFmt(series[bi].y)}</b>`;
    tip.style.left=(e.clientX+12)+'px';tip.style.top=(e.clientY-10)+'px';tip.style.opacity=1;
  });
  svg.addEventListener('pointerleave',()=>{tip.style.opacity=0;cross.setAttribute('opacity','0');hv.setAttribute('opacity','0');});
  return svg;
}

function topList(items, color, valFmt){
  const wrap=document.createElement('div'); wrap.className='toplist';
  if(!items.length){ const e=document.createElement('div'); e.className='empty'; e.textContent='No data yet.'; wrap.appendChild(e); return wrap; }
  const max=Math.max(...items.map(i=>i.value),1);
  items.forEach(it=>{
    const row=document.createElement('div'); row.className='row';
    const bar=document.createElement('div'); bar.className='bar';
    const fill=document.createElement('div'); fill.className='fill';
    fill.style.width=Math.max(2,it.value/max*100)+'%'; fill.style.background=color;
    const lab=document.createElement('div'); lab.className='lab'; lab.textContent=it.label; lab.title=it.label;
    bar.appendChild(fill); bar.appendChild(lab);
    const val=document.createElement('div'); val.className='val';
    val.innerHTML = (valFmt?valFmt(it.value):fmt(it.value)) + (it.sub?` <small>${it.sub}</small>`:'');
    row.appendChild(bar); row.appendChild(val); wrap.appendChild(row);
  });
  return wrap;
}

function tiles(defs){
  const w=document.createElement('div'); w.className='tiles';
  defs.forEach(d=>{ if(d.v==null) return;
    const t=document.createElement('div'); t.className='tile';
    t.innerHTML=`<div class="n">${d.v}</div><div class="l">${d.l}</div>`; w.appendChild(t); });
  return w;
}

function card({name,color,meta,tileDefs,series,seriesLabelFmt,chartOpts,top,topValFmt,empty,emptyMsg}){
  const c=document.createElement('div'); c.className='card';
  c.innerHTML=`<h2><span class="dot" style="background:${color}"></span>${name}</h2>`+
              (meta?`<div class="meta">${meta}</div>`:'');
  c.appendChild(tiles(tileDefs));
  if(empty){ const e=document.createElement('div'); e.className='empty'; e.textContent=emptyMsg; c.appendChild(e); }
  else{
    if(series && series.length) c.appendChild(lineChart(series,color,Object.assign({labelFmt:seriesLabelFmt},chartOpts||{})));
    c.appendChild(topList(top||[],color,topValFmt));
  }
  return c;
}

const C={github:getComputedStyle(document.documentElement).getPropertyValue('--github').trim(),
         linkedin:getComputedStyle(document.documentElement).getPropertyValue('--linkedin').trim(),
         substack:getComputedStyle(document.documentElement).getPropertyValue('--substack').trim(),
         site:getComputedStyle(document.documentElement).getPropertyValue('--site').trim()};

document.getElementById('sub').textContent=`GitHub · LinkedIn · Substack · Site — data through ${DATA.generated}`;
const grid=document.getElementById('grid');

grid.appendChild(workPanel(DATA.work||[]));

const g=DATA.github;
grid.appendChild(card({name:'GitHub traffic',color:C.github,meta:g.tiles.span||'',
  tileDefs:[{l:'Clones',v:fmt(g.tiles.clones||0)},{l:'Views',v:fmt(g.tiles.views||0)},{l:'Repos active',v:g.tiles.repos||0}],
  series:g.trend,seriesLabelFmt:fmt,chartOpts:{baseline:'zero',area:true},top:g.top}));

const li=DATA.linkedin;
grid.appendChild(card({name:'LinkedIn',color:C.linkedin,meta:li.latest?`25-post cohort · latest ${li.latest}`:'',
  tileDefs:[{l:'Impressions',v:fmt(li.tiles.total||0)},{l:'Comments',v:fmt(li.tiles.comments||0)},{l:'Posts',v:li.tiles.posts||0}],
  series:li.trend,seriesLabelFmt:fmt,chartOpts:{baseline:'auto',area:false},top:li.top}));

const sb=DATA.substack;
grid.appendChild(card({name:'Substack',color:C.substack,meta:sb.latest?`25-post cohort · latest ${sb.latest}`:'',
  tileDefs:[{l:'Views',v:fmt(sb.tiles.total||0)},{l:'Avg open',v:sb.tiles.open!=null?sb.tiles.open+'%':null},
            {l:'Avg engage',v:sb.tiles.eng!=null?sb.tiles.eng+'%':null},{l:'Posts',v:sb.tiles.posts||0}],
  series:sb.trend,seriesLabelFmt:fmt,chartOpts:{baseline:'auto',area:false},top:sb.top}));

const st=DATA.site;
grid.appendChild(card({name:'OAT site (owensappliedthinking.com)',color:C.site,
  meta:'GoatCounter pageviews',
  tileDefs:[{l:'Pageviews',v:fmt(st.tiles.views||0)},{l:'Days',v:st.tiles.days||0}],
  series:st.trend,seriesLabelFmt:fmt,chartOpts:{baseline:'zero',area:true},top:st.top,
  empty:st.empty,emptyMsg:'No visits yet — the log was reset to a clean slate on 2026-11-23. This fills in as real visitors arrive (your own devices are ignored).'}));

document.getElementById('foot').textContent=
  'Self-contained snapshot — regenerated automatically after each weekly stats pull. Data stays on this machine.';

// Font-size control: scales the whole page via CSS zoom; remembered per viewer.
(function(){
  const root=document.documentElement;
  let z=1.3;
  try{ const s=localStorage.getItem('oat-dash-zoom'); if(s){ const p=parseFloat(s); if(p) z=p; } }catch(e){}
  const clamp=v=>Math.min(2.2,Math.max(0.8,Math.round(v*20)/20));
  const apply=()=>{ z=clamp(z); root.style.setProperty('--zoom',z);
    try{ localStorage.setItem('oat-dash-zoom',z); }catch(e){} };
  apply();
  document.getElementById('fup').onclick=()=>{ z+=0.1; apply(); };
  document.getElementById('fdn').onclick=()=>{ z-=0.1; apply(); };
})();
</script>
</body>
</html>
"""

out_html = HTML.replace("__DATA__", json.dumps(DATA))
with open(OUT, "w") as f:
    f.write(out_html)
print(f"wrote {OUT} ({len(out_html):,} bytes)")
print("sources:",
      "stats" if os.path.exists(STATS) else "stats:MISSING",
      "github" if os.path.exists(GH) else "github:MISSING",
      "site" if os.path.exists(PV) else "site:MISSING")
