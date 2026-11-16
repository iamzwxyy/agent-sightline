const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

// The two authored page templates use quoted attributes and external scripts.
// Keep code examples and placeholders in their original form.
export function localizeWebsite(html, messages) {
  const translate = value => {
    const text = value.trim();
    if (!/[A-Za-z]/.test(text) || /^v?\{\{[A-Z_]+\}\}$/.test(text)) return value;
    if (!Object.hasOwn(messages, text)) throw new Error(`Missing website translation for ${JSON.stringify(text)}.`);
    return value.replace(text, () => escape(messages[text]));
  };
  let code = 0;
  return html.replace(/<!--[\s\S]*?-->|<[^>]*>|[^<]+/g, token => {
    if (!token.startsWith('<')) return code ? token : translate(token);
    const tag = token.match(/^<(\/?)([a-z][\w-]*)/i);
    if (!tag) return token;
    if (['code', 'pre', 'script', 'style'].includes(tag[2].toLowerCase())) code += tag[1] ? -1 : 1;
    if (tag[1]) return token;
    let result = token.replace(/\b(aria-label|alt|title|placeholder)="([^"]*)"/g, (_match, key, value) => `${key}="${translate(value)}"`);
    if (tag[2].toLowerCase() === 'meta' && /(?:name="description"|property="og:(?:title|description|image:alt)")/.test(token)) {
      result = result.replace(/\bcontent="([^"]*)"/, (_match, value) => `content="${translate(value)}"`);
    }
    return result;
  });
}
