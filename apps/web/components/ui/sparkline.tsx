import { cn } from "@/lib/format";

/** Tiny pass-rate trend with its 95 % band (SVG, server-renderable). Points are 0..1. */
export function Sparkline({
  points,
  className,
  color = "var(--accent)",
  height = 56,
  label,
}: {
  points: { y: number; lo?: number; hi?: number }[];
  className?: string;
  color?: string;
  height?: number;
  label?: string;
}) {
  const w = 240;
  const h = height;
  if (points.length < 2) {
    return <div className={cn("grid place-items-center font-mono text-[0.62rem] text-muted", className)} style={{ height }}>not enough runs yet</div>;
  }
  const ys = points.flatMap((p) => [p.y, p.lo ?? p.y, p.hi ?? p.y]);
  const min = Math.max(0, Math.min(...ys) - 0.04);
  const max = Math.min(1, Math.max(...ys) + 0.04);
  const sx = (i: number) => (i / (points.length - 1)) * (w - 4) + 2;
  const sy = (v: number) => h - 4 - ((v - min) / (max - min || 1)) * (h - 8);
  const line = points.map((p, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
  const band =
    points.map((p, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(p.hi ?? p.y).toFixed(1)}`).join(" ") +
    " " +
    [...points]
      .map((p, i) => ({ p, i }))
      .reverse()
      .map(({ p, i }) => `L${sx(i).toFixed(1)},${sy(p.lo ?? p.y).toFixed(1)}`)
      .join(" ") +
    " Z";
  const area = `${line} L${sx(points.length - 1).toFixed(1)},${h} L${sx(0).toFixed(1)},${h} Z`;
  const last = points[points.length - 1];
  const id = `sp-${Math.abs(hash(line))}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn("w-full overflow-visible", className)} style={{ height }} role="img" aria-label={label ?? "trend"}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={band} fill={color} opacity="0.1" />
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={sx(points.length - 1)} cy={sy(last.y)} r="3" fill={color} />
      <circle cx={sx(points.length - 1)} cy={sy(last.y)} r="7" fill={color} opacity="0.18" />
    </svg>
  );
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
