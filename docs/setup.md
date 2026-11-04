# Setup dự án EXE101

## Yêu cầu

- Node.js 20+ và npm.
- Một Supabase project với URL, publishable key và secret/service role key.
- Gemini API key để dùng phân tích CV, phỏng vấn, Speech-to-Text và Text-to-Speech.
- Thông tin PayOS chỉ khi dự án quyết định bật thu phí.

## Clone và cài đặt

```powershell
git clone https://github.com/haiapril12005/EXE_AJG_Group.git
cd EXE_AJG_Group
git switch develop
git pull origin develop
npm.cmd ci
```

Trên macOS/Linux, thay `npm.cmd` bằng `npm`.

## Supabase

Trong Supabase SQL Editor, chạy các file sau **theo thứ tự**, mỗi file một lần:

1. `supabase/migrations/001_initial_schema.sql`
2. `supabase/migrations/002_cv_data.sql`
3. `supabase/migrations/003_evaluation_and_interviews.sql`
4. `supabase/migrations/004_job_postings.sql`
5. `supabase/migrations/005_interview_practice.sql`

Chỉ cần chạy các file chưa chạy. Migration 003 thêm bảng đánh giá CV, phiên phỏng vấn, câu trả lời và các cột chứng cứ/điểm có trọng số. Migration 004 thêm kho việc làm `job_postings`, cột `analyses.job_id` và cho phép phiên phỏng vấn nhanh không gắn với báo cáo phân tích. Migration 005 lưu các lần trả lời trước, câu hỏi nối tiếp của người phỏng vấn AI và cho phép phiên luyện 5 câu; khi chưa chạy, phỏng vấn vẫn hoạt động nhưng trả lời lại sẽ ghi đè, không có câu hỏi nối tiếp và chỉ luyện được 3 câu. Tạo tài khoản bằng giao diện để trigger tạo hồ sơ người dùng; credit trong schema không bị sử dụng khi PayOS chưa bật.

Để người dùng xác nhận đăng ký bằng mã gửi tới email, làm thêm các bước [cấu hình email OTP](email-otp.md): bật Confirm email, cập nhật mẫu Confirm sign up và cấu hình SMTP. API key trong `.env` không tự bật dịch vụ gửi thư tới mọi người dùng.

## Biến môi trường

```powershell
Copy-Item frontend/.env.example frontend/.env.local
Copy-Item backend/.env.example backend/.env
```

Điền `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` vào frontend. Điền cùng project URL và publishable key, cùng `SUPABASE_SECRET_KEY` vào backend. `SUPABASE_JWKS_URL` có thể để mặc định theo project. Không đưa secret key vào frontend hay Git.

Điền `GEMINI_API_KEY` tại `backend/.env`. Model mặc định: `gemini-3.6-flash` (phân tích và người phỏng vấn), `gemini-3.5-transcribe` (nhận dạng giọng nói), `gemini-3.8-flash-lite-tts` (đọc câu hỏi). Có thể thay bằng model tương thích qua các biến `GEMINI_MODEL`, `GEMINI_STT_MODEL`, `GEMINI_TTS_MODEL`; model phải khả dụng với API key và khu vực sử dụng.

Để thử miễn phí, **để trống cả ba biến `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`**. Phân tích CV–JD và mock interview khi đó không trừ credit và giao diện không hiện nút mua lượt. Nếu sau này bật thu phí, điền đủ ba biến cùng URL trả về/hủy, rồi cấu hình webhook công khai tới `https://<api-host>/api/payment/webhook`.

## Chạy và kiểm tra

```powershell
npm.cmd run db:check
npm.cmd run dev
```

Mở `http://localhost:3000`; API ở `http://localhost:4000`. `http://localhost:4000/health/ready` kiểm tra schema. Nếu `db:check` báo thiếu bảng/cột, chạy migration còn thiếu rồi thử lại. Dùng `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run build` trước khi tạo pull request. Build frontend cần các biến `NEXT_PUBLIC_SUPABASE_*`.

## Kho việc làm

Sau khi chạy migration 004, nạp tin tuyển dụng tại Việt Nam:

```powershell
npm.cmd run jobs:sync -- --dry-run   # chỉ đọc nguồn, không ghi database
npm.cmd run jobs:sync
```

Khi API đang chạy, kho tự cập nhật: lúc khởi động và mỗi giờ, API kiểm tra tin mới nhất trong database và quét lại nếu tin đó cũ hơn `JOB_SYNC_INTERVAL_HOURS` (mặc định 12 giờ). Kho trống thì quét ngay lần đầu. Khởi động lại dev server không gây quét lại. Đặt `JOB_SYNC_INTERVAL_HOURS=0` trong `backend/.env` để tắt và chỉ cập nhật bằng lệnh trên. Ô tìm kiếm ở `/jobs` tìm từng từ khóa trong tiêu đề, tên công ty và mô tả, nên có thể tìm theo kỹ năng, ví dụ `backend typescript`. Danh sách công ty nằm trong `JOB_SOURCES` tại `backend/src/jobs/connectors.ts`. Thêm công ty bằng cách thêm một dòng, sau khi kiểm tra công ty đó có tin tại Việt Nam trên Greenhouse hoặc SmartRecruiters.

- Chỉ dùng API công khai của hệ thống tuyển dụng do chính công ty sử dụng. Không cào TopCV, ITviec hay VietnamWorks vì điều khoản của các trang này hạn chế việc sao chép nội dung. Tài liệu Greenhouse xác nhận API đọc không cần xác thực; tài liệu SmartRecruiters hiện chỉ nêu xác thực bằng API key hoặc OAuth nên cần đọc lại điều khoản trước khi thương mại hóa, dù API vẫn trả dữ liệu khi không có khóa.
- Mỗi tin được chuyển HTML thành văn bản, giới hạn 20.000 ký tự và che email, số điện thoại trước khi lưu.
- Tin vắng mặt ở 2 lần quét liên tiếp sẽ bị ẩn khỏi `/jobs`. Nguồn bị lỗi trong một lần quét không làm ẩn tin nào. Báo cáo cũ vẫn giữ bản sao JD.

## Tiện ích trình duyệt

Thư mục `extension/` là tiện ích Chrome/Edge gửi JD đang xem sang ứng dụng tại `http://localhost:3000`. Mở `chrome://extensions` hoặc `edge://extensions`, bật Developer mode, chọn **Load unpacked** rồi chọn thư mục `extension`. Tiện ích ưu tiên phần văn bản đang bôi đen, sau đó tới dữ liệu JobPosting của trang, cuối cùng là nội dung chính. JD chỉ nằm trong tab ứng dụng của người dùng, không vào kho chung.

## Giới hạn dữ liệu

Trình duyệt chỉ cấp quyền microphone trên `localhost` hoặc HTTPS. Audio tối đa 8 MB; bản thu chỉ được gửi tới backend rồi dịch vụ Gemini để chép lời, không lưu trong database. Văn bản câu trả lời và phản hồi được lưu để xem lại phiên phỏng vấn. CV PDF tối đa 5 MB và cần có lớp văn bản để trích xuất.
