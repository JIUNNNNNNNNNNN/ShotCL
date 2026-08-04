import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/AppShell";
import { PwaRegister } from "@/components/PwaRegister";
import "./globals.css";
import "./text-selection.css";

export const metadata: Metadata = {
  title: "오늘의 스토리보드 진행 관리",
  description: "촬영 현장에서 오늘의 컷 진행 상태를 공유하는 모바일 PWA",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "오늘의 보드",
    statusBarStyle: "black-translucent"
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#121212"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className="app-theme">
        <PwaRegister />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
