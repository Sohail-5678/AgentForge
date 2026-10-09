/** Re-mounts on every navigation inside the dashboard; the CSS animation replays (works before hydration, no JS). */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
