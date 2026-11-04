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
    gpa: text(40),
    start_date: text(40),
    end_date: text(40)
  })).max(10).default([]),
  experience: z.array(z.object({
    company: text(200),
    role: text(200),
    start_date: text(40),
    end_date: text(40),
    description: text(4000)
  })).max(15).default([]),
  projects: z.array(z.object({
    name: text(200),
    technologies: z.array(z.string().max(60)).max(30).default([]),
    description: text(4000)
  })).max(15).default([]),
  skills: z.array(z.string().max(80)).max(60).default([]),
  languages: z.array(z.object({
    name: text(80),
    level: text(80)
  })).max(10).default([]),
  certificates: z.array(z.object({
    name: text(200),
    issuer: text(200),
    year: text(20)
  })).max(20).default([]),
  links: z.array(z.object({
    label: text(60),
    url: text(300)
  })).max(8).default([])
});

export type CvData = z.infer<typeof cvDataSchema>;

export function emptyCvData(name = ""): CvData {
  return {
    template: "modern",
    personal_info: { name, email: "", phone: "", title: "" },
    summary: "",
    education: [{ school: "", major: "", gpa: "", start_date: "", end_date: "" }],
    experience: [{ company: "", role: "", start_date: "", end_date: "", description: "" }],
    projects: [{ name: "", technologies: [], description: "" }],
    skills: [],
    languages: [],
    certificates: [],
    links: []
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
        properties: {
          school: { type: "string" }, major: { type: "string" }, gpa: { type: "string" },
          start_date: { type: "string" }, end_date: { type: "string" }
        },
        required: ["school", "major", "gpa", "start_date", "end_date"]
      }
    },
    experience: {
      type: "array",
      items: {
        type: "object",
        properties: {
          company: { type: "string" }, role: { type: "string" }, description: { type: "string" },
          start_date: { type: "string" }, end_date: { type: "string" }
        },
        required: ["company", "role", "description", "start_date", "end_date"]
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
    skills: { type: "array", items: { type: "string" } },
    languages: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, level: { type: "string" } },
        required: ["name", "level"]
      }
    },
    certificates: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, issuer: { type: "string" }, year: { type: "string" } },
        required: ["name", "issuer", "year"]
      }
    }
  },
  required: ["personal_info", "summary", "education", "experience", "projects", "skills", "languages", "certificates"]
};

const dateRange = (item: { start_date: string; end_date: string }) =>
  [item.start_date, item.end_date].filter(Boolean).join(" - ");

export function cvDataToText(cv: CvData): string {
  const lines: string[] = [];
  const info = cv.personal_info;
  lines.push([info.name, info.title].filter(Boolean).join(" - "));
  lines.push([info.email, info.phone].filter(Boolean).join(" | "));
  for (const item of cv.links) lines.push([item.label, item.url].filter(Boolean).join(": "));
  if (cv.summary) lines.push("", "MỤC TIÊU NGHỀ NGHIỆP", cv.summary);
  if (cv.education.length) {
    lines.push("", "HỌC VẤN");
    for (const item of cv.education) {
      lines.push([item.school, item.major, item.gpa && `GPA ${item.gpa}`, dateRange(item)].filter(Boolean).join(" - "));
    }
  }
  if (cv.experience.length) {
    lines.push("", "KINH NGHIỆM");
    for (const item of cv.experience) {
      lines.push([item.role, item.company, dateRange(item)].filter(Boolean).join(" - "), item.description);
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
  if (cv.languages.length) {
    lines.push("", "NGOẠI NGỮ");
    for (const item of cv.languages) lines.push([item.name, item.level].filter(Boolean).join(" - "));
  }
  if (cv.certificates.length) {
    lines.push("", "CHỨNG CHỈ");
    for (const item of cv.certificates) lines.push([item.name, item.issuer, item.year].filter(Boolean).join(" - "));
  }
  return lines.filter((line, index, all) => line !== "" || all[index - 1] !== "").join("\n").trim();
}

const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,24}/g;
const separator = "\\)?[ \\u00a0.\\-]?\\(?";
// Vietnamese mobile (0 + 9 digits) and landline (02x + 8 digits) numbers, with or without +84.
const phonePattern = new RegExp(
  `(?<!\\d)\\(?(?:\\+?84${separator}(?:0${separator})?|0${separator})` +
  `(?:[35789](?:${separator}\\d){8}|2(?:${separator}\\d){9})(?!\\d)`,
  "g"
);
// "02.2019-08.2020" has the digits of a phone number but is a date range.
const dateLikePattern = /^0\d[.-](?:\d{2}[.-])?(?:19|20)\d{2}(?!\d)/;
const socialLinkPattern = /(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com|facebook\.com|fb\.com|zalo\.me|t\.me)\/[^\s)\]]+/gi;
const linkPattern = /(?:https?:\/\/|www\.)[^\s)\]]+|(?:linkedin\.com|github\.com|gitlab\.com)\/[^\s)\]]+/gi;

/** Postgres text columns reject NUL, which PDF fonts can emit for glyphs they do not map. */
export function stripNul(value: string): string {
  return value.replace(/\u0000/g, "");
}

export function maskText(value: string): string {
  return value
    .replace(emailPattern, "[MASKED_EMAIL]")
    .replace(socialLinkPattern, "[MASKED_LINK]")
    .replace(phonePattern, (match) => dateLikePattern.test(match) ? match : "[MASKED_PHONE]");
}

export function extractContacts(rawText: string): { email: string; phone: string } {
  return {
    email: rawText.match(emailPattern)?.[0] ?? "",
    phone: rawText.match(phonePattern)?.find((match) => !dateLikePattern.test(match)) ?? ""
  };
}

export function extractLinks(rawText: string): CvData["links"] {
  const urls = [...new Set(rawText.match(linkPattern) ?? [])].map((url) => url.replace(/[.,;]+$/, ""));
  return urls.slice(0, 8).map((url) => ({
    label: /linkedin/i.test(url) ? "LinkedIn" : /github/i.test(url) ? "GitHub" : /gitlab/i.test(url) ? "GitLab" : "Website",
    url: url.slice(0, 300)
  }));
}
