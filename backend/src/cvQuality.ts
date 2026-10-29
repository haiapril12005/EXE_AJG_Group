import type { CvData } from "./cvData";

export type QualityIssue = {
  category: "content" | "presentation";
  severity: "high" | "medium" | "low";
  finding: string;
  suggestion: string;
  evidence_quote: string | null;
};

export function scoreQualityIssues(issues: QualityIssue[]): number {
  const penalty = { high: 18, medium: 8, low: 3 } as const;
  return Math.max(0, 100 - issues.reduce((sum, issue) => sum + penalty[issue.severity], 0));
}

export function inspectCvQuality(cv: CvData, rawText: string): {
  score: number;
  issues: QualityIssue[];
} {
  const issues: QualityIssue[] = [];
  const add = (category: QualityIssue["category"], severity: QualityIssue["severity"],
    finding: string, suggestion: string) => issues.push({ category, severity, finding, suggestion, evidence_quote: null });
  if (!cv.personal_info.name.trim()) add("content", "high", "Thiếu họ tên", "Điền họ tên để nhà tuyển dụng nhận diện ứng viên.");
  if (!cv.personal_info.email.trim() && !cv.personal_info.phone.trim()) {
    add("content", "high", "Thiếu thông tin liên hệ", "Bổ sung email hoặc số điện thoại.");
  }
  if (!cv.summary.trim()) add("content", "medium", "Thiếu mục tiêu nghề nghiệp", "Viết 2–3 câu tóm tắt vị trí và giá trị bạn có thể đóng góp.");
  if (!cv.education.some((item) => item.school.trim())) add("content", "medium", "Thiếu học vấn", "Bổ sung trường và chuyên ngành nếu phù hợp.");
  if (!cv.experience.some((item) => item.description.trim()) && !cv.projects.some((item) => item.description.trim())) {
    add("content", "high", "Thiếu bằng chứng kinh nghiệm hoặc dự án", "Mô tả ít nhất một dự án hoặc kinh nghiệm có thật.");
  }
  if (!cv.skills.some((item) => item.trim())) add("content", "medium", "Thiếu danh sách kỹ năng", "Liệt kê các kỹ năng bạn thực sự sử dụng được.");
  const descriptions = [...cv.experience.map((item) => item.description), ...cv.projects.map((item) => item.description)]
    .filter((value) => value.trim());
  if (descriptions.length && descriptions.every((value) => value.trim().length < 35)) {
    add("content", "medium", "Mô tả dự án hoặc kinh nghiệm quá ngắn", "Nêu vai trò, công việc cụ thể và kết quả có thể kiểm chứng.");
  }
  const words = rawText.trim().split(/\s+/u).filter(Boolean).length;
  if (words < 80) add("presentation", "medium", "CV quá ngắn để đánh giá đầy đủ", "Bổ sung nội dung cụ thể vào các mục chính.");
  if (words > 1500) add("presentation", "medium", "CV có thể quá dài", "Rút gọn thông tin ít liên quan đến vị trí ứng tuyển.");
  if (rawText.split(/\r?\n/u).some((line) => line.length > 250)) {
    add("presentation", "low", "Có dòng văn bản rất dài", "Tách ý thành các đoạn hoặc gạch đầu dòng dễ đọc.");
  }
  return { score: scoreQualityIssues(issues), issues };
}
