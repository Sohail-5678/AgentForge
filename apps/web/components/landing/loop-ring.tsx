/** The evaluate → attack → improve → gate loop as an orbit. Pure SVG + SMIL, so it animates without JS. */
const STATIONS = [
  { label: "Evaluate", sub: "graders · stats", angle: -90 },
  { label: "Attack", sub: "OWASP red team", angle: 0 },
  { label: "Improve", sub: "GEPA-lite", angle: 90 },
  { label: "Gate", sub: "stats · safety · human", angle: 180 },
];

export function LoopRing({ className }: { className?: string }) {
  const c = 200;
  const r = 138;
  return (
    <svg viewBox="-120 -30 640 460" overflow="visible" className={className} role="img" aria-label="The AgentForge loop: evaluate, attack, improve, gate">
      <defs>
        <radialGradient id="ring-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.22" />
          <stop offset="0.6" stopColor="var(--accent)" stopOpacity="0.04" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
        <path id="orbit" d={`M ${c} ${c - r} A ${r} ${r} 0 1 1 ${c - 0.01} ${c - r}`} />
      </defs>
      <circle cx={c} cy={c} r="190" fill="url(#ring-glow)" />
      <circle cx={c} cy={c} r={r + 34} fill="none" stroke="var(--line)" strokeDasharray="1 7" />
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--line-strong)" />
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="90 777" strokeLinecap="round" opacity="0.9">
        <animateTransform attributeName="transform" type="rotate" from={`0 ${c} ${c}`} to={`360 ${c} ${c}`} dur="9s" repeatCount="indefinite" />
      </circle>
      <circle cx={c} cy={c} r={r - 34} fill="none" stroke="var(--line)" />
      {/* orbiting packet */}
      <circle r="4.5" fill="var(--accent)">
        <animateMotion dur="9s" repeatCount="indefinite" rotate="auto">
          <mpath href="#orbit" />
        </animateMotion>
      </circle>
      <circle r="12" fill="var(--accent)" opacity="0.18">
        <animateMotion dur="9s" repeatCount="indefinite">
          <mpath href="#orbit" />
        </animateMotion>
      </circle>
      {STATIONS.map((s, i) => {
        const a = (s.angle * Math.PI) / 180;
        const x = c + r * Math.cos(a);
        const y = c + r * Math.sin(a);
        const lx = c + (r + 32) * Math.cos(a);
        const ly = c + (r + 32) * Math.sin(a);
        const anchor = Math.abs(Math.cos(a)) < 0.2 ? "middle" : Math.cos(a) > 0 ? "start" : "end";
        return (
          <g key={s.label}>
            <circle cx={x} cy={y} r="15" fill="var(--bg)" stroke="var(--line-strong)" />
            <circle cx={x} cy={y} r="5" fill="var(--accent)">
              <animate attributeName="opacity" values="0.35;1;0.35" dur="9s" begin={`${i * 2.25}s`} repeatCount="indefinite" />
            </circle>
            <text x={lx} y={ly - 4} textAnchor={anchor} className="fill-[var(--ink)]" style={{ font: "400 19px var(--font-anton)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
              {s.label}
            </text>
            <text x={lx} y={ly + 13} textAnchor={anchor} className="fill-[var(--muted)]" style={{ font: "400 9.5px var(--font-jetbrains)", letterSpacing: "0.14em", textTransform: "uppercase" }}>
              {s.sub}
            </text>
          </g>
        );
      })}
      <text x={c} y={c - 6} textAnchor="middle" className="fill-[var(--ink)]" style={{ font: "italic 400 30px var(--font-instrument)" }}>
        the loop
      </text>
      <text x={c} y={c + 16} textAnchor="middle" className="fill-[var(--muted)]" style={{ font: "400 9px var(--font-jetbrains)", letterSpacing: "0.2em" }}>
        NIGHTLY · 07:30 UTC
      </text>
    </svg>
  );
}
