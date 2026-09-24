/** Short announcement markup: escape text and link attributes before insertion. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function label(text: string): string {
  return escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\\\*/g, '*');
}
export function renderInlineNoSpan(text: string): string {
  // Recognize each token once so URLs inside generated anchors cannot be linked twice.
  const tokens = /\[([^\]\r\n]+)\]\((https?:\/\/[^\s<>()]+)\)|`([^`]+)`|(https?:\/\/[^\s<>()]+)|([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
  let out = '', offset = 0;
  for (const match of text.matchAll(tokens)) {
    out += label(text.slice(offset, match.index));
    if (match[2] || match[4]) {
      const url = escapeHtml(match[2] || match[4]);
      out += `<a href="${url}" target="_blank" rel="noopener noreferrer">${label(match[1] || match[4])}</a>`;
    } else if (match[3]) out += `<code>${escapeHtml(match[3])}</code>`;
    else out += `<a href="mailto:${escapeHtml(match[5])}">${escapeHtml(match[5])}</a>`;
    offset = match.index! + match[0].length;
  }
  return out + label(text.slice(offset));
}
