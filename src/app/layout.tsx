import type { Metadata } from "next";
import { Fraunces, Space_Grotesk } from "next/font/google";
import GlobalBackHomeNav from "@/components/global-back-home-nav";
import { getServerSession } from "@/lib/auth";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  style: ["normal", "italic"]
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap"
});

export const metadata: Metadata = {
  title: "Paper Serenity Stationery Hub",
  description: "A calm, premium stationery destination for students, creators, and professionals with fast checkout and GST-ready invoices."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const session = getServerSession();

  return (
    <html lang="en" className={`${fraunces.variable} ${spaceGrotesk.variable}`}>
      <body>
        <div className="paper-grid" />
        <div className="grain" />
        <div className="relative z-10">
          <GlobalBackHomeNav session={session} />
          {children}
        </div>
      </body>
    </html>
  );
}