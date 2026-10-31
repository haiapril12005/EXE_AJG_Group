# Xác nhận đăng ký bằng OTP email

Ứng dụng dùng Supabase Auth: người dùng đăng ký bằng email và mật khẩu, nhập mã OTP trong email để xác nhận rồi vào dự án. Mật khẩu vẫn được dùng cho những lần đăng nhập sau. Không cần thêm bảng OTP hay khóa gửi email vào frontend.

**Code và cấu hình gửi thư là hai phần riêng.** File HTML trong repo không tự cập nhật Supabase đang chạy trên cloud. Cần thực hiện các bước Dashboard bên dưới; việc nhận được thư còn phụ thuộc cấu hình SMTP và nhà cung cấp email.

## 1. Bật xác nhận email

Trong đúng Supabase project mà frontend đang sử dụng:

1. Mở **Authentication → Sign In / Providers**.
2. Bật **Confirm email**; kiểm tra provider **Email** và đăng ký tài khoản mới đang được cho phép.
3. Mở **Authentication → URL Configuration**, đặt **Site URL** là `http://localhost:3000` khi chạy local.

Khi Confirm email tắt, Supabase có thể cấp session ngay sau đăng ký; người dùng không phải nhập OTP. Vì vậy cần bật thiết lập này để bắt buộc xác nhận quyền sở hữu email. [Hướng dẫn kiểm tra Auth](https://supabase.com/docs/guides/auth/testing-auth-flows)

## 2. Đổi mẫu thư Confirm sign up

1. Mở **Authentication → Email → Templates** (ở một số phiên bản Dashboard có tên **Email Templates**).
2. Chọn **Confirm sign up**.
3. Đặt subject: `Mã xác nhận đăng ký AI Career Ready`.
4. Copy toàn bộ [supabase/templates/confirm-signup.html](../supabase/templates/confirm-signup.html) vào phần nội dung HTML rồi **Save**.

Phần `{{ .Token }}` được Supabase thay bằng mã xác nhận thật. Giữ nguyên cú pháp này. Mẫu **Confirm sign up** áp dụng cho đăng ký bằng mật khẩu; mẫu **Magic Link** dành cho luồng đăng nhập không mật khẩu. [Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates)

## 3. Cấu hình SMTP để gửi tới email người dùng thử

SMTP mặc định của Supabase chỉ gửi tới email của thành viên trong organization và hiện giới hạn **2 thư/giờ cho cả project**. Email người dùng ứng dụng không tự trở thành email được phép nhận. Vì vậy, email nhập đúng vẫn có thể bị từ chối gửi.

Để người dùng thử bằng email bất kỳ:

1. Chuẩn bị một dịch vụ hỗ trợ SMTP và email/domain gửi đã được dịch vụ đó xác minh.
2. Mở **Authentication → Email → SMTP Settings**, bật **Custom SMTP**.
3. Điền sender email/name, SMTP host, port, username và password theo thông tin nhà cung cấp, rồi lưu.
4. Kiểm tra hạn mức tại **Authentication → Rate Limits** và nhật ký gửi thư của nhà cung cấp.

SMTP password nhập trong Supabase Dashboard, không nhập vào `frontend/.env.local`. Publishable key và secret key của Supabase không thay thế thông tin đăng nhập SMTP. Cấu hình trên cloud vẫn cần thiết khi website chạy ở localhost. [Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)

### Dùng Gmail cho buổi demo local

Có thể dùng Gmail làm địa chỉ gửi cho demo nhỏ nếu tài khoản hỗ trợ App Passwords:

1. Mở phần **Security** trong tài khoản Google, bật **2-Step Verification**.
2. Mở [App Passwords](https://myaccount.google.com/apppasswords), tạo mật khẩu ứng dụng với tên `EXE101 Supabase`.
3. Trong **Custom SMTP** của Supabase, điền:

| Trường | Giá trị |
| --- | --- |
| Sender email | Địa chỉ Gmail vừa tạo App Password |
| Sender name | `AI Career Ready` |
| Host | `smtp.gmail.com` |
| Port | `587` (TLS/STARTTLS) |
| Username | Đầy đủ địa chỉ Gmail, trùng Sender email |
| Password | App Password của Google, **không phải mật khẩu đăng nhập Gmail** |

Lưu cấu hình, sau đó thử đăng ký hoặc gửi lại mã trong ứng dụng. Thông số máy chủ theo [tài liệu SMTP của Google](https://developers.google.com/workspace/gmail/imap/imap-smtp).

Nếu không thấy App Passwords, tài khoản trường/công ty, Advanced Protection hoặc cấu hình chỉ dùng security key có thể không hỗ trợ. Khi đó dùng dịch vụ SMTP khác hoặc hỏi quản trị viên. Đổi mật khẩu Google có thể thu hồi App Password, cần tạo lại và cập nhật Supabase. Không gửi App Password trong chat hoặc đưa lên Git. [Hướng dẫn App Passwords của Google](https://support.google.com/accounts/answer/185833?hl=vi)

## 4. Độ dài, thời hạn và gửi lại

Supabase quyết định mã hợp lệ và thời hạn tại server. Tham chiếu cấu hình cho phép mã **6–10 chữ số**, mô tả mặc định 6 chữ số và thời hạn 3.600 giây. Giao diện cần giữ nguyên số 0 đầu mã và chấp nhận mã theo cấu hình project, không tự xác nhận mã tại client. [Tham chiếu cấu hình OTP](https://supabase.com/docs/guides/local-development/cli/config#auth.email.otp_length)

Kiểm tra **Authentication → Sign In / Providers → Email → Email OTP expiration** để biết thời hạn thực tế. Có thể đặt 600 giây cho thử nghiệm; thay đổi phải lưu trong Dashboard mới có tác dụng. Mẫu thư không ghi cố định thời hạn để tránh hiển thị sai khi đổi cấu hình. [Thiết lập thời hạn email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless#with-otp)

Nút gửi lại chờ 60 giây giữa các lần yêu cầu. Đây là hỗ trợ giao diện; giới hạn của Supabase vẫn có hiệu lực và có thể dài hơn nếu project đã đổi cấu hình. Khi nhận lỗi giới hạn, cần chờ theo thông báo, không bấm đăng ký liên tục. [Rate limits](https://supabase.com/docs/guides/auth/rate-limits)

## 5. Luồng API

```ts
// Tạo tài khoản bằng mật khẩu; khi cần xác nhận thì chưa có session.
await supabase.auth.signUp({
  email,
  password,
  options: { data: { full_name: fullName } },
});

// Xác nhận mã và nhận session từ Supabase.
await supabase.auth.verifyOtp({ email, token, type: "email" });

// Gửi lại thư xác nhận tài khoản đang chờ.
await supabase.auth.resend({ email, type: "signup" });
```

`verifyOtp` dùng `type: "email"`; `resend` dùng `type: "signup"`. Tài khoản chưa xác nhận khi đăng nhập cần quay lại màn hình nhập OTP hoặc gửi lại mã, không tạo tài khoản mới hay bỏ qua xác nhận bằng admin API. [verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp), [resend](https://supabase.com/docs/reference/javascript/auth-resend)

## 6. Dùng thử và tìm lỗi

1. Mở `http://localhost:3000`, đăng ký bằng email bạn có thể mở hộp thư.
2. Nhận thư mới, nhập đầy đủ mã và xác nhận. Nếu cần, kiểm tra Spam/Junk.
3. Thử mã sai hoặc hết hạn: ứng dụng phải giữ người dùng ở bước xác nhận và cho gửi lại.
4. Sau khi xác nhận thành công, đăng xuất rồi đăng nhập bằng email và mật khẩu vừa tạo.
5. Xem **Authentication → Users** để kiểm tra trạng thái xác nhận; xem **Authentication → Logs** khi gửi thư thất bại.

| Hiện tượng / mã lỗi | Cách xử lý |
| --- | --- |
| `email_address_not_authorized` | Cấu hình Custom SMTP cho email ngoài organization. |
| `over_email_send_rate_limit` / HTTP 429 | Đợi hết hạn mức; kiểm tra Rate Limits và giới hạn nhà cung cấp SMTP. |
| Thư vẫn chỉ có nút xác nhận | Kiểm tra đã lưu đúng mẫu **Confirm sign up** trong đúng project; yêu cầu thư mới. |
| `otp_expired` / mã không hợp lệ | Kiểm tra email đã nhập, dùng mã trong thư mới nhất hoặc yêu cầu gửi lại. |
| Không thấy thư dù API không báo lỗi | Kiểm tra Spam/Junk, Auth Logs và nhật ký SMTP; API chấp nhận yêu cầu không bảo đảm thư đã tới hộp thư. |

Không cần sửa migration SQL cho tính năng này. Không lưu OTP, mật khẩu hoặc session vào log để tìm lỗi.

## 7. Kiểm thử tự động

```powershell
npm run auth:check
npm run typecheck
npm test

# Dùng Edge đã cài sẵn trên Windows.
$env:PLAYWRIGHT_CHANNEL = "msedge"
npm run test:auth-ui
Remove-Item Env:PLAYWRIGHT_CHANNEL
```

`auth:check` chỉ đọc các thiết lập Auth công khai để kiểm tra đăng ký và xác nhận email; không thể đọc SMTP hoặc mẫu thư riêng tư. Kiểm thử giao diện chạy server riêng ở cổng 3100, dùng dữ liệu giả và chặn dịch vụ bên ngoài, không gửi email thật. Để xác minh việc gửi thư, vẫn cần thử đăng ký với hộp thư thật theo mục 6.
