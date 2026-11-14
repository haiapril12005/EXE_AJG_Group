import { z } from "zod";
import { CV_TEMPLATE_IDS, maskText } from "./cvData";

/** Only the latest messages are sent to the AI, which keeps each request small. */
export const MAX_CHAT_HISTORY = 12;

export const chatRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(4000)
  })).min(1).max(40).refine((messages) => messages.at(-1)?.role === "user", {
    message: "The last message must come from the user"
  }),
  // The section of the site the user is on, without ids: "/jobs", "/analysis".
  page: z.string().regex(/^\/[a-z-]*$/u).max(40).optional()
});

export type ChatMessage = z.output<typeof chatRequestSchema>["messages"][number];

/** The assistant explains the website, so it needs no CV; a phone number typed into the chat is masked. */
export function buildChatInput(messages: ChatMessage[], page: string | undefined) {
  return {
    conversation: messages.slice(-MAX_CHAT_HISTORY).map(({ role, content }) => ({ role, content: maskText(content) })),
    current_page: page ?? null
  };
}

export type ChatInput = ReturnType<typeof buildChatInput>;

/** What the assistant may say about the site. Update this when a page or button changes. */
export const SITE_GUIDE = `Trang chính là Việc làm (/jobs): đăng nhập xong hoặc bấm logo Job Ready đều mở trang này. Thanh trên cùng có các mục Việc làm, Phân tích, Tạo CV, Lịch sử; nút mặt trăng hoặc mặt trời đổi giao diện sáng/tối.
Menu tài khoản: bấm vào avatar (chữ cái đầu của tên) ở góc trên bên phải. Menu có "Hồ sơ cá nhân", "Việc làm xem sau", "Lịch sử hoạt động" và "Đăng xuất". Menu cũng hiện mã ID 8 chữ số của tài khoản.
Trang Phân tích (/analyze):
- Bước 1, chọn CV: kéo thả hoặc chọn PDF tối đa 5 MB, chọn CV đã lưu, hoặc bấm "Hoặc tạo CV mới từ form". PDF dạng ảnh không có lớp văn bản sẽ không đọc được; khi đó hãy xuất lại PDF dạng văn bản. Email và số điện thoại được che trước khi gửi AI.
- Bước 2, chọn JD: dán nội dung (50 đến 20.000 ký tự) hoặc chọn từ trang Việc làm.
- Nút "Phân tích bằng AI" tạo báo cáo. Nút "Đánh giá chất lượng CV" chấm CV độc lập với JD. Nút "Luyện phỏng vấn nhanh theo JD này" tạo 3 hoặc 5 câu hỏi.
Báo cáo (/analysis): điểm là mức độ bao phủ yêu cầu JD, gồm kỹ năng 45%, kinh nghiệm 35%, học vấn 20%; nhóm JD không nêu thì bỏ khỏi mẫu số. Điểm không phải xác suất trúng tuyển. Có nút "AI viết lại" từng mục, "Tối ưu toàn bộ CV", "Hoàn tác", "Phân tích lại", và "Bắt đầu luyện trả lời".
Tạo và sửa CV (/create, /cv): chọn 1 trong ${CV_TEMPLATE_IDS.length} mẫu ở "Thư viện thiết kế" (đổi mẫu không mất nội dung), nhập nội dung; CV tự lưu. Bấm "＋ Ảnh 3x4" ở góc phần đầu CV để thêm ảnh (JPG, PNG hoặc WebP, được cắt sẵn theo tỉ lệ 3x4); bấm "Đổi" hoặc "Xóa" trên ảnh để thay hay bỏ. Nút "Xuất PDF" để tải về, "Phân tích CV này" để mở CV sang bước phân tích.
Việc làm (/jobs): tin tại Việt Nam từ trang tuyển dụng của công ty. Tìm theo vị trí, công ty hoặc kỹ năng, lọc theo khu vực. Mỗi tin có "Phân tích với CV của tôi", "Xem mô tả", "☆ Lưu xem sau" và "Tin gốc".
Xem sau: các tin đã lưu nằm ở tab "★ Xem sau · Đã lưu" trong trang Việc làm, hoặc mục "Việc làm xem sau" trong menu tài khoản. Bấm "★ Đã lưu" để bỏ lưu. Danh sách gắn với tài khoản, đăng nhập lại vẫn còn.
Luyện phỏng vấn (/interview): bấm "Nghe câu hỏi", rồi "Thu âm câu trả lời" (tối đa 90 giây, cần cấp quyền microphone) hoặc gõ câu trả lời; sửa bản chép lời rồi bấm "Nộp và nhận đánh giá" (tối thiểu 20 ký tự). Có thể "Trả lời lại" và trả lời câu hỏi nối tiếp.
Lịch sử (/history): xem CV, báo cáo, lần đánh giá và phiên phỏng vấn. Xóa một CV cũng xóa các báo cáo, lần đánh giá và phiên phỏng vấn của CV đó, không thể hoàn tác.
Hồ sơ cá nhân (/profile, mở từ menu tài khoản):
- "Thông tin cá nhân": sửa họ tên và số điện thoại Việt Nam (ví dụ 0912345678), rồi bấm "Lưu thông tin cá nhân".
- "Đổi email": nhập email mới và mật khẩu, bấm "Gửi mã xác nhận", rồi nhập mã trong thư gửi tới email mới và mã trong thư gửi tới email hiện tại. Email chỉ đổi sau khi xác nhận xong.
- "Đổi mật khẩu": nhập mật khẩu hiện tại và mật khẩu mới từ 8 ký tự.
- Ảnh đại diện: bấm "Tải ảnh lên" (hoặc "Đổi ảnh", "Xóa") dưới avatar; ảnh hiện ở góc trên của website.
- Nút "Sao chép" cạnh mã ID; nút "Đăng xuất khỏi tài khoản" ở cuối trang.
Tài khoản: đăng ký bằng email và mật khẩu từ 8 ký tự, rồi nhập mã OTP trong email. Quên mật khẩu: bấm "Quên mật khẩu?" ở màn hình đăng nhập. Không thấy thư thì kiểm tra thư mục Spam và dùng "Gửi lại mã" sau 60 giây.`;
