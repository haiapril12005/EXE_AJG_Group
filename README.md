# Job Ready — EXE101

Ứng dụng xây dựng CV, đánh giá CV, đối chiếu CV với mô tả công việc (JD), gợi ý tối ưu CV và luyện phỏng vấn bằng giọng nói. Frontend dùng Next.js; API dùng Express; dữ liệu và đăng nhập dùng Supabase.

## Sáu chức năng

1. **CV Builder:** tạo, chỉnh sửa, đổi mẫu, lưu, xóa và xuất PDF; có thể nhập dữ liệu từ PDF đã tải lên.
2. **CV Evaluation:** kiểm tra độ đầy đủ, độ rõ ràng và vấn đề trong văn bản CV, kèm điểm và góp ý. Các lần đánh giá được lưu để so sánh điểm.
3. **CV–JD Matching:** trích yêu cầu từ JD, dẫn chứng từ CV và tính điểm bằng quy tắc backend cố định: kỹ năng 45%, kinh nghiệm 35%, học vấn 20%. Nhóm không có yêu cầu trong JD được bỏ khỏi mẫu số, trọng số của nhóm đó chia theo tỉ lệ cho các nhóm còn lại để tổng vẫn là 100%. Báo cáo liệt kê từng yêu cầu kỹ năng, kinh nghiệm, học vấn kèm trích dẫn từ CV. JD có thể dán vào, chọn từ kho việc làm tự cập nhật, hoặc gửi từ tiện ích trình duyệt.
4. **AI CV Optimization:** viết lại phần tóm tắt, kinh nghiệm hoặc dự án dựa trên mục CV hiện có và JD. Backend từ chối số liệu, thuật ngữ hoặc trích dẫn không có nguồn.
5. **AI Mock Interview:** tạo 3 câu hỏi theo CV và JD (luyện nhanh có thể chọn 5), phát câu hỏi bằng giọng AI, thu âm hoặc nhập câu trả lời. Speech-to-Text tạo bản chép lời để người dùng sửa trước khi nộp. Sau mỗi câu trả lời, người phỏng vấn AI có thể hỏi một câu nối tiếp để đào sâu.
6. **AI Interview Evaluation:** chấm từng câu trả lời, hiển thị điểm mạnh, điểm cần cải thiện, trích dẫn từ câu trả lời và điểm trung bình phiên. Trả lời lại một câu vẫn giữ các lần trước để so sánh điểm.

Góc màn hình có **chatbox hỗ trợ** cách dùng website: các câu hỏi thường gặp được trả lời ngay; câu hỏi tự nhập được AI trả lời theo hướng dẫn sử dụng trong `backend/src/chat.ts` (cập nhật file này khi đổi trang hoặc nút) và không đọc CV. Hội thoại chỉ nằm trong tab trình duyệt và bị xóa khi đăng xuất. Đổi email ở trang Hồ sơ cá nhân cần mật khẩu và mã xác nhận gửi tới cả email cũ lẫn email mới.

Ba tác vụ AI dùng các model riêng: `GEMINI_MODEL=gemini-3.6-flash` cho phân tích và phỏng vấn, `GEMINI_STT_MODEL=gemini-3.5-transcribe` cho nhận dạng giọng nói, `GEMINI_TTS_MODEL=gemini-3.8-flash-lite-tts` cho tạo giọng nói. Cả ba dùng một `GEMINI_API_KEY` ở backend.

## Chạy trên máy

Đọc [hướng dẫn setup](docs/setup.md) để tạo hai file `.env`, chạy các migration Supabase và cấu hình khóa dịch vụ. Sau đó, tại thư mục gốc:

```powershell
npm.cmd ci
npm.cmd run db:check
npm.cmd run dev
```

Website và API chạy chung một cổng: `http://localhost:3000` (API ở `http://localhost:3000/api`). Khi để trống ba biến PayOS, người dùng được phân tích và luyện phỏng vấn miễn phí, không bị trừ credit. Chỉ khi cấu hình đầy đủ PayOS mới bật giới hạn lượt và thanh toán.

## Chống AI bịa thông tin

Backend kiểm tra trích dẫn AI với văn bản CV/JD hoặc câu trả lời gốc, không lấy điểm CV–JD do AI tự đưa ra. Yêu cầu không trích đúng nguyên văn JD bị loại; trích dẫn CV không tìm thấy được tính là chưa đáp ứng, nên lỗi của AI chỉ có thể làm điểm thấp đi, không làm điểm cao lên. Kết quả không kiểm chứng được thì AI được hỏi lại một lần. Phần bóc tách CV và viết lại mục CV bị chặn khi thêm dữ kiện thiếu nguồn. Đây là các hàng rào kiểm tra có giới hạn: trích dẫn có thật vẫn có thể bị hiểu sai hoặc bỏ sót; người dùng nên xem lại CV, JD và các nhận xét trước khi sử dụng.

Đánh giá trình bày hiện dựa trên **văn bản trích xuất**, chưa kiểm tra bố cục thị giác của PDF. PDF dạng ảnh không có lớp văn bản có thể cần OCR trước khi tải lên.

## Kiểm tra và quy trình Git

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

`develop` là nhánh tích hợp frontend, backend, database và tài liệu. `main` dành cho bản đã hoàn tất và được nhóm chấp nhận. Xem [quy trình Git](docs/git-workflow.md) để clone và pull đúng nhánh. Khóa Supabase secret, Gemini và PayOS chỉ đặt ở backend, không dùng tiền tố `NEXT_PUBLIC_`.
