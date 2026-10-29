# AI Career Ready — EXE101

Ứng dụng xây dựng CV, đánh giá CV, đối chiếu CV với mô tả công việc (JD), gợi ý tối ưu CV và luyện phỏng vấn bằng giọng nói. Frontend dùng Next.js; API dùng Express; dữ liệu và đăng nhập dùng Supabase.

## Sáu chức năng

1. **CV Builder:** tạo, chỉnh sửa, lưu và xuất PDF; có thể nhập dữ liệu từ PDF đã tải lên.
2. **CV Evaluation:** kiểm tra độ đầy đủ, độ rõ ràng và vấn đề trong văn bản CV, kèm điểm và góp ý.
3. **CV–JD Matching:** trích yêu cầu từ JD, dẫn chứng từ CV và tính điểm bằng quy tắc backend cố định: kỹ năng 45%, kinh nghiệm 35%, học vấn 20%. Nhóm không có yêu cầu trong JD được bỏ khỏi mẫu số.
4. **AI CV Optimization:** viết lại phần tóm tắt, kinh nghiệm hoặc dự án dựa trên mục CV hiện có và JD. Backend từ chối số liệu, thuật ngữ hoặc trích dẫn không có nguồn.
5. **AI Mock Interview:** tạo ba câu hỏi theo CV và JD, phát câu hỏi bằng giọng AI, thu âm hoặc nhập câu trả lời. Speech-to-Text tạo bản chép lời để người dùng sửa trước khi nộp.
6. **AI Interview Evaluation:** chấm từng câu trả lời, hiển thị điểm mạnh, điểm cần cải thiện, trích dẫn từ câu trả lời và điểm trung bình phiên.

Ba tác vụ AI dùng các model riêng: `GEMINI_MODEL=gemini-3.6-flash` cho phân tích và phỏng vấn, `GEMINI_STT_MODEL=gemini-3.5-transcribe` cho nhận dạng giọng nói, `GEMINI_TTS_MODEL=gemini-3.8-flash-lite-tts` cho tạo giọng nói. Cả ba dùng một `GEMINI_API_KEY` ở backend.

## Chạy trên máy

Đọc [hướng dẫn setup](docs/setup.md) để tạo hai file `.env`, chạy các migration Supabase và cấu hình khóa dịch vụ. Sau đó, tại thư mục gốc:

```powershell
npm.cmd ci
npm.cmd run db:check
npm.cmd run dev
```

Frontend: `http://localhost:3000`. API: `http://localhost:4000`. Tài khoản mới có một credit để chạy trọn bộ phân tích và phỏng vấn; gói PayOS thêm ba lượt phân tích khi được cấu hình.

## Chống AI bịa thông tin

Backend kiểm tra trích dẫn AI với văn bản CV/JD hoặc câu trả lời gốc, không lấy điểm CV–JD do AI tự đưa ra. Phần bóc tách CV và viết lại mục CV bị chặn khi thêm dữ kiện thiếu nguồn. Đây là các hàng rào kiểm tra có giới hạn: trích dẫn có thật vẫn có thể bị hiểu sai hoặc bỏ sót; người dùng nên xem lại CV, JD và các nhận xét trước khi sử dụng.

Đánh giá trình bày hiện dựa trên **văn bản trích xuất**, chưa kiểm tra bố cục thị giác của PDF. PDF dạng ảnh không có lớp văn bản có thể cần OCR trước khi tải lên.

## Kiểm tra và quy trình Git

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

`develop` là nhánh tích hợp frontend, backend, database và tài liệu. `main` dành cho bản đã hoàn tất và được nhóm chấp nhận. Xem [quy trình Git](docs/git-workflow.md) để clone và pull đúng nhánh. Khóa Supabase secret, Gemini và PayOS chỉ đặt ở backend, không dùng tiền tố `NEXT_PUBLIC_`.
