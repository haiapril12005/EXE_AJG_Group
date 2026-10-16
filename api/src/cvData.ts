import { z } from "zod";

const text = (max: number) => z.string().max(max).default("");

export const cvDataSchema = z.object({
  template: z.enum(["modern", "classic", "minimal", "creative", "executive", "compact"]).default("modern"),
  personal_info: z.object({
    name: text(120),
    email: text(320),
    phone: text(40),
    title: text(160)
  }).default({ name: "", email: "", phone: "", title: "" }),
  summary: text(3000),
  education: z.array(z.object({
    school: text(200),
    major: text(200),
    gpa: text(40)
  })).max(10).default([]),
  experience: z.array(z.object({
    company: text(200),
    role: text(200),
    description: text(4000)
  })).max(15).default([]),
  projects: z.array(z.object({
    name: text(200),
    technologies: z.array(z.string().max(60)).max(30).default([]),
    description: text(4000)
  })).max(15).default([]),
  skills: z.array(z.string().max(80)).max(60).default([])
});

export type CvData = z.infer<typeof cvDataSchema>;

export function emptyCvData(name = ""): CvData {
  return {
    template: "modern",
    personal_info: { name, email: "", phone: "", title: "" },
    summary: "",
    education: [{ school: "", major: "", gpa: "" }],
    experience: [{ company: "", role: "", description: "" }],
    projects: [{ name: "", technologies: [], description: "" }],
    skills: []
  };
}

export const cvDataJsonSchema = {
  type: "object",
  properties: {
    personal_info: {
      type: "object",
      properties: { name: { type: "string" }, title: { type: "string" } },
      required: ["name", "title"]
    },
    summary: { type: "string" },
    education: {
      type: "array",
      items: {
        type: "object",
        properties: { school: { type: "string" }, major: { type: "string" }, gpa: { type: "string" } },
        required: ["school", "major", "gpa"]
      }
    },
    experience: {
      type: "array",
      items: {
        type: "object",
        properties: { company: { type: "string" }, role: { type: "string" }, description: { type: "string" } },
        required: ["company", "role", "description"]
      }
    },
    projects: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          technologies: { type: "array", items: { type: "string" } },
          description: { type: "string" }
        },
        required: ["name", "technologies", "description"]
      }
    },
    skills: { type: "array", items: { type: "string" } }
  },
  required: ["personal_info", "summary", "education", "experience", "projects", "skills"]
};

export function cvDataToText(cv: CvData): string {
  const lines: string[] = [];
  const info = cv.personal_info;
  lines.push([info.name, info.title].filter(Boolean).join(" - "));
  lines.push([info.email, info.phone].filter(Boolean).join(" | "));
  if (cv.summary) lines.push("", "MỤC TIÊU NGHỀ NGHIỆP", cv.summary);
  if (cv.education.length) {
    lines.push("", "HỌC VẤN");
    for (const item of cv.education) {
      lines.push([item.school, item.major, item.gpa && `GPA ${item.gpa}`].filter(Boolean).join(" - "));
    }
  }
  if (cv.experience.length) {
    lines.push("", "KINH NGHIỆM");
    for (const item of cv.experience) {
      lines.push([item.role, item.company].filter(Boolean).join(" - "), item.description);
    }
  }
  if (cv.projects.length) {
    lines.push("", "DỰ ÁN");
    for (const item of cv.projects) {
      lines.push(item.name);
      if (item.technologies.length) lines.push(`Công nghệ: ${item.technologies.join(", ")}`);
      lines.push(item.description);
    }
  }
  if (cv.skills.length) lines.push("", "KỸ NĂNG", cv.skills.join(", "));
  return lines.filter((line, index, all) => line !== "" || all[index - 1] !== "").join("\n").trim();
}

const emailPattern = /[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/g;
const phonePattern = /(84|0[3|5|7|8|9])+([0-9]{8})\b/g;

export function maskText(value: string): string {
  return value.replace(phonePattern, "[MASKED_PHONE]").replace(emailPattern, "[MASKED_EMAIL]");
}

export function extractContacts(rawText: string): { email: string; phone: string } {
  return {
    email: rawText.match(emailPattern)?.[0] ?? "",
    phone: rawText.match(phonePattern)?.[0] ?? ""
  };
}
