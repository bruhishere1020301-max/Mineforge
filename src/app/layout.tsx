import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Press_Start_2P } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { AppProviders } from "@/components/mineforge/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const pixelFont = Press_Start_2P({
  variable: "--font-pixel",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "MineForge Studio — Minecraft Java AI Mod & Shader Studio",
  description:
    "Bring your own AI API keys (OpenAI & Anthropic compatible), pick any model, connect folders from your PC, and generate complete Minecraft Java mods and shader packs straight into them.",
  keywords: ["Minecraft", "mods", "shaders", "AI", "Fabric", "Forge", "NeoForge", "GLSL", "MCP", "Ollama"],
};

export const viewport: Viewport = {
  themeColor: "#0e1512",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${pixelFont.variable} antialiased bg-background text-foreground`}
      >
        <AppProviders>
          {children}
          <Toaster />
        </AppProviders>
      </body>
    </html>
  );
}
