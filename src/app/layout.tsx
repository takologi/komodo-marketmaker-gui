import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { DebugLogWindow } from "@/components/debug-log-window";
import { DebugPopupCenter } from "@/components/debug-popup-center";
import { ensureKcbStartupInitialized } from "@/lib/kcb/startup";
import "./globals.css";

ensureKcbStartupInitialized();

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "KDF Operator Console",
  description: "Monitoring and minimal admin controls for KDF/MM2",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <div className="app-shell">
          <header className="topbar">
            <div>
              <h1>KDF Operator Console</h1>
              <p>Secure server-side proxy for KDF/MM2 operations.</p>
            </div>
          </header>
          <DebugPopupCenter />
          <DebugLogWindow />
          {children}
        </div>
      </body>
    </html>
  );
}
