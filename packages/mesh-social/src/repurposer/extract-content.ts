export interface ExtractedContent {
  text: string;
  title?: string;
  sourceUrl?: string;
}

export async function extractContent(source: string | URL): Promise<ExtractedContent> {
  if (source instanceof URL || (typeof source === "string" && source.startsWith("http"))) {
    const url = source instanceof URL ? source : new URL(source);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    const html = await res.text();
    const text = stripHtml(html);
    const title = extractTitle(html);
    return { text, title, sourceUrl: url.toString() };
  }
  return { text: source };
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html: string): string | undefined {
  const match = /<title[^>]*>(.*?)<\/title>/i.exec(html);
  return match?.[1]?.trim();
}
