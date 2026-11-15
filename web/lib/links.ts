/**
 * 把訊息內文切成文字與網址片段。只認 http/https，結尾的標點（含全形）不算進網址。
 */
export type BodyPart = { type: 'text'; value: string } | { type: 'link'; url: string };

const URL_PATTERN = /https?:\/\/[^\s<>"'`，。、；：！？「」『』（）【】]+/gi;
const TRAILING = /[.,;:!?'"\]}>…]+$/;

function trimUrl(candidate: string): string {
  let url = candidate.replace(TRAILING, '');
  // 結尾的「)」只有在網址裡有對應的「(」時才保留（例如維基百科的網址）。
  while (url.endsWith(')') && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) {
    url = url.slice(0, -1).replace(TRAILING, '');
  }
  return url;
}

export function splitLinks(text: string): BodyPart[] {
  const parts: BodyPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    const url = trimUrl(match[0]);
    if (!/^https?:\/\/[^/?#]+\.[^/?#]/i.test(url) && !/^https?:\/\/\[/.test(url)) continue;
    if (start > last) parts.push({ type: 'text', value: text.slice(last, start) });
    parts.push({ type: 'link', url });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
  return parts;
}

/** 訊息裡的網址（去重，最多 `max` 個）。 */
export function extractLinks(text: string, max = 3): string[] {
  const seen: string[] = [];
  for (const part of splitLinks(text)) {
    if (part.type === 'link' && !seen.includes(part.url)) seen.push(part.url);
    if (seen.length >= max) break;
  }
  return seen;
}
