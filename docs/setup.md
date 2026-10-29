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

Nếu đã chạy 001 và 002 trước đây, chỉ chạy 003. Migration 003 thêm bảng đánh giá CV, phiên phỏng vấn, câu trả lời và các cột chứng cứ/điểm có trọng số. Tạo tài khoản bằng giao diện để trigger tạo hồ sơ người dùng; credit trong schema không bị sử dụng khi PayOS chưa bật.

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

Trình duyệt chỉ cấp quyền microphone trên `localhost` hoặc HTTPS. Audio tối đa 8 MB; bản thu chỉ được gửi tới backend rồi dịch vụ Gemini để chép lời, không lưu trong database. Văn bản câu trả lời và phản hồi được lưu để xem lại phiên phỏng vấn. CV PDF tối đa 5 MB và cần có lớp văn bản để trích xuất.
