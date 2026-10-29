# Setup môi trường

## Yêu cầu

- Node.js 20+ và npm
- Một dự án Supabase
- Gemini API key nếu dùng chức năng phân tích AI
- PayOS credentials nếu dùng thanh toán

## Cài đặt

1. Ở thư mục gốc, chạy `npm ci` (`npm.cmd ci` trên PowerShell nếu `npm.ps1` bị chặn).
2. Trong Supabase SQL Editor, chạy nội dung `supabase/migrations/001_initial_schema.sql` một lần, sau đó chạy các migration tiếp theo theo thứ tự tên file.
3. Sao chép `frontend/.env.example` thành `frontend/.env.local`. Điền Supabase project URL và publishable key từ Project Settings → API Keys. Giữ `NEXT_PUBLIC_API_URL=http://localhost:4000` khi chạy local.
4. Chạy `npm run db:check` để kiểm tra kết nối và bốn bảng dữ liệu.
5. Sao chép `backend/.env.example` thành `backend/.env`. Điền cùng project URL, publishable key và Supabase secret key. Secret key chỉ đặt ở backend, không dùng tiền tố `NEXT_PUBLIC_`.
6. Tùy chọn: điền `GEMINI_API_KEY` để bật phân tích AI và ba biến `PAYOS_*` để bật thanh toán.
7. Chạy `npm run dev`, rồi mở `http://localhost:3000`.

API chạy tại `http://localhost:4000`. Kiểm tra `http://localhost:4000/health/ready` để xem trạng thái kết nối database và schema.
Lệnh `npm run build` cũng cần các biến `NEXT_PUBLIC_SUPABASE_*` của frontend.

## Lưu ý triển khai

Đặt `WEB_ORIGIN` theo domain frontend. Khi dùng PayOS, cấu hình return URL, cancel URL và webhook công khai tại `https://<api-host>/api/payment/webhook`.

API xác minh access token bằng JWKS của Supabase. CV tải lên giới hạn 5 MB và chỉ nhận PDF. Secret key của Supabase, Gemini và PayOS phải ở backend.
