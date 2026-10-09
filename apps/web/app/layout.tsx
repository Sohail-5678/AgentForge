import type { Metadata, Viewport } from "next";
import { Anton, Instrument_Serif, Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { themeScript } from "@/components/shell/theme";
import "./globals.css";

const anton = Anton({ subsets: ["latin"], weight: "400", variable: "--font-anton", display: "swap" });
const instrument = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument",
  display: "swap",
});
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://agentforge-eval.vercel.app"),
  title: { default: "AgentForge — evaluate, red-team and optimize AI agents", template: "%s · AgentForge" },
  description:
    "An agent quality platform: deterministic + calibrated-judge evals, an OWASP-mapped red-team engine, and a GEPA-style optimizer whose every improvement must pass a statistical and safety gate before a human promotes it.",
  openGraph: {
    title: "AgentForge",
    description: "Evaluate → attack → improve → gate. The harness around the agent.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#08070b" },
    { media: "(prefers-color-scheme: light)", color: "#f2eee8" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      data-theme="dark"
      className={`${anton.variable} ${instrument.variable} ${inter.variable} ${jetbrains.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-accent focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>
        {children}
        <Toaster
          position="bottom-right"
          theme="system"
          toastOptions={{ className: "!rounded-2xl !border-line !bg-surface-2 !text-ink !font-sans" }}
        />
      </body>
    </html>
  );
}
