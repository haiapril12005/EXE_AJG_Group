import type { Metadata } from "next";
import { AppFrame } from "./app-frame";
import "./globals.css";
import "./workspace.css";
import "./theme-polish.css";

export const metadata: Metadata = {
  title: "Job Ready | Tối ưu CV cùng AI",
  description: "So sánh CV với mô tả công việc và chuẩn bị phỏng vấn bằng AI."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" data-scroll-behavior="smooth">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&family=Nunito:wght@400;500;600;700;800;900&family=Lora:ital,wght@0,400;0,600;0,700;1,400&display=swap"
        />
      </head>
      <body><AppFrame>{children}</AppFrame></body>
    </html>
  );
}
