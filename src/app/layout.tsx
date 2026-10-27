import type { Metadata } from "next";
import { Fraunces, Space_Grotesk } from "next/font/google";
import GlobalBackHomeNav from "@/components/global-back-home-nav";
import ProductNav from "@/components/product-nav";
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
  title: "Serenity BI: profit, stock and cash for businesses on Tally and BUSY",
  description:
    "Serenity BI reads your Tally or BUSY books and marketplace payouts, then shows which products make money after fees, where cash is stuck, which stock will not sell and which customers have gone quiet."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const session = getServerSession();

  return (
    <html lang="en" className={`${fraunces.variable} ${spaceGrotesk.variable}`}>
      <body>
        <div className="paper-grid" />
        <div className="grain" />
        <div className="relative z-10">
          <ProductNav signedIn={!!session} />
          <GlobalBackHomeNav session={session} />
          {children}
        </div>
      </body>
    </html>
  );
}