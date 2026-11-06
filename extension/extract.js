function extractJobText() {
  const MAX_LENGTH = 20000;
  const MIN_LENGTH = 50;
  const clean = (value) => value.replace(/[ \t ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim().slice(0, MAX_LENGTH);

  const selected = clean(String(window.getSelection() ?? ""));
  if (selected.length >= MIN_LENGTH) return selected;

  // Job pages usually publish a schema.org JobPosting for search engines.
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.textContent);
      const items = Array.isArray(data) ? data : data["@graph"] ?? [data];
      const posting = items.find((item) => item["@type"] === "JobPosting" && item.description);
      if (posting) {
        const html = new DOMParser().parseFromString(posting.description, "text/html");
        html.querySelectorAll("li").forEach((item) => item.prepend("- "));
        html.querySelectorAll("br, p, div, li, h1, h2, h3, h4, ul, ol").forEach((item) => item.append("\n"));
        return clean([posting.title, html.body.textContent].filter(Boolean).join("\n"));
      }
    } catch {
      // Malformed structured data: fall through to the visible page text.
    }
  }

  return clean((document.querySelector("main, article, [role=main]") ?? document.body).innerText);
}

extractJobText();
