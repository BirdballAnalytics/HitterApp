/* ============================================================
   BOC Eagles — Hitter Report (web port of HitterApp.R)
   ============================================================ */

const TEAM = "BOC_EAG";

const PITCH_COLORS = {
  "Sinker":"#de6a04","Slider":"#eee716","ChangeUp":"#1dbe3a","Changeup":"#1dbe3a",
  "Fastball":"#d22d49","FourSeamFastBall":"#d22d49","TwoSeam":"#de6a04",
  "Splitter":"#3bacac","Curveball":"#00d1ed","Knuckle Curve":"#6236cd",
  "Cutter":"#933f2c","Slurve":"#93afd4","Sweeper":"#ddb33a","Screwball":"#32cd32",
  "Forkball":"#aaf0d1","Slow Curve":"#4169e1","Knuckleball":"#a9a9a9","Other":"#999999"
};
const RESULT_COLORS = {
  "Single":"#D8CCA6","Double":"#0D6EE2","Triple":"#FFDE00","HomeRun":"#8C2232",
  "Out":"#999999","Error":"#cc2222"
};
const HARD_HIT_COLORS = {"95+":"#22c55e","75-95":"#eab308","0-74":"#ef4444"};

/* Season list + date ranges are derived from the data itself (not hardcoded),
   so new seasons that show up in future data files are picked up automatically.
   Each row already carries a `Season` label computed by the build script.
   NOTE: computed further below, once ALL_ROWS exists — see SEASON_DATE_RANGES. */
function computeSeasonRanges(){
  const map = new Map();
  ALL_ROWS.forEach(r=>{
    if (!r.Season || !r.Date) return;
    if (!map.has(r.Season)) map.set(r.Season, [r.Date, r.Date]);
    const cur = map.get(r.Season);
    if (r.Date < cur[0]) cur[0] = r.Date;
    if (r.Date > cur[1]) cur[1] = r.Date;
  });
  // Most recent season first
  return new Map([...map.entries()].sort((a,b)=> b[1][1].localeCompare(a[1][1])));
}

/* ── Load embedded data ── */
const RAW = JSON.parse(document.getElementById("data-blob").textContent);
const COLS = RAW.cols;
const COL_IDX = {};
COLS.forEach((c,i)=>COL_IDX[c]=i);

// Convert array-of-arrays into array-of-objects once
const ALL_ROWS = RAW.rows.map(r=>{
  const o = {};
  for (let i=0;i<COLS.length;i++) o[COLS[i]] = r[i];
  return o;
});

// Now that ALL_ROWS exists, derive the season list/date-ranges from it.
const SEASON_DATE_RANGES = computeSeasonRanges();

/* ============================================================
   FILTER STATE
   ============================================================ */
const state = {
  mode: null,        // 'hitting' | 'pitching' | 'scout' | 'lab'
  season: "2026 SPRING",
  dateStart: null,
  dateEnd: null,
  player: "All",
  team: null,
  games: ["All"]
};

function inRange(dateStr, start, end){
  if (!dateStr) return false;
  return dateStr >= start && dateStr <= end;
}

// Players available for current season/date range, scoped to the active mode
function filteredPlayers(){
  const [s,e] = [state.dateStart, state.dateEnd];
  const set = new Set();
  if (state.mode === 'pitching'){
    ALL_ROWS.forEach(r=>{
      if (r.PitcherTeam===TEAM && inRange(r.Date,s,e)) set.add(r.Pitcher);
    });
  } else if (state.mode === 'scout'){
    ALL_ROWS.forEach(r=>{
      if (r.PitcherTeam && inRange(r.Date,s,e)) set.add(`${r.Pitcher}||${r.PitcherTeam}`);
    });
  } else {
    ALL_ROWS.forEach(r=>{
      if (r.BatterTeam===TEAM && inRange(r.Date,s,e)) set.add(r.Batter);
    });
  }
  return [...set].sort();
}

// Games available for current date range
function filteredGames(){
  const [s,e] = [state.dateStart, state.dateEnd];
  const set = new Set();
  ALL_ROWS.forEach(r=>{
    if (inRange(r.Date,s,e) && r.Game) set.add(r.Game);
  });
  return [...set].sort().reverse();
}

// Core filtered dataset — mirrors R's fdata() / apply_filters(), mode-aware
function fdata(){
  const [s,e] = [state.dateStart, state.dateEnd];
  const playerAll = state.player === "All";
  const gamesAll = state.games.includes("All") || state.games.length===0;
  const gameSet = gamesAll ? null : new Set(state.games);

  return ALL_ROWS.filter(r=>{
    if (state.mode === 'pitching'){
      if (playerAll){ if (r.PitcherTeam !== TEAM) return false; }
      else { if (r.Pitcher !== state.player) return false; }
    } else if (state.mode === 'scout'){
      if (!state.player || state.player === "All") return false; // scouting report always needs one pitcher picked
      const [pName, pTeam] = state.player.split('||');
      if (r.Pitcher !== pName || r.PitcherTeam !== pTeam) return false;
    } else {
      if (playerAll){ if (r.BatterTeam !== TEAM) return false; }
      else { if (r.Batter !== state.player) return false; }
    }
    if (!inRange(r.Date, s, e)) return false;
    if (gameSet && !gameSet.has(r.Game)) return false;
    return true;
  });
}

// All pitches thrown by every pitcher on a given team, respecting the
// season/date-range/game filters — used by the Cheat Sheet (whole staff),
// as opposed to fdata() which is scoped to a single selected player.
function teamData(){
  const [s,e] = [state.dateStart, state.dateEnd];
  const gamesAll = state.games.includes("All") || state.games.length===0;
  const gameSet = gamesAll ? null : new Set(state.games);
  if (!state.team) return [];
  return ALL_ROWS.filter(r=>{
    if (r.PitcherTeam !== state.team) return false;
    if (!inRange(r.Date, s, e)) return false;
    if (gameSet && !gameSet.has(r.Game)) return false;
    return true;
  });
}

/* ============================================================
   AGGREGATION HELPERS  (mirror R summarise_* functions)
   ============================================================ */
const sum = (arr,f)=>arr.reduce((a,r)=>a+(f(r)||0),0);
const mean = (arr,f)=>{
  const vals = arr.map(f).filter(v=>v!==null && v!==undefined && !Number.isNaN(v));
  if (!vals.length) return NaN;
  return vals.reduce((a,b)=>a+b,0)/vals.length;
};
const maxOf = (arr,f)=>{
  const vals = arr.map(f).filter(v=>v!==null && v!==undefined && !Number.isNaN(v));
  if (!vals.length) return NaN;
  return Math.max(...vals);
};
const fmt3 = v => (v===null||v===undefined||Number.isNaN(v)) ? "-" : v.toFixed(3);
const fmt0 = v => (v===null||v===undefined||Number.isNaN(v)) ? "-" : Math.round(v).toString();
const fmt1 = v => (v===null||v===undefined||Number.isNaN(v)) ? "-" : v.toFixed(1);
const pct1 = v => (v===null||v===undefined||Number.isNaN(v)) ? "-" : (v*100).toFixed(1)+"%";

function traditionalStats(rows){
  const PA = sum(rows,r=>r.PA), AB = sum(rows,r=>r.AB), H = sum(rows,r=>r.H);
  const singles = sum(rows,r=>r.Single), doubles = sum(rows,r=>r.Double),
        triples = sum(rows,r=>r.Triple), hr = sum(rows,r=>r.HR);
  const TB = singles + doubles*2 + triples*3 + hr*4;
  const SO = sum(rows,r=>r.SO), HBP = sum(rows,r=>r.HBP);
  const BB = Math.max(sum(rows,r=>r.BB) - HBP, 0);
  const AVG = AB? H/AB : NaN, OBP = PA? (H+BB+HBP)/PA : NaN, SLG = AB? TB/AB : NaN;
  return {
    Pitches: rows.length, PA, AB, H, "1B":singles, "2B":doubles, "3B":triples, HR:hr, TB,
    SO, HBP, BB, AVG:fmt3(AVG), OBP:fmt3(OBP), SLG:fmt3(SLG), OPS:fmt3(OBP+SLG)
  };
}

function advancedStats(rows){
  const BIP = sum(rows,r=>r.InPlay), PA = sum(rows,r=>r.PA);
  const inPlayRows = rows.filter(r=>r.InPlay);
  const AB = sum(inPlayRows,r=>r.AB), H = sum(inPlayRows,r=>r.H);
  const singles = sum(rows,r=>r.Single), doubles = sum(rows,r=>r.Double),
        triples = sum(rows,r=>r.Triple), hr = sum(rows,r=>r.HR);
  const TB = singles + doubles*2 + triples*3 + hr*4;
  const HBP = sum(rows,r=>r.HBP);
  const BB = Math.max(sum(rows,r=>r.BB) - HBP, 0);
  const OBP = PA? (H+BB+HBP)/PA : NaN;
  const SLG = AB? TB/AB : NaN;
  const BABIP = AB? H/AB : NaN;
  const abNoBunt = rows.filter(r=>r.AB===1 && !r.Bunt);
  const xBA = mean(abNoBunt, r=>r.HitProb);
  const xSLG = mean(abNoBunt, r=>r.Slug);
  const wOBA = mean(rows, r=>r.wOBA);
  const wOBAcon = mean(inPlayRows, r=>r.wOBA);
  const xwSum = sum(rows, r=>r.xwOBA);
  const xwOBA = PA? ((BB*0.69)+(HBP*0.69)+xwSum)/PA : NaN;
  const ISO = AB? (doubles + 2*triples + 3*hr)/AB : NaN;
  const wRAA = PA ? ((wOBA-0.378)/1.03)*PA : NaN;
  const wRCplus = PA ? ((((wRAA/PA)+0.177)+(0.177-(0.945*0.177)))/0.177)*100 : NaN;
  const OPSplus = 100*(((OBP/0.392)+(SLG/0.496)-1)/0.945);
  return {
    BIP, BABIP:fmt3(BABIP), xBA:fmt3(xBA), xSLG:fmt3(xSLG), wOBA:fmt3(wOBA),
    wOBAcon:fmt3(wOBAcon), xwOBA:fmt3(xwOBA), ISO:fmt3(ISO),
    "wRC+":fmt0(wRCplus), "OPS+":fmt0(OPSplus)
  };
}

function evStats(rows){
  const inPlay = rows.filter(r=>r.InPlay);
  const swings = rows.filter(r=>r.Swing);
  const zoneSwings = rows.filter(r=>r.Zone && r.Swing);
  const outZone = rows.filter(r=>!r.Zone);
  const AvgEV = mean(inPlay, r=>r.EV);
  const MaxEV = maxOf(inPlay, r=>r.EV);
  const MaxDist = maxOf(inPlay, r=>r.Dist);
  return {
    Pitches: rows.length,
    BIP: sum(rows,r=>r.InPlay),
    AvgEV: fmt1(AvgEV), MaxEV: fmt1(MaxEV),
    "Hit95+%": pct1(mean(inPlay,r=>r.HardHit)),
    "LA10-30%": pct1(mean(inPlay,r=>r.SweetSpot)),
    "Barrel%": pct1(mean(inPlay,r=>r.Barrel)),
    MaxDist: fmt1(MaxDist),
    "Contact%": pct1(swings.length ? sum(swings,r=>r.InPlay)/swings.length : NaN),
    "Z-Contact%": pct1(zoneSwings.length ? sum(zoneSwings,r=>r.InPlay)/zoneSwings.length : NaN),
    "Chase%": pct1(outZone.length ? sum(outZone,r=>r.Swing)/outZone.length : NaN)
  };
}

function groupBy(rows, keyFn){
  const map = new Map();
  rows.forEach(r=>{
    const k = keyFn(r);
    if (k===null || k===undefined) return;
    if (!map.has(k)) map.set(k,[]);
    map.get(k).push(r);
  });
  return map;
}

const PITCH_ORDER = ["Fastball","TwoSeam","Sinker","Cutter","Changeup","ChangeUp","Splitter","Slider","Curveball","Sweeper","Other"];
function sortPitchKeys(keys){
  return keys.slice().sort((a,b)=>{
    const ia = PITCH_ORDER.indexOf(a), ib = PITCH_ORDER.indexOf(b);
    return (ia<0?999:ia) - (ib<0?999:ib);
  });
}

/* ============================================================
   TABLE RENDERER  (mirrors R make_dt)
   ============================================================ */
