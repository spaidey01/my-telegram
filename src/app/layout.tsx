import type { Metadata, Viewport } from "next";
import "../styles/globals.css";
import { ToastContainer } from "react-toastify";
import AosAnimation from "@/components/modules/ui/AosAnimation";

export const metadata: Metadata = {
  title: {
    default: "Stargram",
    template: "%s · Stargram",
  },
  description: "Stargram — a place made with love.",
  applicationName: "Stargram",
  generator: "Next.js",
  referrer: "origin-when-cross-origin",
  keywords: ["Stargram", "messenger", "chat", "social"],
  icons: {
    icon: [
      { url: "/images/stargram-logo.svg", type: "image/svg+xml" },
      { url: "/images/favicon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/images/stargram-logo.svg",
    apple: "/images/stargram-logo.svg",
  },
  appleWebApp: {
    capable: true,
    title: "Stargram",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    type: "website",
    siteName: "Stargram",
    title: "Stargram",
    description: "a place made with love",
    images: [
      {
        url: "/images/stargram-logo.svg",
        width: 256,
        height: 256,
        alt: "Stargram",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "Stargram",
    description: "a place made with love",
    images: ["/images/stargram-logo.svg"],
  },
};

export const viewport: Viewport = {
  themeColor: "#080513",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fa" dir="rtl">
      <body className="font-vazirRegular bg-leftBarBg h-full">
        <ToastContainer />
        <AosAnimation />
        {children}
      </body>
    </html>
  );
}
