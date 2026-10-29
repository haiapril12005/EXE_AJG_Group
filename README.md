# CV Fit MVP

Ứng dụng hỗ trợ phân tích CV và mô tả công việc, gồm giao diện Next.js, API Express và cơ sở dữ liệu Supabase. Gemini phục vụ phân tích AI; PayOS phục vụ thanh toán.

## Cấu trúc repository

```text
backend/    Express API và xử lý nghiệp vụ
frontend/   Ứng dụng Next.js
supabase/   SQL migrations
scripts/    Công cụ kiểm tra môi trường
docs/       Hướng dẫn setup và quy trình Git
```

## Chạy trên máy

Cần Node.js 20+ và một dự án Supabase. Làm theo [hướng dẫn setup](docs/setup.md) để tạo database và các file môi trường, sau đó chạy ở thư mục gốc:

```powershell
npm.cmd ci
npm.cmd run db:check
npm.cmd run dev
```

Trên macOS/Linux, dùng `npm` thay cho `npm.cmd`. Giao diện chạy tại `http://localhost:3000`, API tại `http://localhost:4000`. Gemini và PayOS có thể để trống khi mới khởi động; các tính năng tương ứng chỉ hoạt động sau khi cấu hình khóa.

## Kiểm tra trước khi mở pull request

Điền các biến `NEXT_PUBLIC_SUPABASE_*` trong `frontend/.env.local` trước khi build production.

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd run build
```

## Quy trình Git

- `main`: phiên bản ổn định; chỉ nhận code từ `develop` khi nhóm hoàn thành và kiểm thử dự án.
- `develop`: nhánh tích hợp code backend, frontend, database và docs. Thành viên tạo nhánh theo từng việc từ `develop`, rồi mở pull request về `develop`.
- Các nhánh `feature/*`, `fix/*`, `docs/*` chỉ tồn tại trong lúc thực hiện task. Xem [quy trình Git](docs/git-workflow.md) để lấy code, cập nhật và gộp nhánh.

Khi clone để phát triển, chạy `git switch develop` trước khi `git pull`; clone mặc định sẽ mở `main`.

## Triển khai

Deploy `frontend/` lên Vercel và `backend/` lên một Node.js host. Dùng các biến trong file `.env.example` của từng ứng dụng; đặt `WEB_ORIGIN` theo domain frontend và cập nhật URL PayOS cho môi trường triển khai. Không đưa Supabase secret key, Gemini key hoặc thông tin PayOS vào biến `NEXT_PUBLIC_`.
