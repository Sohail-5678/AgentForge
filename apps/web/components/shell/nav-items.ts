import {
  Bot,
  Database,
  FlaskConical,
  Gauge,
  GitCompareArrows,
  Inbox,
  ListChecks,
  Scale,
  Settings,
  ShieldAlert,
  Waypoints,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  code: string;
}

export const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Monitor",
    items: [
      { href: "/overview", label: "Overview", icon: Gauge, code: "01" },
      { href: "/agents/returnpilot", label: "Agents", icon: Bot, code: "02" },
      { href: "/runs", label: "Runs", icon: ListChecks, code: "03" },
      { href: "/traces", label: "Traces", icon: Waypoints, code: "04" },
    ],
  },
  {
    group: "Attack",
    items: [{ href: "/redteam", label: "Red team", icon: ShieldAlert, code: "05" }],
  },
  {
    group: "Improve",
    items: [
      { href: "/optimizer", label: "Optimizer", icon: FlaskConical, code: "06" },
      { href: "/datasets", label: "Datasets", icon: Database, code: "07" },
      { href: "/datasets/review", label: "Review queue", icon: Inbox, code: "08" },
      { href: "/calibration", label: "Calibration", icon: Scale, code: "09" },
      { href: "/runs/compare", label: "Compare runs", icon: GitCompareArrows, code: "10" },
    ],
  },
  {
    group: "System",
    items: [{ href: "/settings", label: "Settings", icon: Settings, code: "11" }],
  },
];

export function isActive(pathname: string, href: string) {
  if (href.startsWith("/agents")) return pathname.startsWith("/agents");
  if (href === "/datasets") return pathname === "/datasets" || (pathname.startsWith("/datasets/") && !pathname.startsWith("/datasets/review"));
  if (href === "/runs") return pathname === "/runs" || (pathname.startsWith("/runs/") && !pathname.startsWith("/runs/compare"));
  return pathname === href || pathname.startsWith(`${href}/`);
}
