import { plain } from "./normalize";

type Category = { id: string; label: string };
type CategoryGroup = Category & { categories: Category[] };

/** Occupations the job list can be filtered by, grouped by field, in the order the page lists them. */
export const JOB_CATEGORY_GROUPS: CategoryGroup[] = [
  { id: "group-it", label: "Công nghệ thông tin", categories: [
    { id: "backend", label: "Lập trình Backend" },
    { id: "frontend", label: "Lập trình Frontend" },
    { id: "fullstack", label: "Lập trình Fullstack" },
    { id: "mobile", label: "Lập trình Mobile (iOS/Android)" },
    { id: "devops", label: "DevOps / Cloud / Hạ tầng" },
    { id: "qa", label: "Kiểm thử phần mềm (QA/Tester)" },
    { id: "security", label: "An ninh mạng" },
    { id: "embedded", label: "Nhúng / IoT / Phần cứng" },
    { id: "game", label: "Phát triển game" },
    { id: "it_support", label: "IT Support / Quản trị hệ thống" },
    { id: "software", label: "Kỹ sư phần mềm (khác)" },
  ] },
  { id: "group-data", label: "Dữ liệu & AI", categories: [
    { id: "data_analyst", label: "Phân tích dữ liệu / BI" },
    { id: "data_engineer", label: "Kỹ sư dữ liệu" },
    { id: "ai_ml", label: "AI / Machine Learning" },
  ] },
  { id: "group-product", label: "Sản phẩm & Thiết kế", categories: [
    { id: "product", label: "Quản lý sản phẩm" },
    { id: "project", label: "Quản lý dự án / Scrum" },
    { id: "business_analyst", label: "Phân tích nghiệp vụ (BA)" },
    { id: "ui_ux", label: "Thiết kế UI/UX" },
    { id: "graphic", label: "Thiết kế đồ họa / Sáng tạo" },
  ] },
  { id: "group-business", label: "Kinh doanh & Marketing", categories: [
    { id: "sales", label: "Bán hàng / Kinh doanh" },
    { id: "bd", label: "Phát triển kinh doanh / Key account" },
    { id: "marketing", label: "Marketing" },
    { id: "content", label: "Nội dung / Truyền thông / PR" },
    { id: "customer_service", label: "Chăm sóc khách hàng" },
  ] },
  { id: "group-office", label: "Tài chính & Văn phòng", categories: [
    { id: "finance", label: "Tài chính / Ngân hàng / Bảo hiểm" },
    { id: "accounting", label: "Kế toán / Kiểm toán" },
    { id: "hr", label: "Nhân sự / Tuyển dụng" },
    { id: "legal", label: "Pháp lý / Tuân thủ" },
    { id: "admin", label: "Hành chính / Văn phòng" },
  ] },
  { id: "group-operations", label: "Vận hành & Sản xuất", categories: [
    { id: "operations", label: "Vận hành" },
    { id: "logistics", label: "Logistics / Chuỗi cung ứng / Mua hàng" },
    { id: "manufacturing", label: "Sản xuất / Kỹ thuật / Chất lượng" },
    { id: "construction", label: "Xây dựng / Kiến trúc / Nội thất" },
  ] },
  { id: "group-services", label: "Dịch vụ & Ngành khác", categories: [
    { id: "education", label: "Giáo dục / Đào tạo" },
    { id: "healthcare", label: "Y tế / Dược" },
    { id: "hospitality", label: "Nhà hàng / Khách sạn / Du lịch" },
    { id: "translation", label: "Biên phiên dịch / Ngôn ngữ" },
    { id: "other", label: "Khác" },
  ] },
];

export const JOB_CATEGORIES = JOB_CATEGORY_GROUPS.flatMap((group) => group.categories);

/** What `?category=` accepts: one occupation, or a whole group ("group-it"). */
export const JOB_CATEGORY_FILTERS = [...JOB_CATEGORIES, ...JOB_CATEGORY_GROUPS].map((item) => item.id) as [string, ...string[]];

/** The occupations a filter value covers. */
export function categoriesOfFilter(filter: string): string[] {
  return JOB_CATEGORY_GROUPS.find((group) => group.id === filter)?.categories.map((category) => category.id) ?? [filter];
}

