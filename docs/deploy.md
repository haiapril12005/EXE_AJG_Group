# Deploy Job Ready lên Internet

Website (Next.js) và API (Express) chạy trong **một tiến trình, một cổng**: Express trả lời `/api` và `/health`, mọi đường dẫn khác do Next.js phục vụ. Vì vậy chỉ cần **một Web Service trên Render**; database và đăng nhập vẫn ở Supabase.

| Phần | Nơi chạy | Ghi chú |
| --- | --- | --- |
| Website + API | Render, Web Service gói Free | Giữ mọi khóa bí mật |
| Database + đăng nhập | Supabase (đang dùng sẵn) | Không cần deploy lại |

Không dùng Vercel: Vercel chạy code dạng serverless, giới hạn body mỗi request 4,5 MB (nhỏ hơn CV 5 MB và file ghi âm 8 MB) và không giữ được lịch tự cập nhật kho việc làm.

## 0. Chuẩn bị

1. Code cần deploy phải nằm trên GitHub. Render mặc định deploy nhánh `main`; hãy mở PR `develop → main` và merge, hoặc chọn nhánh `develop` ở bước 1.
2. Chạy kiểm tra trước khi đẩy code:
   ```powershell
   npm.cmd test
   npm.cmd run typecheck
   npm.cmd run build
   ```
3. Không commit `backend/.env` hay `frontend/.env.local`. Các giá trị trong đó được nhập vào dashboard của Render.
4. Supabase đã chạy đủ migration `001` → `009` (`npm.cmd run db:check` báo đạt).

## 1. Tạo Web Service trên Render

1. Đăng nhập [render.com](https://render.com) bằng GitHub → **New → Web Service** → chọn repository.
2. Điền:

   | Trường | Giá trị |
   | --- | --- |
   | Branch | `main` (hoặc `develop`) |
   | Root Directory | để trống (gốc repo, để dùng `package-lock.json` chung) |
   | Runtime | Node |
   | Build Command | `npm ci --include=dev && npm run build` |
   | Start Command | `npm start` |
   | Instance Type | Free |
   | Health Check Path | `/health` |

   `npm run build` build cả API (`backend/dist`) lẫn website (`frontend/.next`). `--include=dev` cần thiết vì bước build dùng TypeScript, Next.js và Tailwind ở devDependencies trong khi `NODE_ENV=production` khiến npm bỏ devDependencies.

3. Mục **Environment Variables**: copy từng dòng trong `backend/.env` **và** hai dòng `NEXT_PUBLIC_SUPABASE_*` trong `frontend/.env.local`, rồi đổi/thêm:

   | Biến | Giá trị trên Render |
   | --- | --- |
   | `NODE_ENV` | `production` (bắt buộc: thiếu biến này website chạy ở chế độ dev, rất chậm) |
   | `NODE_VERSION` | `22` |
   | `TRUST_PROXY` | `1` |
   | `PORT` | **không khai báo**; Render tự cấp |
   | `WEB_ORIGIN` | tạm để `http://localhost:3000`, đổi ở bước 2 |
   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | như `frontend/.env.local` (cần có **trước khi build**) |
   | `NEXT_PUBLIC_API_URL` | **không khai báo** |
   | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWKS_URL` | như `backend/.env` |
   | `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_STT_MODEL`, `GEMINI_TTS_MODEL`, `GEMINI_TTS_VOICE` | như `backend/.env` |
   | `JOB_SYNC_INTERVAL_HOURS` | `12` |
   | `PAYOS_*` | để trống nếu chưa bật thanh toán |

4. Bấm **Create Web Service**, chờ build xong. Render cấp địa chỉ dạng `https://<tên-dịch-vụ>.onrender.com`.
5. Mở `https://<tên-dịch-vụ>.onrender.com/health/ready`; kết quả `{"status":"ready","database":"connected"}` là đã kết nối Supabase. Mở địa chỉ gốc để thấy trang đăng nhập.

Biến `NEXT_PUBLIC_*` được gắn vào code website lúc build. Sau khi sửa các biến này, vào **Manual Deploy → Clear build cache & deploy** để build lại.

## 2. Khai báo địa chỉ website

1. Trên Render, sửa `WEB_ORIGIN` thành địa chỉ Render, ví dụ `https://job-ready.onrender.com` (không có `/` cuối). Render tự khởi động lại.
2. Trên Supabase, **Authentication → URL Configuration**: đặt **Site URL** là địa chỉ Render; thêm cùng địa chỉ đó vào **Redirect URLs** (giữ `http://localhost:3000` để còn chạy local).
3. Kiểm tra mẫu thư **Confirm sign up**, **Reset password** và **Change email address** đã dùng `{{ .Token }}` và Custom SMTP đang bật, theo [email-otp.md](email-otp.md).

## 3. Thử trên bản deploy

1. Mở địa chỉ Render, đăng ký bằng email thật, nhập OTP, đăng nhập.
2. Tải một CV PDF, dán JD hoặc chọn tin trong **Việc làm**, chạy phân tích.
3. Thử phỏng vấn bằng giọng nói (trình duyệt cần quyền micro; Render dùng HTTPS nên micro hoạt động).
4. Thử **Quên mật khẩu?**.

Gói Free tạm dừng dịch vụ sau 15 phút không có truy cập; lần mở tiếp theo chờ khoảng một phút cho cả website lẫn API. Trước buổi demo, mở địa chỉ website một lần để đánh thức. Muốn chạy liên tục thì chuyển dịch vụ sang gói trả phí thấp nhất. Kho việc làm chỉ tự quét lại khi dịch vụ đang chạy; có thể chạy `npm.cmd run jobs:sync` trên máy bất cứ lúc nào vì nó ghi thẳng vào Supabase.

| Hiện tượng | Nguyên nhân thường gặp |
| --- | --- |
| Build lỗi `tsc: not found` hoặc `next: not found` | Thiếu `--include=dev` trong Build Command |
| Build website lỗi `Set NEXT_PUBLIC_SUPABASE_URL...` | Chưa khai báo hai biến `NEXT_PUBLIC_SUPABASE_*` trước khi build |
| Dịch vụ dừng ngay với lỗi `Set SUPABASE_...` | Chưa nhập đủ biến của backend |
| Website rất chậm, log có chữ `compiling` | Thiếu `NODE_ENV=production` |
| Dịch vụ dừng với lỗi `Could not find a production build` | Start Command chạy trước khi build xong website; kiểm tra Build Command là `npm run build` (không chỉ build backend) |
| `/health/ready` báo `schema_not_applied` | Chưa chạy đủ migration trên Supabase |
| Bị báo "quá nhiều yêu cầu" khi nhiều người dùng cùng lúc | Thiếu `TRUST_PROXY=1` nên mọi người dùng bị tính chung một IP |
| Dịch vụ bị khởi động lại vì hết bộ nhớ | Gói Free có 512 MB RAM cho cả website lẫn API; chuyển lên gói trả phí nếu xảy ra thường xuyên |

## 4. Tiện ích trình duyệt

`extension/` đang gửi JD tới `http://localhost:3000`, vẫn đúng khi chạy local. Muốn dùng với bản deploy, đổi `APP_URL` trong `extension/popup.js` sang địa chỉ Render (giữ đường dẫn `/analyze`) và `host_permissions` trong `extension/manifest.json` sang địa chỉ đó, rồi tải lại tiện ích trong `chrome://extensions`.
