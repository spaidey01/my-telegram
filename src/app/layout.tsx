import type { Metadata } from "next";
import "../styles/globals.css";
import { ToastContainer } from "react-toastify";
import AosAnimation from "@/components/modules/ui/AosAnimation";

export const metadata: Metadata = {
  title: "Stargram",
  description: "Stargram — پیام‌رسانی که با عشق ساخته شده.",
  applicationName: "Stargram",
  icons: {
    icon: "/images/stargram-logo.png",
    apple: "/images/stargram-logo.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fa" dir="rtl">
      <link rel="manifest" href="/manifest.json" />
      <meta name="apple-mobile-web-app-title" content="Stargram" />
      <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      <meta name="theme-color" content="#0b1220" />

      <body className="font-vazirRegular bg-leftBarBg h-full">
        <ToastContainer />
        <AosAnimation />
        {children}
      </body>
    </html>
  );
}
