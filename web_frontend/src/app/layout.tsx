import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "TDL Rip — Hi-Fi Music Downloader",
  description: "A premium web interface for downloading high-fidelity tracks, albums, and playlists from Tidal in pristine FLAC quality.",
  keywords: ["tidal", "music", "downloader", "flac", "hi-res", "lossless"],
  authors: [{ name: "TDL Rip" }],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0a0f",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground overflow-x-hidden">
        {children}
        <Toaster
          position="top-center"
          toastOptions={{
            className: "glass-strong border border-white/10 text-foreground",
          }}
        />
      </body>
    </html>
  );
}
