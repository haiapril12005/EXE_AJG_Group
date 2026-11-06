import type { Metadata } from "next";
import { AppFrame } from "./app-frame";
import "./globals.css";
import "./workspace.css";

export const metadata: Metadata = {
  title: "Job Ready | Tối ưu CV cùng AI",
  description: "So sánh CV với mô tả công việc và chuẩn bị phỏng vấn bằng AI."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" data-scroll-behavior="smooth">
      <body><AppFrame>{children}</AppFrame></body>
    </html>
  );
}
