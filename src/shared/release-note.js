
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IroReleaseNote = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Split one line of note text into plain/bold/code runs. */
  function inline(text) {
    const parts = [];
    const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
    let last = 0;
    let match;
    while ((match = re.exec(text)) !== null) {
      if (match.index > last) parts.push({ text: text.slice(last, match.index) });
      const token = match[0];
      if (token.startsWith('**')) parts.push({ text: token.slice(2, -2), bold: true });
      else parts.push({ text: token.slice(1, -1), code: true });
      last = match.index + token.length;
    }
    if (last < text.length) parts.push({ text: text.slice(last) });
    return parts;
  }

  /**
   * @param {string} markdown
   * @returns {Array<{type:'heading'|'paragraph'|'bullet', parts:Array<{text:string,bold?:boolean,code?:boolean}>}>}
   */
  function parse(markdown) {
    const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
    const blocks = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];

      if (/^##\s+Install\b/i.test(line)) break;
      const heading = /^##\s+(.+)$/.exec(line);
      if (heading) {
        blocks.push({ type: 'heading', parts: inline(heading[1].trim()) });
        continue;
      }
      if (/^#\s+/.test(line)) continue;
      const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
      if (bullet) {
        blocks.push({ type: 'bullet', parts: inline(bullet[1].trim()) });
        continue;
      }
      if (!line.trim()) continue;
      const paragraph = [line.trim()];
      while (i + 1 < lines.length && lines[i + 1].trim()
        && !/^##\s+/.test(lines[i + 1])
        && !/^\s*[-*]\s+/.test(lines[i + 1])
        && !/^#\s+/.test(lines[i + 1])) {
        i += 1;
        paragraph.push(lines[i].trim());
      }
      blocks.push({ type: 'paragraph', parts: inline(paragraph.join(' ')) });
    }
    return blocks;
  }

  return { parse, inline };
});
