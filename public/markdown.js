'use strict';

(function attachNodeAIMarkdown(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NodeAIMarkdown = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createNodeAIMarkdown() {
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  
  function highlightCode(value, language) {
    const source = String(value);
    const normalizedLanguage = String(language || '').toLowerCase();
    const supportedLanguage = /^(js|jsx|javascript|ts|tsx|typescript|py|python|json|sql|java|go|css|html|sh|bash|)$/i.test(normalizedLanguage);
    if (!supportedLanguage) return escapeHtml(source);

    const tokenPattern = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\x60(?:\\.|[^\x60\\])*\x60|\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|\b\d+(?:\.\d+)?\b|\b(?:const|let|var|function|return|if|else|for|while|try|catch|throw|new|class|extends|async|await|import|from|export|default|def|elif|in|None|True|False|true|false|null|undefined|SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AS|GROUP|ORDER|BY|HAVING|LIMIT|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|PRIMARY|KEY|NOT|NULL|AND|OR|IS|DISTINCT|WITH|CASE|WHEN|THEN|END)\b)/gi;
    let result = '';
    let lastIndex = 0;
    for (const match of source.matchAll(tokenPattern)) {
      const token = match[0];
      const index = match.index;
      result += escapeHtml(source.slice(lastIndex, index));
      let className;
      if (/^(?:'|")/.test(token) || token.startsWith(String.fromCharCode(96))) className = 'token-string';
      else if (/^(?:\/\/|#|\/\*)/.test(token)) className = 'token-comment';
      else if (/^\d/.test(token)) className = 'token-number';
      else className = 'token-keyword';
      result += '<span class="' + className + '">' + escapeHtml(token) + '</span>';
      lastIndex = index + token.length;
    }
    return result + escapeHtml(source.slice(lastIndex));
  }
  
  function renderInlineMarkdown(value) {
    let text = escapeHtml(value);
    const codeTokens = [];
    text = text.replace(/\x60([^\x60\n]+)\x60/g, (_match, code) => {
      const token = '@@NODEAI_CODE_' + codeTokens.length + '@@';
      codeTokens.push('<code>' + code + '</code>');
      return token;
    });
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, (_match, label, href) => {
      const normalized = href.replace(/&amp;/g, '&');
      if (!/^(https?:\/\/|mailto:)/i.test(normalized)) return label;
      return '<a href="' + escapeHtml(normalized) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
    });
    text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    codeTokens.forEach((code, index) => {
      text = text.replace('@@NODEAI_CODE_' + index + '@@', code);
    });
    return text;
  }
  
  function renderMarkdown(markdown) {
    const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
    const output = [];
    let paragraph = [];
    let listKind = '';
    let inCode = false;
    let codeLanguage = '';
    let codeLines = [];
    let quoteLines = [];
  
    const flushParagraph = () => {
      if (paragraph.length) {
        output.push('<p>' + paragraph.map(renderInlineMarkdown).join('<br>') + '</p>');
        paragraph = [];
      }
    };
    const closeList = () => {
      if (listKind) { output.push('</' + listKind + '>'); listKind = ''; }
    };
    const flushQuote = () => {
      if (quoteLines.length) {
        flushParagraph();
        closeList();
        output.push('<blockquote>' + renderMarkdown(quoteLines.join('\n')) + '</blockquote>');
        quoteLines = [];
      }
    };
    const closeFencedCode = () => {
      const language = escapeHtml(codeLanguage);
      const code = highlightCode(codeLines.join('\n'), codeLanguage);
      output.push('<div class="markdown-code-block"><div class="markdown-code-toolbar"><span>' + (language || 'CODE') + '</span><button type="button" data-copy-code>Copy code</button></div><pre><code>' + code + '</code></pre></div>');
      codeLines = [];
      codeLanguage = '';
      inCode = false;
    };
    const headingMatch = (line) => line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    const splitCells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
    const tableSeparator = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;
  
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const fence = line.match(/^\s*\x60{3}\s*([A-Za-z0-9_+.#-]{0,32}).*$/);
      if (inCode) {
        if (fence) closeFencedCode();
        else codeLines.push(line);
        continue;
      }
      if (fence) {
        flushParagraph(); flushQuote(); closeList();
        inCode = true; codeLanguage = fence[1] || ''; codeLines = [];
        continue;
      }
      const quote = line.match(/^\s*>\s?(.*)$/);
      if (quote) { flushParagraph(); closeList(); quoteLines.push(quote[1]); continue; }
      if (quoteLines.length) flushQuote();
  
      if (!line.trim()) { flushParagraph(); closeList(); continue; }
      const heading = headingMatch(line);
      if (heading) {
        flushParagraph(); closeList();
        const level = heading[1].length;
        output.push('<h' + level + '>' + renderInlineMarkdown(heading[2]) + '</h' + level + '>');
        continue;
      }
      if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) {
        flushParagraph(); closeList(); output.push('<hr>'); continue;
      }
  
      const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
      const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (unordered || ordered) {
        flushParagraph();
        const nextKind = unordered ? 'ul' : 'ol';
        if (listKind && listKind !== nextKind) closeList();
        if (!listKind) { listKind = nextKind; output.push('<' + listKind + '>'); }
        output.push('<li>' + renderInlineMarkdown((unordered || ordered)[1]) + '</li>');
        continue;
      }
      closeList();
  
      if (line.includes('|') && tableSeparator.test(lines[index + 1] || '')) {
        flushParagraph();
        const headers = splitCells(line);
        index += 2;
        const tableRows = [];
        while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
          tableRows.push(splitCells(lines[index]));
          index++;
        }
        index--;
        const header = '<thead><tr>' + headers.map((cell) => '<th>' + renderInlineMarkdown(cell) + '</th>').join('') + '</tr></thead>';
        const body = tableRows.map((row) => '<tr>' + headers.map((_cell, cellIndex) => '<td>' + renderInlineMarkdown(row[cellIndex] || '') + '</td>').join('') + '</tr>').join('');
        output.push('<div class="markdown-table-wrap"><table>' + header + '<tbody>' + body + '</tbody></table></div>');
        continue;
      }
      paragraph.push(line);
    }
    if (inCode) closeFencedCode();
    flushQuote();
    flushParagraph();
    closeList();
    return output.join('\n');
  }

  function calculateAnswerStats(answer) {
    const value = String(answer || '');
    const trimmed = value.trim();
    const words = trimmed ? trimmed.split(/\s+/).length : 0;
    const lines = value ? value.split(/\r\n|\r|\n/).length : 0;
    const fences = (value.match(/^\s*```/gm) || []).length;
    return {
      words,
      characters: value.length,
      lines,
      codeBlocks: Math.floor(fences / 2)
    };
  }

  return { renderMarkdown, calculateAnswerStats };
});
