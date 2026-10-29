import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CV Fit | Tối ưu CV cùng AI",
  description: "So sánh CV với mô tả công việc và chuẩn bị phỏng vấn bằng AI."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