// Checked in order against the title; the first match wins. Narrow fields come before broad ones,
// so "Data Engineer" is data, "Sales Engineer" is sales, "Civil Engineer" is construction and only
// engineering titles nothing else claims fall through to "Kỹ sư phần mềm (khác)".
export const CATEGORY_RULES: [string, RegExp][] = [
  ["ai_ml", /machine learning|\bml\b|\bai\b|artificial intelligence|\bllm\b|\bnlp\b|computer vision|deep learning|data scien|scientist|\bgenai\b/],
  ["data_engineer", /data (engineer|platform|architect|warehouse)|\betl\b|big data|analytics engineer/],
  ["data_analyst", /\bdata\b(?! entry)|analytics|business intelligence|\bbi\b|insights? analyst|reporting analyst|du lieu/],
  ["embedded", /embedded|firmware|\biot\b|hardware|\bfpga\b|\basic\b|vlsi|\bchip\b|\bpcb\b|electronics?|dien tu|nhung/],
  ["game", /\bgames?\b|gameplay|unity|unreal/],
  ["construction", /civil|construction|structural|\bmep\b|site engineer|quantity surveyor|interior|landscape|xay dung|kien truc|noi that/],
  ["ui_ux", /\bux\b|\bui\b|product design|user research|interaction design/],
  ["graphic", /design|graphic|visual|motion|animat|illustrat|creative|video (editor|producer)|photograph|thiet ke/],
  ["product", /\bproduct (manager|owner|lead|director|specialist|operations|analyst)|head of product|\bvp,? product/],
  ["project", /project (manager|coordinator|lead|director|officer|management)|program manager|scrum|agile coach|delivery manager|\bpmo\b|quan ly du an/],
  ["business_analyst", /business analyst|\bba\b|requirements? analyst|functional consultant|phan tich nghiep vu/],
  ["content", /content|copywrit|\beditor\b|communications?|public relations|\bpr\b|social media|community|journalist|truyen thong|bien tap/],
  ["marketing", /marketing|\bseo\b|\bsem\b|growth|\bbrand|go to market|\bgtm\b|digital ads|performance market|tiep thi/],
  ["hr", /\bhr\b|\bhrbp\b|human resources?|recruit|talent|\bpeople\b|payroll|\bc ?& ?b\b|compensation|learning (and|&) development|nhan su|tuyen dung/],
  ["legal", /legal|lawyer|counsel|compliance|paralegal|phap ly|phap che|luat/],
  ["accounting", /accountant|accounting|\baudit|\btax\b|bookkeep|ke toan|kiem toan/],
  ["finance", /financ|treasury|controller|fp ?& ?a|\brisk\b|\bcredit\b|investment|banking|\bbank|actuar|underwrit|insurance|tai chinh|ngan hang|bao hiem|dau tu/],
  ["it_support", /technical support|it support|help ?desk|service desk|desktop support|system admin|sysadmin|network (admin|engineer)|\bnoc\b|\bit (manager|specialist|officer|executive|technician|helpdesk)/],
  ["customer_service", /customer (support|success|service|care|experience)|client service|\bsupport\b|call cent|cham soc khach hang|tong dai/],
  ["bd", /business develop|\bbdm?\b|partnership|alliances?|key account|account (manager|director|lead)|commercial|phat trien kinh doanh/],
  ["sales", /\bsales?\b|pre-?sales|account executive|revenue|telesales|retail|store manager|showroom|kinh doanh|ban hang|cua hang/],
  ["education", /teacher|tutor|lecturer|instructor|trainer|education|teaching|academic|curriculum|giao vien|giang vien|dao tao/],
  ["healthcare", /doctor|nurse|pharmac|medical|clinic|health|dentist|physician|bac si|y ta|duoc|benh vien|y te/],
  ["hospitality", /hotel|restaurant|\bchef\b|\bcook\b|barista|waiter|bartender|housekeep|front desk|travel|\btour|f ?& ?b|nha hang|khach san|du lich/],
  ["translation", /translat|interpret|localization|linguist|bien dich|phien dich|ngon ngu/],
  ["manufacturing", /mechanical|electrical engineer|process engineer|production|manufactur|factory|\bplant\b|quality|\bqc\b|maintenance|technician|\bcnc\b|san xuat|ky thuat vien|chat luong/],
  ["security", /security|cyber|penetration|pentest|\bsoc\b|infosec|an ninh mang|an toan thong tin/],
  ["devops", /devops|\bsre\b|reliability|cloud|infrastructure|platform engineer|kubernetes|system engineer|\bdba\b|database admin/],
  ["qa", /\bqa\b|tester|\btest(ing)?\b|quality assurance|\bsdet\b|automation (engineer|test)|kiem thu/],
  ["fullstack", /full ?-?stack/],
  ["mobile", /mobile|\bios\b|android|flutter|react native|swift|kotlin/],
  ["frontend", /front ?-?end|\breact(js)?\b|angular|\bvue|web developer|javascript|typescript developer/],
  ["backend", /back ?-?end|\bjava\b|golang|\bgo (developer|engineer)|\.net|dotnet|\bc#|\bnode|\bphp\b|python|ruby|\bapi\b|server|microservices?|scala|\brust\b|c\+\+/],
  ["software", /engineer|developer|\bdev\b|programmer|software|architect|tech lead|\bcto\b|blockchain|solidity|lap trinh|ky su/],
  ["logistics", /logistic|supply chain|procurement|purchas|buyer|warehouse|inventory|shipping|freight|import|export|xuat nhap khau|kho van|mua hang|tai xe|driver/],
  ["admin", /admin|office|reception|secretary|assistant|data entry|hanh chinh|le tan|thu ky|tro ly/],
  ["operations", /operation|\bops\b|coordinator|planner|van hanh|dieu phoi/],
];

/** Picks the occupation of a posting from its title; titles that match nothing are "other". */
export function categorizeJob(title: string): string {
  const text = ` ${plain(title).replace(/[^a-z0-9&+#.]+/g, " ")} `;
  return CATEGORY_RULES.find(([, pattern]) => pattern.test(text))?.[0] ?? "other";
}