function renderTable(container, rowObj, opts={}){
  // rowObj: single object -> one-row table, OR array of objects -> multi-row table
  const rows = Array.isArray(rowObj) ? rowObj : [rowObj];
  if (!rows.length){ container.innerHTML = '<div class="empty-msg">No data</div>'; return; }
  const cols = Object.keys(rows[0]);
  const rateCols = new Set(opts.rateCols||[]);
  const pctCols = new Set(opts.pctCols||[]);

  let html = '<div class="table-scroll"><table class="stat-table"><thead><tr>';
  cols.forEach(c=> html += `<th data-col="${c}">${c}</th>`);
  html += '</tr></thead><tbody>';
  rows.forEach(r=>{
    html += '<tr>';
    cols.forEach(c=>{
      const cls = rateCols.has(c) ? 'rate-cell' : (pctCols.has(c) ? 'pct-cell' : '');
      html += `<td class="${cls}">${r[c]===undefined||r[c]===null?'-':r[c]}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;

  // simple click-to-sort
  const table = container.querySelector('table');
  table.querySelectorAll('th').forEach((th,idx)=>{
    let asc = true;
    th.addEventListener('click', ()=>{
      const tbody = table.querySelector('tbody');
      const trs = [...tbody.querySelectorAll('tr')];
      trs.sort((a,b)=>{
        const av = a.children[idx].textContent, bv = b.children[idx].textContent;
        const an = parseFloat(av.replace('%','')), bn = parseFloat(bv.replace('%',''));
        let cmp;
        if (!Number.isNaN(an) && !Number.isNaN(bn)) cmp = an-bn;
        else cmp = av.localeCompare(bv);
        return asc ? cmp : -cmp;
      });
      asc = !asc;
      trs.forEach(tr=>tbody.appendChild(tr));
    });
  });
}

/* ============================================================
   ZONE GEOMETRY (feet) — shared by all strike-zone charts
   ============================================================ */
const SZ_BOX = { x:[-0.708,0.708,0.708,-0.708,-0.708], y:[1.755,1.755,3.378,3.378,1.755] };
const HOME_PLATE_ICON = { x:[-0.708,-0.667,0,0.667,0.708,-0.708], y:[0,0.167,0.333,0.167,0,0] };

function zoneShapes(dark=false){
  return [
    { type:'path', path:`M ${SZ_BOX.x.map((x,i)=>`${i===0?'':'L'}${x},${SZ_BOX.y[i]}`).join(' ')} Z`,
      line:{color: dark?'rgba(255,255,255,.5)':'#444', width:1.5}, fillcolor:'rgba(0,0,0,0)' },
    { type:'path', path:`M ${HOME_PLATE_ICON.x.map((x,i)=>`${i===0?'':'L'}${x},${HOME_PLATE_ICON.y[i]}`).join(' ')} Z`,
      line:{color: dark?'rgba(255,255,255,.3)':'#000', width:1}, fillcolor: dark?'rgba(255,255,255,.08)':'#ede1d2' }
  ];
}

/* Generic 2D strike-zone scatter, colored by a categorical field.
   Mirrors sz_ggplot(). */
function zoneScatter(div, rows, {colorField, colorMap, title, tooltipFn}){
  const cats = [...new Set(rows.map(r=>r[colorField]).filter(v=>v!==null && v!==undefined))].sort();
  const traces = cats.map(cat=>{
    const sub = rows.filter(r=>r[colorField]===cat);
    return {
      type:'scatter', mode:'markers', name: cat,
      x: sub.map(r=>r.PLS), y: sub.map(r=>r.PLH),
      text: sub.map(tooltipFn),
      hovertemplate: '%{text}<extra></extra>',
      marker:{ color: (colorMap&&colorMap[cat])||'#888', size:8, opacity:0.85 }
    };
  });
  const layout = {
    title:{text:title, font:{size:12}},
    xaxis:{title:'Horizontal Location', range:[-2,2], zeroline:false},
    yaxis:{title:'Vertical Location', range:[0,5], zeroline:false, scaleanchor:'x'},
    shapes: zoneShapes(),
    legend:{orientation:'h', y:-0.18, font:{size:9}},
    margin:{l:45,r:10,t:34,b:34}, height:300
  };
  Plotly.newPlot(div, traces, layout, {displayModeBar:false, responsive:true});
}

/* Density "heat map" for whiff/chase tabs — mirrors sz_density_plot()
   using Plotly's histogram2dcontour as a stand-in for ggplot's stat_density_2d. */
function zoneDensity(div, rows, title, height=300, dark=false){
  const x = rows.map(r=>r.PLS), y = rows.map(r=>r.PLH);
  const traces = [{
    type:'histogram2dcontour', x, y,
    colorscale: dark
      ? [[0,'#10141a'],[0.35,'#3a2f4a'],[0.6,'#c2410c'],[1,'#fbbf24']]
      : [[0,'#ffffff'],[1,'#8C2232']],
    showscale:false, contours:{coloring:'fill', showlines:false},
    ncontours: 12
  }];
  const layout = {
    title:{text:`${title}${dark?'':` (n=${rows.length})`}`, font:{size:height<250?9:11, color: dark?'#93a0b0':undefined}},
    xaxis:{title:'', range:[-2,2], zeroline:false, showticklabels:false},
    yaxis:{title:'', range:[0,4], zeroline:false, showticklabels:false, scaleanchor:'x'},
    shapes: zoneShapes(dark),
    margin:{l:6,r:6,t:dark?16:24,b:6}, height, showlegend:false,
    plot_bgcolor: dark?'#10141a':'#fff', paper_bgcolor: dark?'#10141a':'#fff'
  };
  Plotly.newPlot(div, traces, layout, {displayModeBar:false, responsive:true});
}

/* Simplified 2D "spray" widget: dots for batted-ball outcomes (Bearing/Distance)
   inside a minimal diamond guide, dark-card style. A compact stand-in for the
   full 3D spray chart — good enough to show shape/spread at this tiny size. */
function renderMiniSpray(div, rows, title, height=120){
  const inPlay = rows.filter(r=>r.InPlay && r.Bearing!=null && r.Dist!=null && r.Dist>0);
  const pts = inPlay.map(r=>{
    const rad = r.Bearing*Math.PI/180;
    return { x:Math.sin(rad)*r.Dist, y:Math.cos(rad)*r.Dist, damage: r.H===1||r.HardHit===1 };
  });
  const maxD = 340;
  const diamond = { x:[0,-maxD*0.72,0,maxD*0.72,0], y:[0,maxD*0.72,maxD*1.02,maxD*0.72,0] };
  Plotly.newPlot(div, [
    { type:'scatter', mode:'lines', x:diamond.x, y:diamond.y, line:{color:'#3a4150', width:1}, showlegend:false, hoverinfo:'skip' },
    { type:'scatter', mode:'markers', x:pts.map(p=>p.x), y:pts.map(p=>p.y),
      marker:{ size: height<80?2.5:4, color: pts.map(p=>p.damage?'#fb923c':'#5b6472'), opacity:0.85, line:{width:0} },
      showlegend:false, hoverinfo:'skip' }
  ], {
    title:{text:title, font:{size:9,color:'#93a0b0'}},
    xaxis:{visible:false, range:[-maxD,maxD]}, yaxis:{visible:false, range:[-20,maxD*1.05], scaleanchor:'x'},
    margin:{l:1,r:1,t: title?16:2,b:1}, height, plot_bgcolor:'#10141a', paper_bgcolor:'#10141a', showlegend:false
  }, {displayModeBar:false, responsive:true});
}

// Starters typically throw far more pitches per outing than relievers.
// No explicit role field exists in TrackMan exports, so this threshold is
// a practical stand-in — flag any that look misclassified.
function classifyRole(rows){
  const games = new Set(rows.map(r=>r.Game)).size || 1;
  return (rows.length / games) >= 40 ? 'Starter' : 'Bullpen';
}

function pitchMixBarHTML(rows){
  const total = rows.length || 1;
  const byPitch = groupBy(rows, r=>r.Pitch);
  const segs = sortPitchKeys([...byPitch.keys()]).map(p=>({
    p, pct: byPitch.get(p).length/total, color: PITCH_COLORS[p]||'#888'
  })).filter(s=>s.pct>0.02);
  const bars = segs.map(s=>`<div style="flex:${s.pct};background:${s.color};" title="${s.p} ${pct1(s.pct)}"></div>`).join('');
  const legend = segs.map(s=>`<span style="color:${s.color};">${PITCH_ABBR[s.p]||s.p} ${pct1(s.pct)}</span>`).join(' &nbsp; ');
  return `<div class="cheat-mixbar">${bars}</div><div class="cheat-mixlegend">${legend}</div>`;
}

function rateBadgesHTML(rows){
  const stats = pitchingByPitchStats(rows);
  return `<span class="cheat-badge cheat-badge-slg">SLG ${stats.SLG}</span>
          <span class="cheat-badge cheat-badge-baa">BAA ${stats.BAA}</span>`;
}

function plateTendencyLabel(rows){
  const zoned = rows.filter(r=>r.PLS!=null);
  if (!zoned.length) return 'Plate: —';
  const avg = mean(zoned, r=>r.PLS);
  const side = avg < -0.28 ? 'Left' : avg > 0.28 ? 'Right' : 'Middle';
  return `Plate: ${side}`;
}

function hitDirectionLabel(rows){
  const inPlay = rows.filter(r=>r.InPlay && r.Bearing!=null && r.BatterSide);
  if (!inPlay.length) return 'Hit: —';
  const counts = {Pull:0, Middle:0, Oppo:0};
  inPlay.forEach(r=>{
    const pulled = r.BatterSide==='Right' ? r.Bearing < -12 : r.Bearing > 12;
    const oppo   = r.BatterSide==='Right' ? r.Bearing > 12  : r.Bearing < -12;
    counts[pulled ? 'Pull' : oppo ? 'Oppo' : 'Middle']++;
  });
  const best = Object.keys(counts).reduce((a,b)=> counts[b]>counts[a]?b:a, 'Middle');
  return `Hit: ${best}`;
}

/* ============================================================
   SPRAY CHART (3D, physics-based arcs) — port of R make_arc()
   ============================================================ */
const spraySt = { colorBy:'ev', hideDots:false, camera:'catcher' };

const SPRAY_CAMERAS = {
  catcher:  { eye:{x:0,   y:-2.0, z:0.6}, center:{x:0,y:0.3,z:-0.1}, up:{x:0,y:0,z:1} },
  pitcher:  { eye:{x:0,   y:1.8,  z:0.5}, center:{x:0,y:0.3,z:-0.1}, up:{x:0,y:0,z:1} },
  side:     { eye:{x:-2.2,y:0,    z:0.4}, center:{x:0,y:0.3,z:-0.1}, up:{x:0,y:0,z:1} },
  overhead: { eye:{x:0,   y:-0.01,z:2.6}, center:{x:0,y:0.3,z:-0.1}, up:{x:0,y:1,z:0} },
};

// Simplified incoming-pitch trajectory (mound release -> plate crossing),
// drawn on click alongside the existing batted-ball arc / detail card.
// Uses the pitcher's actual release height/side/extension where available;
// the slight extra "sag" term is a stylistic approximation of gravity break,
// not a physics-accurate recreation of the pitch's real movement profile.
function makePitchArc(row, n=25){
  const x0 = row.RelSide  != null ? row.RelSide  : 0;
  const y0 = 60.5 - (row.Extension != null ? row.Extension : 5.5);
  const z0 = row.RelHeight!= null ? row.RelHeight: 6;
  const x1 = row.PLS != null ? row.PLS : 0;
  const y1 = 0;
  const z1 = row.PLH != null ? row.PLH : 2.5;
  const x=[], y=[], z=[];
  for (let i=0;i<n;i++){
    const t = i/(n-1);
    x.push(x0 + (x1-x0)*t);
    y.push(y0 + (y1-y0)*t);
    const straightZ = z0 + (z1-z0)*t;
    z.push(straightZ - 4*t*(1-t)*1.5);
  }
  return {x,y,z};
}

function makeArc(bearingDeg, distFt, laDeg, evMph, n=40){
  const bear = bearingDeg*Math.PI/180, la = laDeg*Math.PI/180;
  const evFps = evMph*1.46667, g = 32.174;
  const tTotal = Math.max(2*evFps*Math.sin(la)/g, 0.01);
  const x=[], y=[], z=[];
  const gndSpd = evFps*Math.cos(la);
  let gndArr = [];
  for (let i=0;i<n;i++){
    const t = tTotal*i/(n-1);
    gndArr.push(gndSpd*t);
  }
  const maxGnd = Math.max(...gndArr) || 1;
  const scale = distFt/maxGnd;
  for (let i=0;i<n;i++){
    const t = tTotal*i/(n-1);
    const gnd = gndArr[i]*scale;
    let h = evFps*Math.sin(la)*t - 0.5*g*t*t;
    if (h<0) h=0;
    x.push(gnd*Math.sin(bear));
    y.push(gnd*Math.cos(bear));
    z.push(h);
  }
  return {x,y,z};
}

function fieldGeometryTraces(){
  const foulDist = 340;
  const thetaSeq = []; for(let i=0;i<120;i++) thetaSeq.push(-Math.PI/4 + (Math.PI/2)*i/119);
  const wallR = th => 330 + 40*Math.cos(2*th);
  const wallX = thetaSeq.map(th=>-wallR(th)*Math.sin(th));
  const wallY = thetaSeq.map(th=> wallR(th)*Math.cos(th));

  const diamX = [0, -90*Math.sin(Math.PI/4), 0, 90*Math.sin(Math.PI/4), 0];
  const diamY = [0, 90*Math.cos(Math.PI/4), 90*Math.sqrt(2), 90*Math.cos(Math.PI/4), 0];

  const dirtTh = []; for(let i=0;i<80;i++) dirtTh.push(2*Math.PI*i/79);
  const cy2b = 90*Math.sqrt(2);
  const dirtX = dirtTh.map(t=>95*Math.sin(t));
  const dirtY = dirtTh.map(t=>cy2b+95*Math.cos(t));
  const moundX = dirtTh.map(t=>8*Math.sin(t));
  const moundY = dirtTh.map(t=>60.5+8*Math.cos(t));

  const flX = [-foulDist*Math.sin(Math.PI/4), 0, foulDist*Math.sin(Math.PI/4)];
  const flY = [ foulDist*Math.cos(Math.PI/4), 0, foulDist*Math.cos(Math.PI/4)];

  const line3d = (x,y,color,width,dash)=>({
    type:'scatter3d', mode:'lines', x, y, z:x.map(()=>0),
    line:{color,width, ...(dash?{dash}:{})}, showlegend:false, hoverinfo:'skip'
  });

  return [
    line3d(flX, flY, '#4a5a4a', 1.2, 'dot'),
    line3d(wallX, wallY, '#5a6a5a', 2.0),
    line3d(diamX, diamY, '#aaaaaa', 2.0),
    line3d(dirtX, dirtY, '#8a6a3a', 1.0, 'dot'),
    line3d(moundX, moundY, '#8a6a3a', 1.0)
  ];
}

function spraySelectedRow(idx, validRows){
  return (idx>=0 && idx<validRows.length) ? validRows[idx] : null;
}

function renderSprayChart(div, rows){
  const valid = rows.filter(r=>
    r.Dist!=null && r.Bearing!=null && r.InPlay &&
    !['Undefined','Sacrifice','FieldersChoice'].includes(r.PlayResult) &&
    r.LA!=null && r.EV!=null && r.EV>0 && r.Dist>0
  ).map(r=>{
    const bearRad = r.Bearing*Math.PI/180;
    return { ...r, sx:Math.sin(bearRad)*r.Dist, sy:Math.cos(bearRad)*r.Dist };
  });

  const tip = r => `<b>${r.PlayResult}</b><br>EV: ${fmt1(r.EV)} mph  LA: ${fmt1(r.LA)}°<br>` +
    `Dist: ${fmt0(r.Dist)} ft<br>Pitch: ${r.Pitch} ${fmt1(r.RelSpeed)} mph<br>` +
    `Count: ${r.Balls}-${r.Strikes}  Date: ${r.Date}`;

  let traces = fieldGeometryTraces();
  const bipTotal = rows.filter(r=>r.InPlay).length;

  if (!spraySt.hideDots){
    if (spraySt.colorBy === 'ev'){
      valid.forEach(r=>{
        const evNorm = Math.max(0, Math.min(1,(r.EV-60)/(110-60)));
        const arcCol = evNorm<0.25?'#0288d1':evNorm<0.5?'#00e676':evNorm<0.75?'#ffeb3b':'#e53935';
        const arc = makeArc(r.Bearing, r.Dist, r.LA, r.EV);
        traces.push({type:'scatter3d', mode:'lines', x:arc.x,y:arc.y,z:arc.z,
          line:{color:arcCol,width:1.5}, opacity:0.55, showlegend:false, hoverinfo:'skip'});
      });
      traces.push({
        type:'scatter3d', mode:'markers',
        x:valid.map(r=>r.sx), y:valid.map(r=>r.sy), z:valid.map(()=>0),
        text: valid.map(tip), hovertemplate:'%{text}<extra></extra>',
        marker:{ size:6, opacity:0.9, color:valid.map(r=>r.EV),
          colorscale:[[0,'#1a237e'],[0.25,'#0288d1'],[0.5,'#00e676'],[0.75,'#ffeb3b'],[1,'#b71c1c']],
          cmin:60, cmax:110,
          colorbar:{title:{text:'Exit Velo (mph)', font:{color:'#ccc',size:10}}, tickfont:{color:'#ccc',size:9},
            bgcolor:'rgba(0,0,0,0)', thickness:12, len:0.45, x:1.01},
          line:{width:0} },
        showlegend:false, customdata: valid.map((r,i)=>i)
      });
    } else {
      const field = spraySt.colorBy==='pitch' ? 'Pitch' : 'PlayResult';
      const pal = spraySt.colorBy==='pitch' ? PITCH_COLORS : RESULT_COLORS;
      const cats = [...new Set(valid.map(r=>r[field]))].sort();
      cats.forEach(cat=>{
        const sub = valid.filter(r=>r[field]===cat);
        const col = pal[cat] || '#aaaaaa';
        sub.forEach(r=>{
          const arc = makeArc(r.Bearing, r.Dist, r.LA, r.EV);
          traces.push({type:'scatter3d', mode:'lines', x:arc.x,y:arc.y,z:arc.z,
            line:{color:col,width:1.5}, opacity:0.45, showlegend:false, hoverinfo:'skip'});
        });
        traces.push({
          type:'scatter3d', mode:'markers', name:cat,
          x:sub.map(r=>r.sx), y:sub.map(r=>r.sy), z:sub.map(()=>0),
          text: sub.map(tip), hovertemplate:'%{text}<extra></extra>',
          marker:{size:6, color:col, opacity:0.9, line:{width:0}}, showlegend:true
        });
      });
    }
  }

  const layout = {
    paper_bgcolor:'#0d1117',
    scene:{
      bgcolor:'#0d1117',
      camera: SPRAY_CAMERAS[spraySt.camera] || SPRAY_CAMERAS.catcher,
      xaxis:{title:'', showgrid:false, zeroline:false, showticklabels:false, showbackground:false},
      yaxis:{title:'', showgrid:false, zeroline:false, showticklabels:false, showbackground:false},
      zaxis:{title:'Height (ft)', color:'#8a96a8', showgrid:true, gridcolor:'#1a2230',
        zeroline:false, showbackground:false, tickfont:{size:9,color:'#8a96a8'}, range:[0,120]},
      aspectmode:'manual', aspectratio:{x:1.4,y:1.6,z:0.45}
    },
    margin:{l:0,r:60,t:10,b:0}, font:{color:'#ccc'},
    legend:{font:{color:'#ccc',size:11}, bgcolor:'rgba(13,17,23,0.85)', bordercolor:'#2a3a4a', borderwidth:1, x:0.01,y:0.99},
    annotations:[{ text:`showing <b>${valid.length}</b> of <b>${bipTotal}</b> BIP`,
      x:1,y:1,xref:'paper',yref:'paper',xanchor:'right',yanchor:'top',showarrow:false,
      font:{color:'#7a9ab0',size:11} }],
    height:600
  };

  Plotly.newPlot(div, traces, layout, {displayModeBar:true, displaylogo:false,
    modeBarButtonsToRemove:['toImage','sendDataToCloud','autoScale2d','resetScale2d']});

  const card = document.getElementById('spray_stat_card');
  let pitchArcAdded = false;
  div.on('plotly_click', (ev)=>{
    const pt = ev.points[0];
    if (pt.data.customdata===undefined && !pt.data.name) return;
    let row;
    if (pt.data.customdata){ row = valid[pt.data.customdata[pt.pointIndex]]; }
    else { // categorical trace: find by matching sx/sy
      row = valid.find(r=>Math.abs(r.sx-pt.x)<0.01 && Math.abs(r.sy-pt.y)<0.01);
    }
    if (!row) return;
    const col = RESULT_COLORS[row.PlayResult] || '#aaa';
    card.innerHTML = `<div class="card-result" style="color:${col}">${(row.PlayResult||'').toUpperCase()}</div>
      <div class="card-row"><span class="card-label">Exit Velo</span><span class="card-value">${fmt1(row.EV)} mph</span></div>
      <div class="card-row"><span class="card-label">Launch</span><span class="card-value">${fmt1(row.LA)}°</span></div>
      <div class="card-row"><span class="card-label">Distance</span><span class="card-value">${fmt0(row.Dist)} ft</span></div>
      <div class="card-row"><span class="card-label">Pitch</span><span class="card-value">${fmt1(row.RelSpeed)} mph</span></div>
      <div class="card-row"><span class="card-label">Movement</span><span class="card-value">${fmt1(row.IVB)}" IVB / ${fmt1(row.HB)}" HB</span></div>
      <div class="card-row"><span class="card-label">Count</span><span class="card-value">${row.Balls}-${row.Strikes}</span></div>
      <div class="card-row"><span class="card-label">Date</span><span class="card-value">${row.Date}</span></div>`;
    card.style.display='block';

    // Add the incoming-pitch trajectory without a full redraw, so the
    // user's current camera orbit position is preserved.
    if (pitchArcAdded) window.Plotly.deleteTraces(div, [traces.length]);
    const arc = makePitchArc(row);
    window.Plotly.addTraces(div, {
      type:'scatter3d', mode:'lines', x:arc.x, y:arc.y, z:arc.z,
      line:{color:'#ff3b30', width:5}, showlegend:false, hoverinfo:'skip'
    });
    pitchArcAdded = true;
  });
  div.on('plotly_doubleclick', ()=>{
    card.style.display='none';
    if (pitchArcAdded){ window.Plotly.deleteTraces(div, [traces.length]); pitchArcAdded=false; }
  });
}

/* ============================================================
   3D CONTACT VIEWER (Hawk-Eye style) — port of R contact_plot_3d
   ============================================================ */
const contactSt = { camera:'catcher', metric:'ev' };

function renderContactPlot(div, rows){
  const tbl = rows.filter(r=>r.InPlay && r.CPX!=null && r.CPY!=null && r.CPZ!=null);
  if (!tbl.length){
    Plotly.newPlot(div, [], {paper_bgcolor:'#0d1117',
      annotations:[{text:'No contact data available', x:0.5,y:0.5,xref:'paper',yref:'paper',
        showarrow:false, font:{color:'#8a96a8', size:16}}], height:560}, {displayModeBar:false});
    return;
  }
  const met = contactSt.metric;
  let colorVal, clabel, cmin, cmax, colorscale;
  if (met==='ev'){
    colorVal = tbl.map(r=>r.EV); clabel='Exit Velo (mph)'; cmin=60; cmax=110;
    colorscale=[[0,'#1a237e'],[0.25,'#0288d1'],[0.5,'#00e676'],[0.75,'#ffeb3b'],[1,'#b71c1c']];
  } else if (met==='la'){
    colorVal = tbl.map(r=>r.LA); clabel='Launch Angle (°)'; cmin=-20; cmax=50;
    colorscale=[[0,'#b71c1c'],[0.25,'#ffeb3b'],[0.5,'#00e676'],[0.75,'#0288d1'],[1,'#1a237e']];
  } else {
    colorVal = tbl.map(r=>r.Barrel); clabel='Barrel'; cmin=0; cmax=1;
    colorscale=[[0,'#1e2530'],[1,'#b71c1c']];
  }

  const pw = 8.5/12;
  const plateH = [-pw,-pw*0.94,0,pw*0.94,pw,-pw];
  const plateD = [0,2,4,2,0,0];
  const plateZ = [0,0,0,0,0,0];
  const szHw=0.708, szLo=1.5, szHi=3.4;
  const szH=[-szHw,szHw,szHw,-szHw,-szHw], szZ=[szLo,szLo,szHi,szHi,szLo], szD=[0,0,0,0,0];
  const refDepths=[0,12,24,36], refLabels=['plate front','1 ft out front','2 ft out front','3 ft out front'];
  const hSpan=[-1.5,1.5];
  const refFloor = Math.min(...tbl.map(r=>r.CPX)) - 0.3;

  const axisStyle = title => ({title, color:'#8a96a8', gridcolor:'#1e2530', zerolinecolor:'#2e3a4a',
    showbackground:true, backgroundcolor:'#111820', tickfont:{color:'#8a96a8', size:9}});

  let map, camera, xax, yax, zax, ar;
  const cam = contactSt.camera;
  if (cam==='catcher'){
    map=(h,d,z)=>({x:h,y:d,z}); camera={eye:{x:0,y:-3.0,z:0.4},center:{x:0,y:0,z:0},up:{x:0,y:0,z:1}};
    xax=axisStyle('Horizontal (ft)'); yax={...axisStyle('Depth from Plate (in)'), autorange:'reversed'};
    zax=axisStyle('Height (ft)'); ar={x:1.2,y:1.6,z:1.0};
  } else if (cam==='pitcher'){
    map=(h,d,z)=>({x:-h,y:d,z}); camera={eye:{x:0,y:3.0,z:0.4},center:{x:0,y:0,z:0},up:{x:0,y:0,z:1}};
    xax=axisStyle('Horizontal (ft)'); yax=axisStyle('Depth from Plate (in)');
    zax=axisStyle('Height (ft)'); ar={x:1.2,y:1.6,z:1.0};
  } else if (cam==='side'){
    map=(h,d,z)=>({x:d,y:h,z}); camera={eye:{x:-3.0,y:0,z:0.3},center:{x:0,y:0,z:0},up:{x:0,y:0,z:1}};
    xax=axisStyle('Depth from Plate (in)'); yax=axisStyle('Horizontal (ft)');
    zax=axisStyle('Height (ft)'); ar={x:1.6,y:1.2,z:1.0};
  } else {
    map=(h,d,z)=>({x:h,y:d,z}); camera={eye:{x:0,y:-0.01,z:3.0},center:{x:0,y:0,z:0},up:{x:0,y:1,z:0}};
    xax=axisStyle('Horizontal (ft)'); yax={...axisStyle('Depth from Plate (in)'), autorange:'reversed'};
    zax=axisStyle('Height (ft)'); ar={x:1.2,y:1.6,z:0.5};
  }

  const mapArr = (hs,ds,zs)=>({ x:hs.map((h,i)=>map(h,ds[i],zs[i]).x),
    y:hs.map((h,i)=>map(h,ds[i],zs[i]).y), z:hs.map((h,i)=>map(h,ds[i],zs[i]).z) });

  // CPX behaves like a height distribution, CPZ is symmetric around 0 (a
  // horizontal offset), and CPY is a strictly-positive depth measurement in
  // feet (needs *12 to match the reference lines, which are in inches).
  const pts = mapArr(tbl.map(r=>r.CPZ), tbl.map(r=>r.CPY*12), tbl.map(r=>r.CPX));
  const pl = mapArr(plateH, plateD, plateZ);
  const szM = mapArr(szH, szD, szZ);

  const refTraces = refDepths.map((d,i)=>{
    const rl = mapArr(hSpan, [d,d], [refFloor,refFloor]);
    return { type:'scatter3d', mode:'lines+text', x:rl.x, y:rl.y, z:rl.z,
      line:{color:'rgba(80,160,255,0.30)', width:1, dash:'dash'},
      text:['', refLabels[i]], textposition:'middle right', textfont:{color:'#607080', size:8},
      showlegend:false, hoverinfo:'skip' };
  });

  const tip = tbl.map(r=>`EV: ${fmt1(r.EV)} mph<br>LA: ${fmt1(r.LA)}°<br>Dist: ${fmt0(r.Dist)} ft<br>Result: ${r.PlayResult}<br>Pitch: ${r.Pitch}`);

  const traces = [
    ...refTraces,
    { type:'scatter3d', mode:'lines', x:pl.x, y:pl.y, z:pl.z, line:{color:'#fff',width:4}, showlegend:false, hoverinfo:'skip' },
    { type:'scatter3d', mode:'lines', x:szM.x, y:szM.y, z:szM.z, line:{color:'rgba(220,220,220,0.7)',width:2}, showlegend:false, hoverinfo:'skip' },
    { type:'scatter3d', mode:'markers', x:pts.x, y:pts.y, z:pts.z, text:tip, hovertemplate:'%{text}<extra></extra>',
      marker:{ size:5, color:colorVal, colorscale, cmin, cmax, opacity:0.88,
        colorbar:{title:{text:clabel, font:{color:'#b0b8c8', size:10}}, tickfont:{color:'#b0b8c8', size:9},
          bgcolor:'rgba(0,0,0,0)', thickness:12, len:0.5, x:1.01}, line:{width:0} }, showlegend:false }
  ];

  Plotly.newPlot(div, traces, {
    paper_bgcolor:'#111820',
    scene:{ bgcolor:'#111820', camera, xaxis:xax, yaxis:yax, zaxis:zax, aspectmode:'manual', aspectratio:ar },
    margin:{l:0,r:60,t:10,b:0}, font:{color:'#b0b8c8'}, height:560
  }, {displayModeBar:false});
}

/* ============================================================
   PITCHING STATS HELPERS (mirror app.R server logic)
   ============================================================ */
function pitchingSummary(rows, games){
  const PC = rows.length;
  const IPraw = (sum(rows,r=>r.OutsOnPlay) + sum(rows,r=>r.SO)) / 3;
  const thirds = IPraw % 1;
  const IP = Math.abs(thirds - 1/3) < 0.02 ? Math.floor(IPraw)+0.1
           : Math.abs(thirds - 2/3) < 0.02 ? Math.floor(IPraw)+0.2 : IPraw;
  const BF = sum(rows,r=>r.PA), H = sum(rows,r=>r.H);
  const singles=sum(rows,r=>r.Single), doubles=sum(rows,r=>r.Double), triples=sum(rows,r=>r.Triple), hr=sum(rows,r=>r.HR);
  const TB = singles + doubles*2 + triples*3 + hr*4;
  const SO = sum(rows,r=>r.SO), HBP = sum(rows,r=>r.HBP);
  const BB = Math.max(sum(rows,r=>r.BB) - HBP, 0);
  const AB = sum(rows,r=>r.AB);
  const R = Math.round(sum(rows,r=>r.RunsScored));
  const WHIP = IP ? (BB+H)/IP : NaN;
  const FIP = IP ? (((hr*13)+(3*(BB+HBP))-(2*SO))/IP + 3.76) : NaN;
  const BAA = AB ? H/AB : NaN;
  const SLG = AB ? TB/AB : NaN;
  const out = {};
  if (games!==undefined) out.G = games;
  Object.assign(out, {
    IP: fmt1(IP), P:PC, BF, H, R, BB, HBP, SO, HR:hr,
    "K%": pct1(BF? SO/BF : NaN), "BB%": pct1(BF? BB/BF : NaN),
    BAA:fmt3(BAA), SLG:fmt3(SLG), WHIP:fmt2(WHIP), FIP:fmt2(FIP)
  });
  return out;
}

function pitchingByPitchStats(rows){
  const inPlay = rows.filter(r=>r.InPlay);
  const swings = rows.filter(r=>r.Swing);
  const zoneRows = rows.filter(r=>r.Zone);
  const outZone = rows.filter(r=>!r.Zone);
  const singles=sum(rows,r=>r.Single), doubles=sum(rows,r=>r.Double), triples=sum(rows,r=>r.Triple), hr=sum(rows,r=>r.HR);
  const TB = singles + doubles*2 + triples*3 + hr*4;
  const AB = sum(rows,r=>r.AB), H = sum(rows,r=>r.H);
  return {
    Pitches: rows.length,
    "IZ %": pct1(mean(rows,r=>r.Zone)),
    "Swing%": pct1(mean(rows,r=>r.Swing)),
    "Z-Take%": pct1(zoneRows.length ? mean(zoneRows,r=>r.Take) : NaN),
    "Whiff%": pct1(swings.length ? mean(swings,r=>r.Whiff) : NaN),
    "Chase%": pct1(outZone.length ? mean(outZone,r=>r.Swing) : NaN),
    "Contact%": pct1(mean(rows,r=>r.Contact)),
    "Barrel%": pct1(inPlay.length ? mean(inPlay,r=>r.Barrel) : NaN),
    AvgEV: fmt1(mean(inPlay,r=>r.EV)),
    BAA: fmt3(AB? H/AB : NaN), SLG: fmt3(AB? TB/AB : NaN),
    "GB%": pct1(inPlay.length ? mean(inPlay,r=>r.GB) : NaN),
    "FB%": pct1(inPlay.length ? mean(inPlay,r=>r.FB_hit) : NaN),
    "LD%": pct1(inPlay.length ? mean(inPlay,r=>r.LD) : NaN),
  };
}

function pitchingMetricsRow(rows){
  return {
    Pitches: rows.length,
    AvgVelo: fmt1(mean(rows,r=>r.RelSpeed)), MaxVelo: fmt1(maxOf(rows,r=>r.RelSpeed)),
    IVB: fmt1(mean(rows,r=>r.IVB)), HB: fmt1(mean(rows,r=>r.HB)),
    SpinRate: fmt0(mean(rows,r=>r.SpinRate)), SpinAxis: fmt0(mean(rows,r=>r.SpinAxis)),
    RelHeight: fmt1(mean(rows,r=>r.RelHeight)), RelSide: fmt1(mean(rows,r=>Math.abs(r.RelSide))),
    Extension: fmt1(mean(rows,r=>r.Extension)), VAA: fmt1(mean(rows,r=>r.VAA)),
  };
}

const fmt2 = v => (v===null||v===undefined||Number.isNaN(v)) ? "-" : v.toFixed(2);

/* Generic (non strike-zone) XY scatter with a crosshair through the origin —
   used for Movement / Release / Extension charts. */
function xyScatter(div, rows, {xField, yField, xRange, yRange, colorField, colorMap, title, xLabel, yLabel, tooltipFn, height=360}){
  const cats = [...new Set(rows.map(r=>r[colorField]).filter(v=>v!=null))].sort();
  const traces = cats.map(cat=>{
    const sub = rows.filter(r=>r[colorField]===cat);
    return {
      type:'scatter', mode:'markers', name:cat,
      x: sub.map(r=>r[xField]), y: sub.map(r=>r[yField]),
      text: sub.map(tooltipFn), hovertemplate:'%{text}<extra></extra>',
      marker:{ color:(colorMap&&colorMap[cat])||'#888', size:height<300?5:8, opacity:0.85 }
    };
  });
  const layout = {
    title:{text:title, font:{size:12}},
    xaxis:{title:xLabel, range:xRange, zeroline:true, zerolinecolor:'#999', zerolinewidth:1.5},
    yaxis:{title:yLabel, range:yRange, zeroline:true, zerolinecolor:'#999', zerolinewidth:1.5},
    legend:{orientation:'h', y:-0.2, font:{size:9}},
    margin:{l:44,r:8,t:30,b:36}, height
  };
  Plotly.newPlot(div, traces, layout, {displayModeBar:false, responsive:true});
}

/* Simple rolling-average trend line, standing in for R's loess smoother. */
function rollingTrend(xs, ys, window=15){
  const out = [];
  for (let i=0;i<xs.length;i++){
    const lo = Math.max(0,i-window), hi = Math.min(xs.length-1,i+window);
    let s=0,n=0;
    for (let j=lo;j<=hi;j++){ if (ys[j]!=null && !Number.isNaN(ys[j])){ s+=ys[j]; n++; } }
    out.push(n? s/n : null);
  }
  return out;
}


const TABS_HITTING = [
  {id:'traditional', label:'Traditional Stats'},
  {id:'advanced', label:'Advanced Stats'},
  {id:'evstats', label:'Exit Velo Stats'},
  {id:'evcharts', label:'Exit Velo Charts'},
  {id:'izwhiff', label:'IZ Whiff'},
  {id:'chase', label:'Chase'},
  {id:'swingdec', label:'Swing Decisions'},
  {id:'takes', label:'Takes'},
  {id:'sequences', label:'Sequences'}
];
const TABS_PITCHING = [
  {id:'results', label:'Results'},
  {id:'resultsplit', label:'Results By Split'},
  {id:'metrics', label:'Metrics'},
  {id:'releaseext', label:'Release/Extension'},
  {id:'strikecount', label:'Strike% By Count'},
  {id:'locations', label:'Locations'},
  {id:'heatmaps', label:'Heat Maps'},
  {id:'izwhiffp', label:'IZ Whiff'},
  {id:'chasep', label:'Chase'},
  {id:'velotime', label:'Velo Over Time'},
  {id:'striketime', label:'Strike% Over Time'}
];
const TABS_SCOUT = [
  {id:'scoutreport', label:'Scouting Report'},
  {id:'cheatsheet', label:'Cheat Sheet'}
];
const TABS_LAB = [
  {id:'space', label:'Space'},
  {id:'heat', label:'Heat'},
  {id:'spray', label:'Spray'},
  {id:'trend', label:'Trend'},
  {id:'batted', label:'Batted Ball'}
];
function currentTabs(){
  if (state.mode === 'pitching') return TABS_PITCHING;
  if (state.mode === 'scout') return TABS_SCOUT;
  if (state.mode === 'lab') return TABS_LAB;
  return TABS_HITTING;
}
let activeTab = null;

function buildTabPanelsSkeleton(){
  const tabs = currentTabs();
  if (!activeTab || !tabs.some(t=>t.id===activeTab)) activeTab = tabs[0].id;
  const nav = document.getElementById('tabsNav');
  nav.innerHTML = tabs.map(t=>`<button class="tab-btn${t.id===activeTab?' active':''}" data-tab="${t.id}">${t.label}</button>`).join('');
  nav.querySelectorAll('.tab-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{ activeTab = btn.dataset.tab; syncSidebarForTab(); renderAll(); });
  });

  const content = document.getElementById('tabsContent');
  content.innerHTML = tabs.map(t=>`<div class="tab-panel" id="panel-${t.id}"></div>`).join('');
}

function showActivePanel(){
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active', b.dataset.tab===activeTab));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active', p.id===`panel-${activeTab}`));
}

/* ── Tab 1: Traditional Stats ── */
function renderTraditional(rows){
  const panel = document.getElementById('panel-traditional');
  panel.innerHTML = `
    <div class="section-label">Overall</div>
    <div id="trad-overall"></div>
    <div class="section-label">By Pitcher Hand</div>
    <div id="trad-split"></div>`;
  renderTable(document.getElementById('trad-overall'), traditionalStats(rows), {rateCols:['AVG','OBP','SLG','OPS']});
  const bySide = groupBy(rows, r=>r.PitcherThrows);
  const splitRows = [...bySide.keys()].sort().map(side=>({Side:side, ...traditionalStats(bySide.get(side))}));
  renderTable(document.getElementById('trad-split'), splitRows, {rateCols:['AVG','OBP','SLG','OPS']});
}

/* ── Tab 2: Spray Chart ── */
function renderLabSpace(rows){
  const panel = document.getElementById('panel-space');
  panel.innerHTML = `
    <div class="contact-btn-row" style="margin-bottom:6px;">
      <button class="contact-btn" data-spraycam="catcher">Catcher</button>
      <button class="contact-btn" data-spraycam="pitcher">Pitcher</button>
      <button class="contact-btn" data-spraycam="side">Side</button>
      <button class="contact-btn" data-spraycam="overhead">Overhead</button>
    </div>
    <div id="spray-toolbar">
      <button class="spray-btn" data-col="ev">EV</button>
      <button class="spray-btn" data-col="pitch">Pitch</button>
      <button class="spray-btn" data-col="result">Result</button>
      <div class="spray-btn-divider"></div>
      <button class="spray-btn" id="spray_hide_dots">Hide Dots</button>
      <div class="spray-btn-divider"></div>
      <div id="spray_ev_bar"><span>EV</span><span>65</span><div id="spray_ev_gradient"></div><span>106 mph</span></div>
    </div>
    <div style="position:relative;">
      <div id="spray_stat_card"><div class="card-result"></div></div>
      <div id="spray_chart_full" style="height:620px;"></div>
    </div>`;

  panel.querySelectorAll('[data-spraycam]').forEach(b=>{
    b.addEventListener('click', ()=>{
      spraySt.camera = b.dataset.spraycam;
      panel.querySelectorAll('[data-spraycam]').forEach(x=>x.classList.toggle('active', x.dataset.spraycam===spraySt.camera));
      renderSprayChart(document.getElementById('spray_chart_full'), fdata());
    });
  });
  panel.querySelectorAll('[data-spraycam]').forEach(b=>b.classList.toggle('active', b.dataset.spraycam===spraySt.camera));

  function syncButtons(){
    panel.querySelectorAll('.spray-btn[data-col]').forEach(b=>b.classList.toggle('active', b.dataset.col===spraySt.colorBy));
    const hideBtn = document.getElementById('spray_hide_dots');
    hideBtn.classList.toggle('active', spraySt.hideDots);
    hideBtn.textContent = spraySt.hideDots ? 'Show Dots' : 'Hide Dots';
    document.getElementById('spray_ev_bar').style.display = spraySt.colorBy==='ev' ? 'flex' : 'none';
  }
  panel.querySelectorAll('.spray-btn[data-col]').forEach(b=>{
    b.addEventListener('click', ()=>{ spraySt.colorBy=b.dataset.col; syncButtons(); renderSprayChart(document.getElementById('spray_chart_full'), fdata()); });
  });
  document.getElementById('spray_hide_dots').addEventListener('click', ()=>{
    spraySt.hideDots = !spraySt.hideDots; syncButtons(); renderSprayChart(document.getElementById('spray_chart_full'), fdata());
  });
  syncButtons();
  renderSprayChart(document.getElementById('spray_chart_full'), rows);
}

/* ── Tab 3: Advanced Stats ── */
function renderAdvanced(rows){
  const panel = document.getElementById('panel-advanced');
  panel.innerHTML = `
    <div class="section-label">Overall</div><div id="adv-overall"></div>
    <div class="section-label">By Pitcher Hand</div><div id="adv-side"></div>
    <div class="section-label">By Pitch Type</div><div id="adv-pitch"></div>`;
  const rateCols = ['BABIP','xBA','xSLG','wOBA','wOBAcon','xwOBA','ISO'];
  renderTable(document.getElementById('adv-overall'), advancedStats(rows), {rateCols});

  const bySide = groupBy(rows, r=>r.PitcherThrows);
  renderTable(document.getElementById('adv-side'),
    [...bySide.keys()].sort().map(side=>({Side:side, ...advancedStats(bySide.get(side))})), {rateCols});

  const byPitch = groupBy(rows, r=>r.Pitch);
  renderTable(document.getElementById('adv-pitch'),
    sortPitchKeys([...byPitch.keys()]).map(p=>({Pitch:p, ...advancedStats(byPitch.get(p))})), {rateCols});
}

/* ── Tab 4: Exit Velo Stats ── */
function renderEvStats(rows){
  const panel = document.getElementById('panel-evstats');
  panel.innerHTML = `
    <div class="section-label">Overall</div><div id="ev-overall"></div>
    <div class="section-label">By Pitcher Hand</div><div id="ev-side"></div>
    <div class="section-label">By Pitch Type</div><div id="ev-pitch"></div>`;
  const pctCols = ['Hit95+%','LA10-30%','Barrel%','Contact%','Z-Contact%','Chase%'];
  renderTable(document.getElementById('ev-overall'), evStats(rows), {pctCols});

  const bySide = groupBy(rows, r=>r.PitcherThrows);
  renderTable(document.getElementById('ev-side'),
    [...bySide.keys()].sort().map(side=>({Side:side, ...evStats(bySide.get(side))})), {pctCols});

  const byPitch = groupBy(rows, r=>r.Pitch);
  renderTable(document.getElementById('ev-pitch'),
    sortPitchKeys([...byPitch.keys()]).map(p=>({Pitch:p, ...evStats(byPitch.get(p))})), {pctCols});
}

/* ── Tab 5: Exit Velo Charts ── */
function renderEvCharts(rows){
  const panel = document.getElementById('panel-evcharts');
  panel.innerHTML = `
    <div class="section-label">vs RHP</div>
    <div class="grid grid-3">
      <div class="chart-box"><div id="ev_rhp"></div></div>
      <div class="chart-box"><div id="ev_rhp_fb"></div></div>
      <div class="chart-box"><div id="ev_rhp_bb"></div></div>
    </div>
    <div class="section-label chart-row">vs LHP</div>
    <div class="grid grid-3">
      <div class="chart-box"><div id="ev_lhp"></div></div>
      <div class="chart-box"><div id="ev_lhp_fb"></div></div>
      <div class="chart-box"><div id="ev_lhp_bb"></div></div>
    </div>`;
  const tip = r => `Pitch: ${r.Pitch}<br>EV: ${r.EV}<br>Result: ${r.PlayResult}`;
  const evPlot = (id, filterFn, title) => zoneScatter(document.getElementById(id),
    rows.filter(r=>r.InPlay && filterFn(r)), {colorField:'ExitSpeedCategory', colorMap:HARD_HIT_COLORS, title, tooltipFn:tip});

  evPlot('ev_rhp',    r=>r.PitcherThrows==='Right', 'Exit Velo vs RHP');
  evPlot('ev_rhp_fb', r=>r.PitcherThrows==='Right' && r.FBc, 'Exit Velo vs RHP — FB');
  evPlot('ev_rhp_bb', r=>r.PitcherThrows==='Right' && !r.FBc, 'Exit Velo vs RHP — OS/BB');
  evPlot('ev_lhp',    r=>r.PitcherThrows==='Left', 'Exit Velo vs LHP');
  evPlot('ev_lhp_fb', r=>r.PitcherThrows==='Left' && r.FBc, 'Exit Velo vs LHP — FB');
  evPlot('ev_lhp_bb', r=>r.PitcherThrows==='Left' && r.OffSpeed, 'Exit Velo vs LHP — OS/BB');
}

/* ── Tab 6: IZ Whiff / Tab 7: Chase ── */
function renderHeatGrid(panelId, rows, kind){
  const panel = document.getElementById(panelId);
  panel.innerHTML = `
    <div class="section-label">vs RHP</div>
    <div class="grid grid-4">
      <div class="chart-box"><div id="${kind}_rhp"></div></div>
      <div class="chart-box"><div id="${kind}_rhp_fb"></div></div>
      <div class="chart-box"><div id="${kind}_rhp_os"></div></div>
      <div class="chart-box"><div id="${kind}_rhp_bb"></div></div>
    </div>
    <div class="section-label chart-row">vs LHP</div>
    <div class="grid grid-4">
      <div class="chart-box"><div id="${kind}_lhp"></div></div>
      <div class="chart-box"><div id="${kind}_lhp_fb"></div></div>
      <div class="chart-box"><div id="${kind}_lhp_os"></div></div>
      <div class="chart-box"><div id="${kind}_lhp_bb"></div></div>
    </div>`;
  const base = kind==='whiff'
    ? r => r.PitchCall==='StrikeSwinging' && r.Zone
    : r => r.PitchCall==='StrikeSwinging' && !r.Zone;
  const label = kind==='whiff' ? 'Whiff' : 'Chase';
  const draw = (id, filterFn, title) => zoneDensity(document.getElementById(id), rows.filter(r=>base(r) && filterFn(r)), title);

  draw(`${kind}_rhp`,    r=>r.PitcherThrows==='Right', `${label} vs RHP`);
  draw(`${kind}_rhp_fb`, r=>r.PitcherThrows==='Right' && r.FBc, `${label} vs RHP FB`);
  draw(`${kind}_rhp_os`, r=>r.PitcherThrows==='Right' && r.OSc, `${label} vs RHP OS`);
  draw(`${kind}_rhp_bb`, r=>r.PitcherThrows==='Right' && r.BBc, `${label} vs RHP BB`);
  draw(`${kind}_lhp`,    r=>r.PitcherThrows==='Left', `${label} vs LHP`);
  draw(`${kind}_lhp_fb`, r=>r.PitcherThrows==='Left' && r.FBc, `${label} vs LHP FB`);
  draw(`${kind}_lhp_os`, r=>r.PitcherThrows==='Left' && r.OSc, `${label} vs LHP OS`);
  draw(`${kind}_lhp_bb`, r=>r.PitcherThrows==='Left' && r.BBc, `${label} vs LHP BB`);
}

/* ── Tab 8: Swing Decisions / Tab 9: Takes ── */
function renderDecisionGrid(panelId, rows, mode){
  const panel = document.getElementById(panelId);
  const prefix = mode==='swing' ? 'sd' : 'takes';
  panel.innerHTML = `
    <div class="grid grid-3">
      <div class="chart-box"><div id="${prefix}_total"></div></div>
      <div class="chart-box"><div id="${prefix}_rhp"></div></div>
      <div class="chart-box"><div id="${prefix}_lhp"></div></div>
    </div>
    <div class="grid grid-3 chart-row">
      <div class="chart-box"><div id="${prefix}_fastball"></div></div>
      <div class="chart-box"><div id="${prefix}_offspeed"></div></div>
      <div class="chart-box"><div id="${prefix}_bb"></div></div>
    </div>`;
  const baseRows = mode==='swing' ? rows.filter(r=>r.Swing) : rows.filter(r=>r.Take);
  const tip = mode==='swing'
    ? r => `Call: ${r.PitchCall}<br>Result: ${r.PlayResult}<br>EV: ${r.EV}`
    : r => `Count: ${r.Balls}-${r.Strikes}<br>Call: ${r.PitchCall}`;
  const titlePrefix = mode==='swing' ? 'SD' : 'Takes';
  const draw = (id, filterFn, title) => zoneScatter(document.getElementById(id),
    baseRows.filter(filterFn), {colorField:'Pitch', colorMap:PITCH_COLORS, title, tooltipFn:tip});

  draw(`${prefix}_total`,    ()=>true, mode==='swing' ? 'Swing Decisions' : 'Takes — All');
  draw(`${prefix}_rhp`,      r=>r.PitcherThrows==='Right', `${titlePrefix} vs RHP`);
  draw(`${prefix}_lhp`,      r=>r.PitcherThrows==='Left', `${titlePrefix} vs LHP`);
  draw(`${prefix}_fastball`, r=>r.FBc, `${titlePrefix} vs FB`);
  draw(`${prefix}_offspeed`, r=>r.OSc, `${titlePrefix} vs OS`);
  draw(`${prefix}_bb`,       r=>r.BBc, `${titlePrefix} vs BB`);
}

/* ── Tab 10: Contact (3D viewer) ── */
/* ============================================================
   HITTING LAB — recreated from the Hitter HQ reference video.
   Five tabs: Space, Heat, Spray, Trend, Batted Ball. Space and the Heat tab's
   Contact Point sub-mode reuse the 3D point-cloud / contact-point machinery
   already built for the (now-retired) standalone Spray Chart and Contact
   tabs. Trend and Batted Ball had no reference frame in the video provided,
   so those two are a best-effort design rather than a literal recreation.
   ============================================================ */

const labSt = { heatMode:'zone', zoneFilter:'pitches' };

/* -- Heat tab: Zone density (Pitches/Swing/Whiff/Chase/Damage) or
   Contact Point (reuses the old Contact tab's camera + metric toggles) -- */
function renderLabHeat(rows){
  const panel = document.getElementById('panel-heat');
  panel.innerHTML = `
    <div id="lab-heat-panel">
      <div class="contact-btn-row">
        <button class="contact-btn" data-heatmode="zone">Zone</button>
        <button class="contact-btn" data-heatmode="contact">Contact Point</button>
      </div>
      <div id="lab-heat-body"></div>
    </div>`;
  panel.querySelectorAll('[data-heatmode]').forEach(b=>{
    b.addEventListener('click', ()=>{ labSt.heatMode=b.dataset.heatmode; renderLabHeat(fdata()); });
  });
  panel.querySelectorAll('[data-heatmode]').forEach(b=>b.classList.toggle('active', b.dataset.heatmode===labSt.heatMode));

  const body = document.getElementById('lab-heat-body');
  if (labSt.heatMode === 'zone'){
    body.innerHTML = `
      <div class="contact-btn-row" style="margin-top:8px;">
        <button class="contact-btn" data-zf="pitches">Pitches</button>
        <button class="contact-btn" data-zf="swing">Swing</button>
        <button class="contact-btn" data-zf="whiff">Whiff</button>
        <button class="contact-btn" data-zf="chase">Chase</button>
        <button class="contact-btn" data-zf="damage">Damage</button>
      </div>
      <div id="lab-heat-subtitle" class="contact_subtitle" style="color:#8a96a8;font-size:11px;text-align:center;margin:6px 0;"></div>
      <div id="lab-zone-chart" style="height:480px;"></div>`;
    body.querySelectorAll('[data-zf]').forEach(b=>{
      b.addEventListener('click', ()=>{ labSt.zoneFilter=b.dataset.zf; renderLabHeat(fdata()); });
    });
    body.querySelectorAll('[data-zf]').forEach(b=>b.classList.toggle('active', b.dataset.zf===labSt.zoneFilter));

    const filters = {
      pitches: { fn:()=>true,                          label:'Where they attack — density of all located pitches' },
      swing:   { fn:r=>r.Swing,                         label:'Swing density' },
      whiff:   { fn:r=>r.PitchCall==='StrikeSwinging',  label:'Whiff density' },
      chase:   { fn:r=>r.Swing && !r.Zone,               label:'Chase density (swings outside the zone)' },
      damage:  { fn:r=>r.InPlay && (r.H===1||r.HardHit===1), label:'Damage density (hits or 95+ EV)' },
    };
    const f = filters[labSt.zoneFilter];
    const filteredRows = rows.filter(f.fn);
    document.getElementById('lab-heat-subtitle').textContent = `${f.label} (n=${filteredRows.length})`;
    zoneDensity(document.getElementById('lab-zone-chart'), filteredRows, '', 480, true);
  } else {
    body.innerHTML = `
      <div class="contact-btn-row" style="margin-top:8px;">
        <button class="contact-btn" data-cam="catcher">Catcher</button>
        <button class="contact-btn" data-cam="pitcher">Pitcher</button>
        <button class="contact-btn" data-cam="side">Side</button>
        <button class="contact-btn" data-cam="overhead">Overhead</button>
        <div class="contact-btn-divider"></div>
        <button class="contact-btn" data-met="ev">Exit Velo</button>
        <button class="contact-btn" data-met="la">Launch Angle</button>
        <button class="contact-btn" data-met="barrel">Barrel%</button>
      </div>
      <div id="contact_subtitle"></div>
      <div id="contact_n_label"></div>
      <div id="contact_plot_3d" style="height:480px;"></div>`;
    const subtitleFor = met => met==='ev' ? 'Average exit velocity by contact point'
      : met==='la' ? 'Launch angle by contact point' : 'Barrel rate (98+ EV, 10-35°) by contact point';
    function sync(){
      body.querySelectorAll('[data-cam]').forEach(b=>b.classList.toggle('active', b.dataset.cam===contactSt.camera));
      body.querySelectorAll('[data-met]').forEach(b=>b.classList.toggle('active', b.dataset.met===contactSt.metric));
      document.getElementById('contact_subtitle').textContent = subtitleFor(contactSt.metric);
      const n = rows.filter(r=>r.InPlay && r.CPX!=null && r.CPY!=null && r.CPZ!=null).length;
      document.getElementById('contact_n_label').textContent = `n=${n} tracked contacts`;
    }
    body.querySelectorAll('[data-cam]').forEach(b=>b.addEventListener('click', ()=>{
      contactSt.camera=b.dataset.cam; sync(); renderContactPlot(document.getElementById('contact_plot_3d'), fdata());
    }));
    body.querySelectorAll('[data-met]').forEach(b=>b.addEventListener('click', ()=>{
      contactSt.metric=b.dataset.met; sync(); renderContactPlot(document.getElementById('contact_plot_3d'), fdata());
    }));
    sync();
    renderContactPlot(document.getElementById('contact_plot_3d'), rows);
  }
}

/* -- Spray tab: 2D Pull/Center/Oppo fan chart (distinct from the 3D
   physics-arc version that lives in Space) -- */
const labSpraySt = { colorBy:'ev' };
function renderLabSpray(rows){
  const panel = document.getElementById('panel-spray');
  panel.innerHTML = `
    <div id="lab-heat-panel">
    <div class="contact-btn-row">
      <button class="contact-btn" data-lsc="ev">Exit Velo</button>
      <button class="contact-btn" data-lsc="pullopo">Pull/Oppo</button>
      <button class="contact-btn" data-lsc="result">Result</button>
      <button class="contact-btn" data-lsc="type">Type</button>
    </div>
    <div id="lab-spray-chart" style="height:560px;"></div>
    </div>`;
  panel.querySelectorAll('[data-lsc]').forEach(b=>{
    b.addEventListener('click', ()=>{ labSpraySt.colorBy=b.dataset.lsc; renderLabSpray(fdata()); });
  });
  panel.querySelectorAll('[data-lsc]').forEach(b=>b.classList.toggle('active', b.dataset.lsc===labSpraySt.colorBy));
  drawLabSprayFan(document.getElementById('lab-spray-chart'), rows);
}

function drawLabSprayFan(div, rows){
  const inPlay = rows.filter(r=>r.InPlay && r.Bearing!=null && r.Dist!=null && r.Dist>0);
  const pulled = r => r.BatterSide==='Right' ? r.Bearing < -15 : r.Bearing > 15;
  const oppo   = r => r.BatterSide==='Right' ? r.Bearing > 15  : r.Bearing < -15;

  // Field wedge as background shapes: pull (left third), center, oppo (right third)
  const maxD = 350;
  const wedge = (a0,a1,color) => {
    const pts = []; const n=20;
    pts.push([0,0]);
    for (let i=0;i<=n;i++){ const a = a0 + (a1-a0)*i/n; pts.push([Math.sin(a)*maxD, Math.cos(a)*maxD]); }
    pts.push([0,0]);
    return { type:'path', path:'M '+pts.map(p=>p.join(',')).join(' L ')+' Z', fillcolor:color, line:{width:0}, layer:'below' };
  };
  const deg = Math.PI/180*45;
  const shapes = [
    wedge(-deg, -deg/3, 'rgba(180,60,60,0.28)'),
    wedge(-deg/3, deg/3, 'rgba(140,140,150,0.18)'),
    wedge(deg/3, deg, 'rgba(50,100,170,0.28)'),
  ];

  let colorVal, colorscale, cmin, cmax, showscale=false;
  const tip = r => `${r.PlayResult}<br>EV ${fmt1(r.EV)} mph<br>Dist ${fmt0(r.Dist)} ft`;
  let traces;
  if (labSt && labSpraySt.colorBy === 'ev'){
    traces = [{ type:'scatter', mode:'markers',
      x:inPlay.map(r=>Math.sin(r.Bearing*Math.PI/180)*r.Dist), y:inPlay.map(r=>Math.cos(r.Bearing*Math.PI/180)*r.Dist),
      text:inPlay.map(tip), hovertemplate:'%{text}<extra></extra>',
      marker:{ size:8, color:inPlay.map(r=>r.EV), colorscale:[[0,'#1a237e'],[0.4,'#0288d1'],[0.7,'#ffeb3b'],[1,'#e53935']],
        cmin:60, cmax:110, colorbar:{title:{text:'Exit Velo',font:{color:'#93a0b0',size:10}}, tickfont:{color:'#93a0b0',size:9}, thickness:12} },
      showlegend:false }];
  } else if (labSpraySt.colorBy === 'pullopo'){
    const cats = [['Pull', pulled, '#c0392b'], ['Center', r=>!pulled(r)&&!oppo(r), '#9aa0a6'], ['Oppo', oppo, '#3070b0']];
    traces = cats.map(([name,fn,color])=>{
      const sub = inPlay.filter(fn);
      return { type:'scatter', mode:'markers', name,
        x:sub.map(r=>Math.sin(r.Bearing*Math.PI/180)*r.Dist), y:sub.map(r=>Math.cos(r.Bearing*Math.PI/180)*r.Dist),
        text:sub.map(tip), hovertemplate:'%{text}<extra></extra>', marker:{size:8,color,opacity:0.9}, showlegend:true };
    });
  } else if (labSpraySt.colorBy === 'result'){
    const cats = [...new Set(inPlay.map(r=>r.PlayResult))];
    traces = cats.map(name=>{
      const sub = inPlay.filter(r=>r.PlayResult===name);
      return { type:'scatter', mode:'markers', name,
        x:sub.map(r=>Math.sin(r.Bearing*Math.PI/180)*r.Dist), y:sub.map(r=>Math.cos(r.Bearing*Math.PI/180)*r.Dist),
        text:sub.map(tip), hovertemplate:'%{text}<extra></extra>',
        marker:{size:8,color:RESULT_COLORS[name]||'#888',opacity:0.9}, showlegend:true };
    });
  } else {
    const cats = [...new Set(inPlay.map(r=>r.Pitch))];
    traces = cats.map(name=>{
      const sub = inPlay.filter(r=>r.Pitch===name);
      return { type:'scatter', mode:'markers', name,
        x:sub.map(r=>Math.sin(r.Bearing*Math.PI/180)*r.Dist), y:sub.map(r=>Math.cos(r.Bearing*Math.PI/180)*r.Dist),
        text:sub.map(tip), hovertemplate:'%{text}<extra></extra>',
        marker:{size:8,color:PITCH_COLORS[name]||'#888',opacity:0.9}, showlegend:true };
    });
  }

  Plotly.newPlot(div, traces, {
    paper_bgcolor:'#0d1117', plot_bgcolor:'#0d1117',
    xaxis:{visible:false, range:[-maxD,maxD]}, yaxis:{visible:false, range:[-20,maxD], scaleanchor:'x'},
    shapes,
    annotations:[
      {text:'PULL', x:-maxD*0.55, y:maxD*0.35, showarrow:false, font:{color:'#c0392b',size:14,family:'inherit'}},
      {text:'CENTER', x:0, y:maxD*0.55, showarrow:false, font:{color:'#9aa0a6',size:14}},
      {text:'OPPO', x:maxD*0.55, y:maxD*0.35, showarrow:false, font:{color:'#3070b0',size:14}},
    ],
    legend:{font:{color:'#93a0b0'}, bgcolor:'rgba(0,0,0,0)'},
    margin:{l:10,r:10,t:10,b:10}, font:{color:'#93a0b0'}
  }, {displayModeBar:false, responsive:true});
}

/* -- Trend tab: exit velocity over time, with a rolling-average trend line.
   No reference frame was available for this tab in the video, so this is a
   best-effort design rather than a literal recreation. -- */
function renderLabTrend(rows){
  const panel = document.getElementById('panel-trend');
  panel.innerHTML = `<div class="chart-box" style="background:#0d1117;border-color:#232a35;"><div id="lab-trend-chart" style="height:480px;"></div></div>`;
  const inPlay = rows.filter(r=>r.InPlay && r.EV!=null).slice().sort((a,b)=>(a.Date||'').localeCompare(b.Date));
  const xs = inPlay.map((r,i)=>i+1);
  const ys = inPlay.map(r=>r.EV);
  Plotly.newPlot(document.getElementById('lab-trend-chart'), [
    { type:'scatter', mode:'markers', x:xs, y:ys, name:'Exit Velo',
      text:inPlay.map(r=>`${r.Date}<br>${r.PlayResult}<br>${fmt1(r.EV)} mph`), hovertemplate:'%{text}<extra></extra>',
      marker:{ size:7, color:ys, colorscale:[[0,'#1a237e'],[0.5,'#0288d1'],[1,'#e53935']], cmin:60, cmax:110 } },
    { type:'scatter', mode:'lines', x:xs, y:rollingTrend(xs,ys,8), name:'Trend', line:{color:'#f5a623',width:2.5} }
  ], {
    title:{text:'Exit Velocity Over Time', font:{color:'#93a0b0', size:13}},
    xaxis:{title:'Batted Ball #', color:'#8a96a8', gridcolor:'#1e2530'},
    yaxis:{title:'Exit Velo (mph)', color:'#8a96a8', gridcolor:'#1e2530'},
    paper_bgcolor:'#0d1117', plot_bgcolor:'#0d1117', font:{color:'#93a0b0'},
    legend:{font:{color:'#93a0b0'}, bgcolor:'rgba(0,0,0,0)'},
    margin:{l:50,r:20,t:40,b:40}
  }, {displayModeBar:false, responsive:true});
}

/* -- Batted Ball tab: type breakdown (GB/LD/FB/Popup). No reference frame
   was available for this tab either — best-effort design. -- */
function renderLabBattedBall(rows){
  const panel = document.getElementById('panel-batted');
  const inPlay = rows.filter(r=>r.InPlay);
  const total = inPlay.length || 1;
  const types = [
    ['Ground Ball', r=>r.GB],
    ['Line Drive', r=>r.LD],
    ['Fly Ball', r=>r.FB_hit && !r.LD],
    ['Popup', r=>r.HardHit!==undefined && r.FB_hit && r.LA!=null && r.LA>50],
  ];
  const summaryRows = [
    ['Ground Ball', r=>r.GB], ['Line Drive', r=>r.LD], ['Fly Ball/Popup', r=>r.FB_hit],
  ].map(([label,fn])=>{
    const sub = inPlay.filter(fn);
    return {
      Type: label, Count: sub.length, 'Pct%': pct1(sub.length/total),
      'Avg EV': fmt1(mean(sub,r=>r.EV)), 'Avg LA': fmt1(mean(sub,r=>r.LA)),
      'Hard Hit%': pct1(sub.length? mean(sub,r=>r.HardHit):NaN),
      BAA: fmt3(sub.length? mean(sub,r=>r.H) : NaN),
    };
  });
  panel.innerHTML = `<div class="section-label" style="margin-top:0;">Batted Ball Types</div><div id="bb-table"></div>
    <div class="section-label chart-row">Launch Angle Distribution</div>
    <div class="chart-box"><div id="bb-hist" style="height:340px;"></div></div>`;
  renderTable(document.getElementById('bb-table'), summaryRows, {pctCols:['Pct%','Hard Hit%'], rateCols:['BAA']});

  Plotly.newPlot(document.getElementById('bb-hist'), [{
    type:'histogram', x:inPlay.map(r=>r.LA).filter(v=>v!=null),
    marker:{color:'#8C2232'}, nbinsx:30
  }], {
    xaxis:{title:'Launch Angle (°)'}, yaxis:{title:'Count'},
    margin:{l:50,r:20,t:10,b:40}, bargap:0.05
  }, {displayModeBar:false, responsive:true});
}


/* ── Tab 11: Sequences ── */
function renderSequences(rows){
  const panel = document.getElementById('panel-sequences');
  panel.innerHTML = `
    <div class="section-label">Pitch Log</div><div id="seq-table"></div>
    <div class="section-label chart-row">Strike Zone</div><div id="seq-zone" style="height:420px;"></div>`;

  const sorted = rows.slice().sort((a,b)=> (a.Date||'').localeCompare(b.Date));
  const logRows = sorted.map(r=>({
    PitchofPA:r.PitchofPA, Pitcher:r.Pitcher, Pitch:r.Pitch,
    PitchCall: ['FoulBallNotFieldable','FoulBallFieldable'].includes(r.PitchCall) ? 'FoulBall' : r.PitchCall,
    Balls:r.Balls, Strikes:r.Strikes, PlayResult:r.PlayResult,
    RelSpeed:fmt1(r.RelSpeed), IVB:fmt1(r.IVB), HB:fmt1(r.HB),
    EV: r.EV==null?'-':fmt1(r.EV), Angle: r.LA==null?'-':fmt1(r.LA), Distance: r.Dist==null?'-':fmt1(r.Dist)
  }));
  renderTable(document.getElementById('seq-table'), logRows.slice(0,300));

  const tip = (r,i) => `#${i+1} ${r.Pitch}<br>Call: ${r.PitchCall}<br>Result: ${r.PlayResult}<br>EV: ${r.EV??'-'}`;
  const div = document.getElementById('seq-zone');
  const cats = [...new Set(sorted.map(r=>r.Pitch))].sort();
  const traces = cats.map(cat=>{
    const idxs = sorted.map((r,i)=>({r,i})).filter(o=>o.r.Pitch===cat);
    return {
      type:'scatter', mode:'markers+text', name:cat,
      x: idxs.map(o=>o.r.PLS), y: idxs.map(o=>o.r.PLH),
      text: idxs.map(o=>String(o.i+1)), textfont:{size:9,color:'#000'},
      hovertext: idxs.map(o=>tip(o.r,o.i)), hovertemplate:'%{hovertext}<extra></extra>',
      marker:{ color:PITCH_COLORS[cat]||'#888', size:14, opacity:0.85, line:{width:1.5,color:'#000'} }
    };
  });
  Plotly.newPlot(div, traces, {
    title:{text:`Strike Zone — ${state.player}`, font:{size:13}},
    xaxis:{title:'Horizontal Location', range:[-2,2], zeroline:false},
    yaxis:{title:'Vertical Location', range:[0,5], zeroline:false, scaleanchor:'x'},
    shapes: zoneShapes(), legend:{orientation:'h', y:-0.15},
    margin:{l:45,r:10,t:40,b:40}
  }, {displayModeBar:false, responsive:true});
}

/* ============================================================
   SIDEBAR WIRING
   ============================================================ */
/* ── Pitching Tab 1: Results ── */
function renderPitchingResults(rows){
  const panel = document.getElementById('panel-results');
  panel.innerHTML = `
    <div class="section-label">Summary</div><div id="pr-summary"></div>
    <div class="section-label chart-row">By Pitch</div><div id="pr-bypitch"></div>`;
  renderTable(document.getElementById('pr-summary'), pitchingSummary(rows), {rateCols:['BAA','SLG','WHIP','FIP'], pctCols:['K%','BB%']});
  const byPitch = groupBy(rows, r=>r.Pitch);
  renderTable(document.getElementById('pr-bypitch'),
    sortPitchKeys([...byPitch.keys()]).map(p=>({Pitch:p, ...pitchingByPitchStats(byPitch.get(p))})),
    {pctCols:['IZ %','Swing%','Z-Take%','Whiff%','Chase%','Contact%','Barrel%','GB%','FB%','LD%']});
}

/* ── Pitching Tab 2: Results By Split (Pitch x BatterSide) ── */
function renderPitchingResultsSplit(rows){
  const panel = document.getElementById('panel-resultsplit');
  panel.innerHTML = `<div class="section-label">By Pitch &amp; Batter Side</div><div id="pr-split"></div>`;
  const grouped = new Map();
  rows.forEach(r=>{
    const key = `${r.Pitch}||${r.BatterSide}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(r);
  });
  const keys = [...grouped.keys()].sort((a,b)=>{
    const [pa,sa]=a.split('||'), [pb,sb]=b.split('||');
    const ia=PITCH_ORDER.indexOf(pa), ib=PITCH_ORDER.indexOf(pb);
    return (ia<0?999:ia)-(ib<0?999:ib) || sa.localeCompare(sb);
  });
  renderTable(document.getElementById('pr-split'),
    keys.map(k=>{ const [Pitch,Side]=k.split('||'); return {Side, Pitch, ...pitchingByPitchStats(grouped.get(k))}; }),
    {pctCols:['IZ %','Swing%','Z-Take%','Whiff%','Chase%','Contact%','Barrel%','GB%','FB%','LD%']});
}

/* ── Pitching Tab 3: Metrics ── */
function renderPitchingMetrics(rows){
  const panel = document.getElementById('panel-metrics');
  panel.innerHTML = `
    <div class="section-label">By Pitch</div><div id="pm-table"></div>
    <div class="section-label chart-row">Movement</div>
    <div class="chart-box" style="max-width:640px;"><div id="pm-movement"></div></div>`;
  const byPitch = groupBy(rows, r=>r.Pitch);
  const total = rows.length || 1;
  renderTable(document.getElementById('pm-table'),
    sortPitchKeys([...byPitch.keys()]).map(p=>{
      const sub = byPitch.get(p);
      return { Pitch:p, ...pitchingMetricsRow(sub), Usage: pct1(sub.length/total) };
    }).map(({Pitch,Pitches,Usage,AvgVelo,MaxVelo,IVB,HB,SpinRate,SpinAxis,RelHeight,RelSide,Extension,VAA})=>
      ({Pitch,Pitches,Usage,AvgVelo,MaxVelo,IVB,HB,SpinRate,SpinAxis,RelHeight,RelSide,Extension,VAA})),
    {pctCols:['Usage']});

  const tip = r => `Pitch: ${r.Pitch}<br>HB: ${fmt1(r.HB)}  IVB: ${fmt1(r.IVB)}`;
  xyScatter(document.getElementById('pm-movement'), rows, {
    xField:'HB', yField:'IVB', xRange:[-30,30], yRange:[-30,30],
    colorField:'Pitch', colorMap:PITCH_COLORS, title:'Pitch Movement',
    xLabel:'Horizontal Movement (HB)', yLabel:'Vertical Movement (IVB)', tooltipFn:tip
  });
}

/* ── Pitching Tab 4: Release / Extension ── */
function renderReleaseExtension(rows){
  const panel = document.getElementById('panel-releaseext');
  panel.innerHTML = `
    <div class="grid grid-3">
      <div class="chart-box"><div id="re-release"></div></div>
      <div class="chart-box"><div id="re-extension"></div></div>
    </div>`;
  const tipR = r => `Pitch: ${r.Pitch}<br>RelSide: ${fmt1(r.RelSide)}  RelHeight: ${fmt1(r.RelHeight)}`;
  xyScatter(document.getElementById('re-release'), rows, {
    xField:'RelSide', yField:'RelHeight', xRange:[-4,4], yRange:[2,7],
    colorField:'Pitch', colorMap:PITCH_COLORS, title:'Release — Pitcher\u2019s Perspective',
    xLabel:'Horizontal Release Point', yLabel:'Vertical Release Point', tooltipFn:tipR
  });
  const tipE = r => `Pitch: ${r.Pitch}<br>Extension: ${fmt1(r.Extension)}  RelHeight: ${fmt1(r.RelHeight)}`;
  xyScatter(document.getElementById('re-extension'), rows, {
    xField:'Extension', yField:'RelHeight', xRange:[0,8], yRange:[0,8],
    colorField:'Pitch', colorMap:PITCH_COLORS, title:'Extension',
    xLabel:'Extension (ft)', yLabel:'Vertical Release Point', tooltipFn:tipE
  });
}

/* ── Pitching Tab 5: Strike% By Count ── */
const COUNT_FIELDS = [
  ['0-0','FP'],['0-1','Cnt01'],['1-0','Cnt10'],['1-1','Cnt11'],['0-2','Cnt02'],['1-2','Cnt12'],
  ['2-2','Cnt22'],['2-0','Cnt20'],['2-1','Cnt21'],['3-0','Cnt30'],['3-1','Cnt31'],['3-2','CntFull']
];
function strikeByCountRow(rows){
  const row = {};
  COUNT_FIELDS.forEach(([label,field])=>{
    const sub = rows.filter(r=>r[field]);
    row[label] = pct1(sub.length ? mean(sub,r=>r.Strike) : NaN);
  });
  return row;
}
function renderStrikeByCount(rows){
  const panel = document.getElementById('panel-strikecount');
  panel.innerHTML = `
    <div class="section-label">Overall</div><div id="sc-total"></div>
    <div class="section-label chart-row">By Pitch</div><div id="sc-bypitch"></div>`;
  renderTable(document.getElementById('sc-total'), strikeByCountRow(rows), {pctCols:COUNT_FIELDS.map(c=>c[0])});
  const byPitch = groupBy(rows, r=>r.Pitch);
  renderTable(document.getElementById('sc-bypitch'),
    sortPitchKeys([...byPitch.keys()]).map(p=>({Pitch:p, ...strikeByCountRow(byPitch.get(p))})),
    {pctCols:COUNT_FIELDS.map(c=>c[0])});
}

/* ── Pitching Tab 6: Locations ── */
function renderPitchLocations(rows){
  const panel = document.getElementById('panel-locations');
  panel.innerHTML = `
    <div class="grid grid-4">
      <div class="chart-box"><div id="loc-all"></div></div>
      <div class="chart-box"><div id="loc-lhb"></div></div>
      <div class="chart-box"><div id="loc-rhb"></div></div>
      <div class="chart-box"><div id="loc-inplay"></div></div>
    </div>`;
  const tip = r => `RelSpeed: ${fmt1(r.RelSpeed)}<br>Call: ${r.PitchCall}<br>Result: ${r.PlayResult}`;
  const draw = (id, subset, title) => zoneScatter(document.getElementById(id), subset,
    {colorField:'Pitch', colorMap:PITCH_COLORS, title, tooltipFn:tip});
  draw('loc-all', rows, 'Location (All)');
  draw('loc-lhb', rows.filter(r=>r.BatterSide==='Left'), 'Location (LHB)');
  draw('loc-rhb', rows.filter(r=>r.BatterSide==='Right'), 'Location (RHB)');
  draw('loc-inplay', rows.filter(r=>r.PitchCall==='InPlay'), 'Location (InPlay)');
}

/* ── Pitching Tab 7: Heat Maps (FB/OS/BB) ── */
function renderPitchHeatMaps(rows){
  const panel = document.getElementById('panel-heatmaps');
  panel.innerHTML = `
    <div class="grid grid-3">
      <div class="chart-box"><div id="hm-fb"></div></div>
      <div class="chart-box"><div id="hm-os"></div></div>
      <div class="chart-box"><div id="hm-bb"></div></div>
    </div>`;
  zoneDensity(document.getElementById('hm-fb'), rows.filter(r=>r.FBc), 'FB Location');
  zoneDensity(document.getElementById('hm-os'), rows.filter(r=>r.OSc), 'OS Location');
  zoneDensity(document.getElementById('hm-bb'), rows.filter(r=>r.BBc), 'BB Location');
}

/* ── Pitching Tabs 8/9: IZ Whiff / Chase (BatterSide x FB/OS/BB) ── */
function renderPitchingHeatGrid(panelId, rows, kind){
  const panel = document.getElementById(panelId);
  const label = kind==='whiff' ? 'Whiff' : 'Chase';
  panel.innerHTML = `
    <div class="section-label">Right-Handed Hitters</div>
    <div class="grid grid-3">
      <div class="chart-box"><div id="${kind}p_rhh_fb"></div></div>
      <div class="chart-box"><div id="${kind}p_rhh_os"></div></div>
      <div class="chart-box"><div id="${kind}p_rhh_bb"></div></div>
    </div>
    <div class="section-label chart-row">Left-Handed Hitters</div>
    <div class="grid grid-3">
      <div class="chart-box"><div id="${kind}p_lhh_fb"></div></div>
      <div class="chart-box"><div id="${kind}p_lhh_os"></div></div>
      <div class="chart-box"><div id="${kind}p_lhh_bb"></div></div>
    </div>`;
  const zoneWanted = kind==='whiff';
  const base = r => r.PitchCall==='StrikeSwinging' && r.Zone===zoneWanted;
  const draw = (id, side, group, title) => zoneDensity(document.getElementById(id),
    rows.filter(r=>base(r) && r.BatterSide===side && r[group]), title);
  draw(`${kind}p_rhh_fb`, 'Right', 'FBc', `RHH FB ${label}`);
  draw(`${kind}p_rhh_os`, 'Right', 'OSc', `RHH OS ${label}`);
  draw(`${kind}p_rhh_bb`, 'Right', 'BBc', `RHH BB ${label}`);
  draw(`${kind}p_lhh_fb`, 'Left', 'FBc', `LHH FB ${label}`);
  draw(`${kind}p_lhh_os`, 'Left', 'OSc', `LHH OS ${label}`);
  draw(`${kind}p_lhh_bb`, 'Left', 'BBc', `LHH BB ${label}`);
}

/* ── Pitching Tab 10: Velo Over Time ── */
function renderVeloOverTime(rows){
  const panel = document.getElementById('panel-velotime');
  panel.innerHTML = `<div class="chart-box"><div id="velo-time" style="height:420px;"></div></div>`;
  const sorted = rows.slice().sort((a,b)=>(a.Date||'').localeCompare(b.Date));
  const maxVelo = maxOf(sorted, r=>r.RelSpeed) || 1;
  const cats = [...new Set(sorted.map(r=>r.Pitch))].sort();
  const traces = [];
  cats.forEach(cat=>{
    const idxs = sorted.map((r,i)=>({r,i})).filter(o=>o.r.Pitch===cat);
    const xs = idxs.map(o=>o.i+1);
    const ys = idxs.map(o=> o.r.RelSpeed!=null ? (o.r.RelSpeed/maxVelo)*100 : null);
    traces.push({ type:'scatter', mode:'markers', name:cat, x:xs, y:ys,
      marker:{ color:PITCH_COLORS[cat]||'#888', size:7, line:{width:1,color:'#fff'} } });
    traces.push({ type:'scatter', mode:'lines', name:cat+' trend', showlegend:false,
      x:xs, y:rollingTrend(xs,ys), line:{ color:PITCH_COLORS[cat]||'#888', width:2.5 } });
  });
  Plotly.newPlot(document.getElementById('velo-time'), traces, {
    title:{text:'Percentage of Max Velocity', font:{size:13}},
    xaxis:{title:'Pitch Number'}, yaxis:{title:'% of Max Velocity', range:[50,100]},
    legend:{orientation:'h', y:-0.2}, margin:{l:50,r:10,t:34,b:60}
  }, {displayModeBar:false, responsive:true});
}

/* ── Pitching Tab 11: Strike% Over Time ── */
function renderStrikeOverTime(rows){
  const panel = document.getElementById('panel-striketime');
  panel.innerHTML = `<div class="chart-box"><div id="strike-time" style="height:420px;"></div></div>`;
  const sorted = rows.slice().sort((a,b)=>(a.Date||'').localeCompare(b.Date));
  const cats = [...new Set(sorted.map(r=>r.Pitch))].sort();
  const traces = [];
  cats.forEach(cat=>{
    const idxs = sorted.map((r,i)=>({r,i})).filter(o=>o.r.Pitch===cat);
    let strikes = 0;
    const xs = idxs.map(o=>o.i+1);
    const ys = idxs.map((o,j)=>{ if (o.r.Strike) strikes++; return (strikes/(j+1))*100; });
    traces.push({ type:'scatter', mode:'markers', name:cat, x:xs, y:ys,
      marker:{ color:PITCH_COLORS[cat]||'#888', size:7, line:{width:1,color:'#fff'} } });
    traces.push({ type:'scatter', mode:'lines', name:cat+' trend', showlegend:false,
      x:xs, y:rollingTrend(xs,ys), line:{ color:PITCH_COLORS[cat]||'#888', width:2.5 } });
  });
  Plotly.newPlot(document.getElementById('strike-time'), traces, {
    title:{text:'Cumulative Strike %', font:{size:13}},
    xaxis:{title:'Pitch Number'}, yaxis:{title:'Strike %', range:[0,100]},
    legend:{orientation:'h', y:-0.2}, margin:{l:50,r:10,t:34,b:60}
  }, {displayModeBar:false, responsive:true});
}

function scoutMetricsRow(rows){
  return {
    P: rows.length,
    Vel: fmt1(mean(rows,r=>r.RelSpeed)), MxVel: fmt1(maxOf(rows,r=>r.RelSpeed)),
    Spin: fmt0(mean(rows,r=>r.SpinRate)), MxSpin: fmt0(maxOf(rows,r=>r.SpinRate)),
    IVB: fmt1(mean(rows,r=>r.IVB)), HZB: fmt1(mean(rows,r=>r.HB)),
    EXT: fmt1(mean(rows,r=>r.Extension)), "Rel H": fmt1(mean(rows,r=>r.RelHeight)),
    VAA: fmt1(mean(rows,r=>r.VAA)), HAA: fmt1(mean(rows,r=>r.HAA)),
  };
}

/* ── Scout Tab: one-page opposing pitcher scouting report ──
   "Damage" (used in the heat map column) is defined as any batted ball that
   was either a hit or hit hard (95+ EV) — i.e. locations where this pitcher
   has gotten burned. */
const PITCH_ABBR = {
  Fastball:'FB', TwoSeam:'2S', Sinker:'SI', Cutter:'CT',
  ChangeUp:'CH', Changeup:'CH', Splitter:'SP',
  Slider:'SL', Curveball:'CU', Sweeper:'SW', Slurve:'SV',
  Screwball:'SC', Knuckleball:'KN', Other:'OT'
};

function renderScoutReport(rows){
  const panel = document.getElementById('panel-scoutreport');
  if (!state.player){
    panel.innerHTML = `<div class="empty-msg">No pitchers found in this date range.</div>`;
    return;
  }
  if (!rows.length){
    panel.innerHTML = `<div class="empty-msg">No pitches found for this pitcher in the selected range.</div>`;
    return;
  }
  const [pName, pTeam] = state.player.split('||');
  const throws = rows.find(r=>r.PitcherThrows)?.PitcherThrows || '?';
  const games = new Set(rows.map(r=>r.Game)).size;

  panel.innerHTML = `
    <div class="scout-header-row">
      <div class="section-label" style="font-size:13px;color:#333;border:none;margin-top:0;">
        ${pName} <span style="color:#999;font-weight:400;">(${throws}) — ${pTeam}</span>
      </div>
      <button id="scoutPrintBtn" class="spray-btn no-print" type="button">Download PDF</button>
    </div>

    <div class="scout-top-grid-2">
      <div>
        <div class="section-label" style="margin-top:0;">Season Stats</div>
        <div id="scout-summary"></div>
        <div class="section-label" style="margin-top:10px;">TrackMan Data</div>
        <div id="scout-metrics"></div>
      </div>
      <div>
        <div class="section-label" style="margin-top:0;">Pitch Break Chart</div>
        <div class="chart-box"><div id="scout-pitchplot"></div></div>
      </div>
    </div>

    <div class="section-label chart-row">Left-Handed Hitters</div>
    <div class="grid grid-4 scout-heat-grid">
      <div class="chart-box"><div id="scout-lhh-fb"></div></div>
      <div class="chart-box"><div id="scout-lhh-bb"></div></div>
      <div class="chart-box"><div id="scout-lhh-ch"></div></div>
      <div class="chart-box"><div id="scout-dmg-lhh"></div></div>
    </div>

    <div class="section-label chart-row">Right-Handed Hitters</div>
    <div class="grid grid-4 scout-heat-grid">
      <div class="chart-box"><div id="scout-rhh-fb"></div></div>
      <div class="chart-box"><div id="scout-rhh-bb"></div></div>
      <div class="chart-box"><div id="scout-rhh-ch"></div></div>
      <div class="chart-box"><div id="scout-dmg-rhh"></div></div>
    </div>`;

  document.getElementById('scoutPrintBtn').addEventListener('click', ()=>window.print());

  renderTable(document.getElementById('scout-summary'), pitchingSummary(rows, games), {rateCols:['BAA','SLG','WHIP','FIP'], pctCols:['K%','BB%']});

  const byPitch = groupBy(rows, r=>r.Pitch);
  const tipM = r => `Pitch: ${r.Pitch}<br>HB: ${fmt1(r.HB)}  IVB: ${fmt1(r.IVB)}`;
  xyScatter(document.getElementById('scout-pitchplot'), rows, {
    xField:'HB', yField:'IVB', xRange:[-30,30], yRange:[-30,30],
    colorField:'Pitch', colorMap:PITCH_COLORS, title:'',
    xLabel:'Horizontal Break', yLabel:'Induced Vertical Break', tooltipFn:tipM, height:290
  });

  renderTable(document.getElementById('scout-metrics'),
    sortPitchKeys([...byPitch.keys()]).map(p=>({Pitch:PITCH_ABBR[p]||p, ...scoutMetricsRow(byPitch.get(p))})));

  const isCH = r => r.Pitch === 'ChangeUp' || r.Pitch === 'Changeup';
  const isDamage = r => r.InPlay && (r.H===1 || r.HardHit===1);
  const draw = (id, side, filterFn, title) => zoneDensity(document.getElementById(id),
    rows.filter(r=>r.BatterSide===side && filterFn(r)), title, 190);
  draw('scout-rhh-fb', 'Right', r=>r.FBc, 'FB');
  draw('scout-rhh-bb', 'Right', r=>r.BBc, 'BB');
  draw('scout-rhh-ch', 'Right', isCH,     'CH');
  draw('scout-dmg-rhh','Right', isDamage, 'Damage');
  draw('scout-lhh-fb', 'Left',  r=>r.FBc, 'FB');
  draw('scout-lhh-bb', 'Left',  r=>r.BBc, 'BB');
  draw('scout-lhh-ch', 'Left',  isCH,     'CH');
  draw('scout-dmg-lhh','Left',  isDamage, 'Damage');
}

/* -- Cheat Sheet: whole pitching staff at a glance --
   One dense dark row per pitcher, split into a "vs RHH" half and a "vs LHH"
   half mirrored around a center name/info block: a damage spray chart, three
   heat maps (Fastballs / Breaking-Balls-Off-Speed / Damage), a "Go!" zone
   quadrant (best-quadrant highlight, computed per batter side so IN/AWAY
   map correctly to that side's plate geometry), a batter silhouette, and a
   usage list (in-zone pitch count + usage% per pitch type). Pitchers are
   listed alphabetically. */

// "Go!" zone quadrant: highlights whichever quadrant has the highest damage
// rate (hit or 95+ EV) for this batter side, with IN/AWAY mapped correctly
// per side (inside = arm-side of plate for that specific batter hand).
function renderGoCard(div, rows, side){
  const midY = (1.755 + 3.378) / 2;
  const xMin=-1.1, xMax=1.1, yMin=1.0, yMax=4.15;
  const totals = {ul:0, ur:0, dl:0, dr:0};
  const dmg = {ul:0, ur:0, dl:0, dr:0};
  rows.forEach(r=>{
    if (r.PLS==null || r.PLH==null) return;
    if (r.PLS<xMin || r.PLS>xMax || r.PLH<yMin || r.PLH>yMax) return;
    const key = (r.PLH>=midY ? 'u':'d') + (r.PLS<0 ? 'l':'r');
    totals[key]++;
    if (r.InPlay && (r.H===1 || r.HardHit===1)) dmg[key]++;
  });
  const rate = {};
  Object.keys(totals).forEach(k=> rate[k] = totals[k] ? dmg[k]/totals[k] : -1);
  const best = Object.keys(rate).reduce((a,b)=> rate[b]>rate[a] ? b : a, 'ul');

  // For RHH, catcher-view-left (negative PLS) is inside; for LHH it's away.
  const leftLabel = side==='Right' ? 'IN' : 'AWAY';
  const rightLabel = side==='Right' ? 'AWAY' : 'IN';
  const cell = key => `<div class="cheat-go-cell${key===best?' cheat-go-hi':''}">${key===best?'<span class="cheat-go-text">Go!</span>':''}</div>`;
  div.innerHTML = `
    <div class="cheat-go-collabels"><span>${leftLabel}</span><span>${rightLabel}</span></div>
    <div class="cheat-go-body">
      <div class="cheat-go-rowlabels"><span>UP</span><span>DN</span></div>
      <div class="cheat-go-grid">${cell('ul')}${cell('ur')}${cell('dl')}${cell('dr')}</div>
    </div>`;
}

function usageListHTML(rows){
  const total = rows.length || 1;
  const byPitch = groupBy(rows, r=>r.Pitch);
  const list = sortPitchKeys([...byPitch.keys()])
    .map(p=>({p, rows: byPitch.get(p), pct: byPitch.get(p).length/total}))
    .sort((a,b)=> b.pct - a.pct)
    .slice(0,5);
  return `<div class="cheat-usage-list">${list.map(item=>{
    const zoneCount = item.rows.filter(r=>r.Zone).length;
    const color = PITCH_COLORS[item.p]||'#888';
    return `<div class="cheat-usage-row">
      <span class="cheat-usage-num">${zoneCount}z</span>
      <span class="cheat-usage-pct">${pct1(item.pct)}</span>
      <span class="cheat-usage-bar" style="background:${color};width:${Math.max(6,item.pct*40)}px;"></span>
      <span class="cheat-usage-abbr" style="color:${color};">${PITCH_ABBR[item.p]||item.p}</span>
    </div>`;
  }).join('')}</div>`;
}

function primaryStrikeLinesHTML(rows){
  const total = rows.length || 1;
  const byPitch = groupBy(rows, r=>r.Pitch);
  const top2 = sortPitchKeys([...byPitch.keys()])
    .map(p=>({p, rows: byPitch.get(p), pct: byPitch.get(p).length/total}))
    .sort((a,b)=> b.pct - a.pct)
    .slice(0,2);
  const primary = top2.map(t=>`<span style="color:${PITCH_COLORS[t.p]||'#ccc'};">${PITCH_ABBR[t.p]||t.p} ${pct1(t.pct)}</span>`).join(', ');
  const strike = top2.map(t=>{
    const sk = mean(t.rows, r=>r.Strike);
    return `<span style="color:${PITCH_COLORS[t.p]||'#ccc'};">${PITCH_ABBR[t.p]||t.p} ${pct1(sk)}z</span>`;
  }).join(', ');
  return `<div class="cheat-line"><span class="cheat-line-label">PRIMARY:</span> ${primary}</div>
          <div class="cheat-line"><span class="cheat-line-label">STRIKE:</span> ${strike}</div>`;
}

function tagsAndNotesHTML(rows, side, uid){
  const plate = plateTendencyLabel(rows);
  const hit = hitDirectionLabel(rows);
  const fieldAbbr = side==='Right'
    ? {Pull:'(LF)', Oppo:'(RF)', Middle:''}
    : {Pull:'(RF)', Oppo:'(LF)', Middle:''};
  const hitKind = hit.replace('Hit: ','');
  const hitLabel = `${hit} ${fieldAbbr[hitKind]||''}`.trim();
  const pre2k = rows.filter(r=>r.Strikes<2);
  const twoK = rows.filter(r=>r.Strikes===2);
  const fbPre2k = pct1(pre2k.length? mean(pre2k,r=>r.FBc):NaN);
  const fbTwoK = pct1(twoK.length? mean(twoK,r=>r.FBc):NaN);
  const fbOverall = pct1(mean(rows,r=>r.FBc));
  return `
    <div class="cheat-side-tags">
    <div class="cheat-tagsrow">
      <span class="cheat-tag cheat-tag-plate">${plate}</span>
      <span class="cheat-tag cheat-tag-hit">${hitLabel}</span>
      <span class="cheat-tag cheat-tag-fb">FB% Pre-2K: ${fbPre2k}</span>
      <span class="cheat-tag cheat-tag-fb">FB% 2K: ${fbTwoK}</span>
      <span class="cheat-tag cheat-tag-fb">FB% Overall: ${fbOverall}</span>
    </div>
    <input class="cheat-notes" id="${uid}_notes_${side}" type="text" placeholder="vs ${side==='Right'?'RHH':'LHH'} gameplan...">
    </div>`;
}

function cheatSheetRow(name, team, rows){
  const rhh = rows.filter(r=>r.BatterSide==='Right');
  const lhh = rows.filter(r=>r.BatterSide==='Left');
  const uid = `cs_${name.replace(/[^a-zA-Z0-9]/g,'')}_${team}`;
  const throws = rows[0]?.PitcherThrows || '?';
  const games = new Set(rows.map(r=>r.Game)).size;
  const [lastFirst, firstName] = (()=>{
    const parts = name.split(',').map(s=>s.trim());
    return parts.length===2 ? [parts[0], parts[1]] : [name, ''];
  })();

  const heatTile = (side) => `
    <div class="cheat-tilewrap"><div class="cheat-tile-label">DMG SPRAY</div><div id="${uid}_spray_${side}" class="cheat-spray"></div></div>
    <div class="cheat-tilewrap"><div class="cheat-tile-label">DMG</div><div id="${uid}_dmg_${side}" class="cheat-heat"></div></div>
    <div class="cheat-tilewrap"><div class="cheat-tile-label">BBOS</div><div id="${uid}_bbos_${side}" class="cheat-heat"></div></div>
    <div class="cheat-tilewrap"><div class="cheat-tile-label">FB</div><div id="${uid}_fb_${side}" class="cheat-heat"></div></div>
    <div class="cheat-tilewrap"><div class="cheat-tile-label">GO!</div><div id="${uid}_go_${side}" class="cheat-go-card"></div></div>`;

  const html = `
    <div class="cheat-pitcher-block">
    <div class="cheat-row">
      ${heatTile('r')}
      ${usageListHTML(rhh)}
      <div class="cheat-center">
        <div class="cheat-namehdr">NAME</div>
        <div class="cheat-name">${lastFirst}</div>
        <div class="cheat-firstname">${firstName}</div>
        <div class="cheat-rolepill">${classifyRole(rows)==='Starter'?'SP':'RP'}</div>
        <div class="cheat-sub">${throws}HP &middot; ${games}G</div>
        <div class="cheat-extbadges">
          <span class="cheat-extbadge">EXT ${fmt1(mean(rows,r=>r.Extension))}ft</span>
          <span class="cheat-extbadge">REL ${fmt1(mean(rows,r=>Math.abs(r.RelSide)))}ft</span>
        </div>
        ${primaryStrikeLinesHTML(rows)}
      </div>
      ${usageListHTML(lhh)}
      ${heatTile('l')}
    </div>
    <div class="cheat-tagswrap">
      ${tagsAndNotesHTML(rhh, 'Right', uid)}
      ${tagsAndNotesHTML(lhh, 'Left', uid)}
    </div>
    </div>`;

  return { name, html, draw: ()=>{
    renderMiniSpray(document.getElementById(`${uid}_spray_r`), rhh, '', 44);
    renderMiniSpray(document.getElementById(`${uid}_spray_l`), lhh, '', 44);
    zoneDensity(document.getElementById(`${uid}_dmg_r`), rhh.filter(r=>r.InPlay&&(r.H===1||r.HardHit===1)), '', 38, true);
    zoneDensity(document.getElementById(`${uid}_dmg_l`), lhh.filter(r=>r.InPlay&&(r.H===1||r.HardHit===1)), '', 38, true);
    zoneDensity(document.getElementById(`${uid}_bbos_r`), rhh.filter(r=>r.OffSpeed), '', 38, true);
    zoneDensity(document.getElementById(`${uid}_bbos_l`), lhh.filter(r=>r.OffSpeed), '', 38, true);
    zoneDensity(document.getElementById(`${uid}_fb_r`), rhh.filter(r=>r.FBc), '', 38, true);
    zoneDensity(document.getElementById(`${uid}_fb_l`), lhh.filter(r=>r.FBc), '', 38, true);
    renderGoCard(document.getElementById(`${uid}_go_r`), rhh, 'Right');
    renderGoCard(document.getElementById(`${uid}_go_l`), lhh, 'Left');
    // Gameplan notes persist locally per pitcher, in this browser only.
    ['r','l'].forEach(side=>{
      const full = side==='r' ? 'Right' : 'Left';
      const el = document.getElementById(`${uid}_notes_${full}`);
      if (!el) return;
      const key = `gameplan:${uid}:${full}`;
      try { el.value = localStorage.getItem(key) || ''; } catch(e){}
      el.addEventListener('input', ()=>{ try { localStorage.setItem(key, el.value); } catch(e){} });
    });
  }};
}

function renderCheatSheet(rows){
  const panel = document.getElementById('panel-cheatsheet');
  if (!state.team){
    panel.innerHTML = `<div class="empty-msg">No teams found in this date range.</div>`;
    return;
  }
  if (!rows.length){
    panel.innerHTML = `<div class="empty-msg">No pitches found for this team in the selected range.</div>`;
    return;
  }
  const byPitcher = groupBy(rows, r=>r.Pitcher);
  const entries = [...byPitcher.keys()].sort().map(name=>cheatSheetRow(name, state.team, byPitcher.get(name)));

  panel.innerHTML = `
    <div class="scout-header-row">
      <div class="section-label" style="font-size:13px;color:#333;border:none;margin-top:0;">
        ${state.team} <span style="color:#999;font-weight:400;">-- ${rows.length} pitches, ${entries.length} pitcher(s)</span>
      </div>
      <button id="cheatPrintBtn" class="spray-btn no-print" type="button">Download PDF</button>
    </div>
    <div class="cheat-sheet">${entries.map(e=>e.html).join('')}</div>`;

  document.getElementById('cheatPrintBtn').addEventListener('click', ()=>window.print());
  entries.forEach(e=>e.draw());
}

function refreshPlayerOptions(){
  const players = filteredPlayers();
  const playerSel = document.getElementById('playerInput');
  const label = document.getElementById('playerLabel');
  const noun = state.mode === 'pitching' ? 'Pitcher' : (state.mode === 'scout' ? 'Pitcher' : 'Hitter');
  label.textContent = noun;
  const prev = state.player;

  if (state.mode === 'scout'){
    // No "All" option — a scouting report is always for one specific pitcher.
    playerSel.innerHTML = players.map(p=>{
      const [name, team] = p.split('||');
      return `<option value="${p}">${name} (${team})</option>`;
    }).join('');
    state.player = players.includes(prev) ? prev : (players[0] || "");
    playerSel.value = state.player;
    document.getElementById('playerCount').textContent = `${players.length} pitcher(s) in range`;
  } else {
    playerSel.innerHTML = ['All', ...players].map(p=>`<option value="${p}">${p}</option>`).join('');
    state.player = players.includes(prev) ? prev : 'All';
    playerSel.value = state.player;
    document.getElementById('playerCount').textContent = `${players.length} ${noun.toLowerCase()}(s) in range`;
  }
}

function filteredTeams(){
  const [s,e] = [state.dateStart, state.dateEnd];
  const set = new Set();
  ALL_ROWS.forEach(r=>{
    if (r.PitcherTeam && inRange(r.Date,s,e)) set.add(r.PitcherTeam);
  });
  return [...set].sort();
}

function refreshTeamOptions(){
  const teams = filteredTeams();
  const teamSel = document.getElementById('teamInput');
  const prev = state.team;
  teamSel.innerHTML = teams.map(t=>`<option value="${t}">${t}</option>`).join('');
  state.team = teams.includes(prev) ? prev : (teams[0] || "");
  teamSel.value = state.team;
  document.getElementById('teamCount').textContent = `${teams.length} team(s) in range`;
}

function refreshGameOptions(){
  const games = filteredGames();
  const gameSel = document.getElementById('gameInput');
  gameSel.innerHTML = ['All', ...games].map(g=>
    `<option value="${g}">${g==='All'?'All':g.replace(/\s*\(.*\)$/,'')}</option>`).join('');
  state.games = ['All'];
  [...gameSel.options].forEach(o=>{ o.selected = o.value==='All'; });
}

// Toggles the sidebar between the per-pitcher selector (Scouting Report) and
// the team selector (Cheat Sheet) based on which Scout sub-tab is active.
function syncSidebarForTab(){
  const isCheatSheet = state.mode === 'scout' && activeTab === 'cheatsheet';
  document.getElementById('playerLabel').style.display = isCheatSheet ? 'none' : '';
  document.getElementById('playerInput').style.display = isCheatSheet ? 'none' : '';
  document.getElementById('playerCount').style.display = isCheatSheet ? 'none' : '';
  document.getElementById('teamDivider').style.display = isCheatSheet ? '' : 'none';
  document.getElementById('teamLabel').style.display = isCheatSheet ? '' : 'none';
  document.getElementById('teamInput').style.display = isCheatSheet ? '' : 'none';
  if (isCheatSheet) refreshTeamOptions();
}

function initSidebar(){
  const seasonSel = document.getElementById('seasonInput');
  const seasonKeys = [...SEASON_DATE_RANGES.keys()];
  seasonSel.innerHTML = seasonKeys.map(s=>`<option value="${s}">${s}</option>`).join('');
  state.season = seasonKeys[0] || state.season;
  seasonSel.value = state.season;

  const dateStart = document.getElementById('dateStart');
  const dateEnd = document.getElementById('dateEnd');

  function applySeason(){
    const [start,end] = SEASON_DATE_RANGES.get(state.season);
    state.dateStart = start; state.dateEnd = end;
    dateStart.min = start; dateStart.max = end; dateStart.value = start;
    dateEnd.min = start; dateEnd.max = end; dateEnd.value = end;
  }

  seasonSel.addEventListener('change', ()=>{
    state.season = seasonSel.value;
    applySeason(); refreshPlayerOptions(); refreshGameOptions(); syncSidebarForTab(); renderAll();
  });
  dateStart.addEventListener('change', ()=>{ state.dateStart = dateStart.value; refreshPlayerOptions(); refreshGameOptions(); syncSidebarForTab(); renderAll(); });
  dateEnd.addEventListener('change', ()=>{ state.dateEnd = dateEnd.value; refreshPlayerOptions(); refreshGameOptions(); syncSidebarForTab(); renderAll(); });

  document.getElementById('playerInput').addEventListener('change', e=>{ state.player = e.target.value; renderAll(); });
  document.getElementById('teamInput').addEventListener('change', e=>{ state.team = e.target.value; renderAll(); });
  document.getElementById('gameInput').addEventListener('change', e=>{
    const selected = [...e.target.selectedOptions].map(o=>o.value);
    state.games = selected.length ? selected : ['All'];
    renderAll();
  });

  applySeason();
  refreshPlayerOptions();
  refreshGameOptions();
  syncSidebarForTab();
}

/* ============================================================
   MAIN RENDER LOOP — only the active tab is (re)rendered
   ============================================================ */
function renderAll(){
  showActivePanel();
  const rows = fdata();
  if (state.mode === 'pitching'){
    switch(activeTab){
      case 'results':     renderPitchingResults(rows); break;
      case 'resultsplit': renderPitchingResultsSplit(rows); break;
      case 'metrics':     renderPitchingMetrics(rows); break;
      case 'releaseext':  renderReleaseExtension(rows); break;
      case 'strikecount': renderStrikeByCount(rows); break;
      case 'locations':   renderPitchLocations(rows); break;
      case 'heatmaps':    renderPitchHeatMaps(rows); break;
      case 'izwhiffp':    renderPitchingHeatGrid('panel-izwhiffp', rows, 'whiff'); break;
      case 'chasep':      renderPitchingHeatGrid('panel-chasep', rows, 'chase'); break;
      case 'velotime':    renderVeloOverTime(rows); break;
      case 'striketime':  renderStrikeOverTime(rows); break;
    }
  } else if (state.mode === 'scout'){
    if (activeTab === 'scoutreport') renderScoutReport(rows);
    else if (activeTab === 'cheatsheet') renderCheatSheet(teamData());
  } else if (state.mode === 'lab'){
    switch(activeTab){
      case 'space':  renderLabSpace(rows); break;
      case 'heat':   renderLabHeat(rows); break;
      case 'spray':  renderLabSpray(rows); break;
      case 'trend':  renderLabTrend(rows); break;
      case 'batted': renderLabBattedBall(rows); break;
    }
  } else {
    switch(activeTab){
      case 'traditional': renderTraditional(rows); break;
      case 'advanced':    renderAdvanced(rows); break;
      case 'evstats':     renderEvStats(rows); break;
      case 'evcharts':    renderEvCharts(rows); break;
      case 'izwhiff':     renderHeatGrid('panel-izwhiff', rows, 'whiff'); break;
      case 'chase':       renderHeatGrid('panel-chase', rows, 'chase'); break;
      case 'swingdec':    renderDecisionGrid('panel-swingdec', rows, 'swing'); break;
      case 'takes':       renderDecisionGrid('panel-takes', rows, 'take'); break;
      case 'sequences':   renderSequences(rows); break;
    }
  }
}

/* ============================================================
   BOOT — landing screen picks the mode, then the app initializes
   ============================================================ */
function enterMode(mode){
  state.mode = mode;
  state.player = 'All';
  activeTab = null;
  document.getElementById('landingScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = 'flex';
  buildTabPanelsSkeleton();
  initSidebar();
  renderAll();
}
function backToLanding(){
  state.mode = null;
  document.getElementById('appScreen').style.display = 'none';
  document.getElementById('landingScreen').style.display = 'flex';
}
document.getElementById('tileHitting').addEventListener('click', ()=>enterMode('hitting'));
document.getElementById('tilePitching').addEventListener('click', ()=>enterMode('pitching'));
document.getElementById('tileScout').addEventListener('click', ()=>enterMode('scout'));
document.getElementById('tileLab').addEventListener('click', ()=>enterMode('lab'));

// Plotly draws to a fixed pixel size at render time. Print CSS shrinks the
// scout report's containers for one-page layout, so force a resize right
// before the browser paints the print output, or charts would clip/overflow.
// Plotly draws to a fixed pixel size at render time. For print, we shrink
// each chart's actual height (not just its CSS container) and force a
// redraw so the one-page layout has real headroom, then restore on-screen
// sizing afterward.
const PRINT_CHART_HEIGHTS = {
  'scout-pitchplot': 170,
  'scout-lhh-fb': 105, 'scout-lhh-bb': 105, 'scout-lhh-ch': 105, 'scout-dmg-lhh': 105,
  'scout-rhh-fb': 105, 'scout-rhh-bb': 105, 'scout-rhh-ch': 105, 'scout-dmg-rhh': 105,
};
window.addEventListener('beforeprint', ()=>{
  if (state.mode !== 'scout' || !window.Plotly) return;
  Object.entries(PRINT_CHART_HEIGHTS).forEach(([id, h])=>{
    const div = document.getElementById(id);
    if (!div || !div._fullLayout) return;
    div.dataset.onscreenHeight = div._fullLayout.height;
    window.Plotly.relayout(div, {height: h});
  });
});
window.addEventListener('afterprint', ()=>{
  if (state.mode !== 'scout' || !window.Plotly) return;
  Object.keys(PRINT_CHART_HEIGHTS).forEach(id=>{
    const div = document.getElementById(id);
    if (!div || !div.dataset.onscreenHeight) return;
    window.Plotly.relayout(div, {height: Number(div.dataset.onscreenHeight)});
  });
});
document.getElementById('backToLanding').addEventListener('click', backToLanding);
