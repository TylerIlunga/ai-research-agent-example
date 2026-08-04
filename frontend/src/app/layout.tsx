import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Research Agent",
  description:
    "A multi-step research agent: it plans sub-questions, searches the live web, and writes a cited brief you can watch being assembled.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f4f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1216" },
  ],
};

/**
 * Applies the stored theme before first paint. Without this the page renders
 * in the OS theme for one frame and then flips, which reads as a flash.
 */
const THEME_BOOTSTRAP = `
try {
  var choice = localStorage.getItem("research-agent.theme");
  if (choice === "light" || choice === "dark") {
    document.documentElement.setAttribute("data-theme", choice);
  }
} catch (e) {}
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
