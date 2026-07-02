// Canvas trust-network view: nodes are citizens, colored by belief in the
// selected claim; edges are trust. Click a node to open the NPC inspector.

import { DISTRICTS } from '../engine/data.js';
import { makeRng } from '../engine/rng.js';

export function createNetworkView(canvas, state, onPickNpc) {
  const ctx = canvas.getContext('2d');
  let positions = null;
  let selectedClaimId = null;
  let selectedNpc = null;
  let hoverNpc = null;

  function layout() {
    const w = canvas.width;
    const h = canvas.height;
    const rng = makeRng(1234); // layout-only rng; never touches game state
    const cx = w / 2;
    const cy = h / 2;
    const ringR = Math.min(w, h) * 0.32;
    const clusterR = Math.min(w, h) * 0.17;
    const centers = DISTRICTS.map((_, d) => {
      const a = (d / DISTRICTS.length) * Math.PI * 2 - Math.PI / 2;
      return [cx + ringR * Math.cos(a), cy + ringR * Math.sin(a)];
    });
    positions = state.npcs.map((npc) => {
      const [dx, dy] = centers[npc.district];
      const a = rng.range(0, Math.PI * 2);
      const r = clusterR * Math.sqrt(rng.next());
      return [dx + r * Math.cos(a), dy + r * Math.sin(a)];
    });
    return centers;
  }

  function beliefColor(claim, i) {
    if (!claim || !claim.aware[i]) return '#333a41';
    const b = claim.belief[i];
    // cold slate -> hot ember
    const r = Math.round(74 + (192 - 74) * b);
    const g = Math.round(90 + (57 - 90) * b);
    const bl = Math.round(116 + (43 - 116) * b);
    return `rgb(${r},${g},${bl})`;
  }

  function draw() {
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
      positions = null;
    }
    if (!canvas.width) return;
    const centers = positions ? null : layout();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const claim = selectedClaimId ? state.claims.find((c) => c.id === selectedClaimId) : null;

    // edges (faint), highlighted for the selected node
    ctx.lineWidth = 0.5;
    for (let to = 0; to < state.npcs.length; to++) {
      for (const e of state.network.edgesIn[to]) {
        const sel = selectedNpc != null && (to === selectedNpc || e.from === selectedNpc);
        if (selectedNpc != null && !sel) continue;
        ctx.strokeStyle = sel ? 'rgba(201,162,39,0.5)' : 'rgba(90,100,110,0.10)';
        ctx.beginPath();
        ctx.moveTo(positions[e.from][0], positions[e.from][1]);
        ctx.lineTo(positions[to][0], positions[to][1]);
        ctx.stroke();
      }
    }

    // nodes
    for (let i = 0; i < state.npcs.length; i++) {
      const npc = state.npcs[i];
      const [x, y] = positions[i];
      const r = 2.2 + npc.influence * 1.5;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = beliefColor(claim, i);
      ctx.fill();
      if (i === selectedNpc || i === hoverNpc) {
        ctx.strokeStyle = '#c9a227';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // district labels
    ctx.font = 'italic 12px Georgia, serif';
    ctx.fillStyle = 'rgba(139,138,128,0.8)';
    ctx.textAlign = 'center';
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const ringR = Math.min(canvas.width, canvas.height) * 0.32;
    const lblR = ringR + Math.min(canvas.width, canvas.height) * 0.155;
    DISTRICTS.forEach((name, d) => {
      const a = (d / DISTRICTS.length) * Math.PI * 2 - Math.PI / 2;
      ctx.fillText(name, cx + lblR * Math.cos(a), cy + lblR * Math.sin(a));
    });
  }

  function npcAt(x, y) {
    if (!positions) return null;
    let best = null;
    let bestD = 400; // 20px pick radius

    for (let i = 0; i < positions.length; i++) {
      const dx = positions[i][0] - x;
      const dy = positions[i][1] - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  canvas.addEventListener('click', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const i = npcAt(ev.clientX - rect.left, ev.clientY - rect.top);
    selectedNpc = i;
    onPickNpc(i);
    draw();
  });
  canvas.addEventListener('mousemove', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const i = npcAt(ev.clientX - rect.left, ev.clientY - rect.top);
    if (i !== hoverNpc) { hoverNpc = i; draw(); }
  });

  return {
    draw,
    setClaim(id) { selectedClaimId = id; draw(); },
    clearSelection() { selectedNpc = null; draw(); },
    get selectedClaimId() { return selectedClaimId; },
  };
}
