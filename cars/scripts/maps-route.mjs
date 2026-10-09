// Road graph from Overpass ways, and the shortest route through a list of waypoints.

function hav(a, b) {
  const r = Math.PI / 180, dl = (b.lat - a.lat) * r, dn = (b.lon - a.lon) * r;
  const h = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
}

export function createGraph(ways, { oneway = true, cost = () => 1, join = 0 } = {}) {
  const nodes = new Map();
  const node = (id, g) => nodes.get(id) || nodes.set(id, { id, lat: g.lat, lon: g.lon, out: [] }).get(id);
  for (const w of ways) {
    if (!w.nodes || !w.geometry) continue;
    const t = w.tags || {}, c = cost(t, w);
    if (!(c > 0)) continue;
    const ow = oneway ? (t.oneway === "-1" ? -1 : t.oneway === "yes" || t.junction === "roundabout" || (t.highway === "motorway" && t.oneway !== "no") ? 1 : 0) : 0;
    for (let i = 1; i < w.nodes.length; i++) {
      const a = node(w.nodes[i - 1], w.geometry[i - 1]), b = node(w.nodes[i], w.geometry[i]), d = hav(a, b);
      if (ow >= 0) a.out.push({ to: b, d, w: d * c, way: w });
      if (ow <= 0) b.out.push({ to: a, d, w: d * c, way: w });
    }
  }
  // Bridge small gaps between way ends that OSM leaves unconnected.
  if (join) {
    const all = [...nodes.values()], ind = new Map();
    for (const n of all) for (const e of n.out) ind.set(e.to, (ind.get(e.to) || 0) + 1);
    const deg = (n) => new Set(n.out.map((e) => e.to)).size + (oneway ? ind.get(n) || 0 : 0);
    for (const a of all) {
      if (deg(a) > 1) continue;
      let best = null, bd = join;
      for (const b of all) { const d = hav(a, b); if (b !== a && d < bd && !a.out.some((e) => e.to === b)) { bd = d; best = b; } }
      if (best) { const way = a.out[0]?.way || best.out[0]?.way; a.out.push({ to: best, d: bd, w: bd * 2, way }); best.out.push({ to: a, d: bd, w: bd * 2, way }); }
    }
  }
  return { nodes };
}

function dijkstra(src) {
  const dist = new Map([[src, 0]]), prev = new Map(), heap = [[0, src]];
  const push = (e) => { heap.push(e); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [d, n] = pop();
    if (d > dist.get(n)) continue;
    for (const e of n.out) {
      const nd = d + e.w;
      if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, e); push([nd, e.to]); }
    }
  }
  return { dist, prev, src };
}


// Viterbi over a few snap candidates per waypoint; returns [{lat, lon, way}] along the route.
export function route(graph, wps, closed, snap = 60) {
  for (const n of graph.nodes.values()) for (const e of n.out) e.fromNode = n;
  const all = [...graph.nodes.values()].filter((n) => n.out.length);
  const cands = wps.map(([lat, lon]) => {
    const p = { lat, lon }, s = all.map((n) => [hav(p, n), n]).sort((a, b) => a[0] - b[0]);
    const near = s.filter((q) => q[0] < snap).slice(0, 6).map((q) => q[1]);
    return near.length ? near : [s[0][1]];
  });
  const legs = new Map(), leg = (a) => legs.get(a) || legs.set(a, dijkstra(a)).get(a);
  const seq = closed ? [...cands, null] : cands;
  let best = null;
  for (const c0 of closed ? cands[0] : [null]) {
    let layer = (closed ? [c0] : cands[0]).map((n) => ({ n, cost: 0, back: null }));
    for (let k = 1; k < seq.length; k++) {
      const next = seq[k] || [c0];
      layer = next.map((n) => {
        let b = null;
        for (const s of layer) { const d = leg(s.n).dist.get(n); if (d !== undefined && s.n !== n && (!b || s.cost + d < b.cost)) b = { n, cost: s.cost + d, back: s }; }
        return b;
      }).filter(Boolean);
      if (!layer.length) { console.warn(`  no path to waypoint ${k % wps.length}`); break; }
    }
    for (const s of layer) if (!best || s.cost < best.cost) best = s;
  }
  if (!best) throw new Error("no route through waypoints");
  const stops = [];
  for (let s = best; s; s = s.back) stops.push(s.n);
  stops.reverse();
  const pts = [{ lat: stops[0].lat, lon: stops[0].lon, way: null }];
  for (let k = 1; k < stops.length; k++) {
    const res = leg(stops[k - 1]), edges = [];
    for (let n = stops[k]; n !== stops[k - 1]; ) { const e = res.prev.get(n); edges.push(e); n = e.fromNode; }
    for (const e of edges.reverse()) pts.push({ lat: e.to.lat, lon: e.to.lon, way: e.way });
  }
  if (closed) pts.shift();
  return { pts, cost: best.cost };
}
