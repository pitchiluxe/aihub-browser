// Builds the injected script that extracts a clean article from the current page.
// Runs INSIDE the page so it has full DOM access. Returns a structured article
// object the renderer can display directly.
//
// The extraction strategy:
//  1. Walk the DOM and score every element by text density (words / element size).
//  2. Keep only elements above a density threshold — this filters out nav, ads,
//     sidebar, footers, cookie banners, and other non-article cruft.
//  3. Rebuild the content as a simplified HTML fragment (headings, paragraphs,
//     lists, blockquotes, figures with captions, code blocks).
//  4. Strip all scripts, styles, event handlers, and external resource loading.
//  5. Pick a hero image from og:image or the article's first large image.

export interface ReaderArticle {
  title: string
  byline: string
  dir: 'ltr' | 'rtl'
  siteName: string
  content: string    // sanitized HTML for rendering
  textContent: string
  length: number
  excerpt: string
  heroImage: string
  readingMinutes: number
}

export const EMPTY_ARTICLE: ReaderArticle = {
  title: '',
  byline: '',
  dir: 'ltr',
  siteName: '',
  content: '',
  textContent: '',
  length: 0,
  excerpt: '',
  heroImage: '',
  readingMinutes: 0,
}

// The injected script. Returns a JSON-compatible object synchronously.
// We build it as a string so the main process can pipe it through
// ipcRenderer.invoke → webContents.executeJavaScript.
export function buildReaderScript(): string {
  return `(function () {
  // ── Helpers ──────────────────────────────────────────────────────────────────
  function textOf(node) {
    if (!node) return '';
    if (node.nodeType === 3) return (node.textContent || '').trim();
    if (node.nodeType !== 1) return '';
    // Skip hidden elements
    var style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return '';
    return (node.textContent || '').trim();
  }

  function wordCount(str) {
    return (str.match(/\\S+/g) || []).length;
  }

  // Score an element by how "article-like" it is. Higher = more likely to be content.
  // Factors: text density, presence of <article>, text length, semantic elements.
  function scoreElement(el) {
    var tag = el.tagName || '';
    var score = 0;
    var text = textOf(el);
    var wc = wordCount(text);

    // Semantic boost
    if (tag === 'ARTICLE')   score += 40;
    if (tag === 'MAIN')      score += 25;
    if (['SECTION', 'DIV'].indexOf(tag) !== -1 && el.getAttribute('role') === 'main') score += 25;
    if (el.className && /\\b(post|article|content|entry|body|text|story|hentry)\\b/i.test(el.className)) score += 20;
    if (el.id && /\\b(post|article|content|entry|body|text|story|hentry)\\b/i.test(el.id)) score += 25;

    // Penalize obvious non-content
    if (el.className && /\\b(nav|menu|sidebar|footer|header|comment|social|share|related|ad-|advert|promo|cookie|banner|popup|modal|overlay)\\b/i.test(el.className)) score -= 50;
    if (el.id && /\\b(nav|menu|sidebar|footer|header|comment|social|share|related|ad-|advert|promo|cookie|banner|popup|modal|overlay)\\b/i.test(el.id)) score -= 50;

    // Text density: words / (character count + 1) — higher = denser prose
    var charLen = (el.textContent || '').length;
    if (charLen > 50) score += Math.min(30, wc * 0.4);

    // Penalize very short elements (likely UI, not content)
    if (wc < 25) score -= 10;

    return score;
  }

  // Deep-clone the document so our mutations don't affect the live page.
  var doc = document.cloneNode(true);

  // ── Title ────────────────────────────────────────────────────────────────────
  var title =
    (doc.querySelector('meta[property="og:title"]') || {}).content ||
    (doc.querySelector('meta[name="twitter:title"]') || {}).content ||
    (doc.querySelector('h1') || {}).textContent ||
    doc.title ||
    '';

  // ── Byline ──────────────────────────────────────────────────────────────────
  var byline =
    (doc.querySelector('meta[name="author"]') || {}).content ||
    (doc.querySelector('meta[name="dc.creator"]') || {}).content ||
    (doc.querySelector('[rel="author"]') || {}).textContent ||
    (doc.querySelector('.author, .byline, [itemprop="author"]') || {}).textContent ||
    '';

  // ── Direction ───────────────────────────────────────────────────────────────
  var dir = (doc.querySelector('html') || {}).dir || 'ltr';
  if (dir !== 'rtl' && dir !== 'ltr') dir = 'ltr';

  // ── Site name ────────────────────────────────────────────────────────────────
  var siteName =
    (doc.querySelector('meta[property="og:site_name"]') || {}).content ||
    location.hostname.replace(/^www\\./, '');

  // ── Excerpt ──────────────────────────────────────────────────────────────────
  var excerpt =
    (doc.querySelector('meta[property="og:description"]') || {}).content ||
    (doc.querySelector('meta[name="description"]') || {}).content ||
    '';

  // ── Hero image ───────────────────────────────────────────────────────────────
  var hero =
    (document.querySelector('meta[property="og:image"]') || {}).content ||
    (document.querySelector('meta[name="twitter:image"]') || {}).content ||
    '';

  // ── Content extraction ───────────────────────────────────────────────────────
  // Walk all elements, score them, pick the highest-scoring block as the article body.
  var candidates = [];
  var allEls = doc.querySelectorAll('p, div, section, article, main, span, td');
  for (var i = 0; i < allEls.length; i++) {
    var el = allEls[i];
    if (el.closest('script, style, noscript, iframe, nav, header, footer, aside, .ad, .ads, .advert, .social-share, .comments, .related, .sidebar, .menu')) continue;
    var s = scoreElement(el);
    if (s > 5) candidates.push({ el: el, score: s });
  }
  candidates.sort(function (a, b) { return b.score - a.score; });

  // The article container: the top candidate or the body fallback.
  var articleEl = candidates.length ? candidates[0].el : doc.body;
  if (!articleEl) return JSON.stringify({ error: 'no content found' });

  // Collect paragraphs from the article (and siblings that also score well).
  var paragraphs = [];
  var seenTexts = new Set();

  function collectFrom(el) {
    if (!el) return;
    var children = el.children;
    for (var j = 0; j < children.length; j++) {
      var child = children[j];
      var tag = child.tagName || '';
      var text = textOf(child);
      if (!text) { collectFrom(child); continue; }

      // Skip short non-semantic text (likely nav items, buttons, labels)
      if (wordCount(text) < 10 && ['P', 'DIV', 'SPAN'].indexOf(tag) !== -1) {
        collectFrom(child);
        continue;
      }

      // Deduplicate repeated paragraphs (common on multi-page articles)
      var hash = text.slice(0, 60).replace(/\\s+/g, ' ');
      if (seenTexts.has(hash)) { collectFrom(child); continue; }
      seenTexts.add(hash);

      // Semantic wrapping
      if (tag === 'H1') {
        paragraphs.push('<h1>' + text + '</h1>');
      } else if (tag === 'H2') {
        paragraphs.push('<h2>' + text + '</h2>');
      } else if (tag === 'H3') {
        paragraphs.push('<h3>' + text + '</h3>');
      } else if (tag === 'H4' || tag === 'H5' || tag === 'H6') {
        paragraphs.push('<h4>' + text + '</h4>');
      } else if (tag === 'BLOCKQUOTE') {
        var cite = child.querySelector('cite');
        var citeText = cite ? '<cite>' + textOf(cite) + '</cite>' : '';
        paragraphs.push('<blockquote>' + text + citeText + '</blockquote>');
      } else if (tag === 'PRE' || tag === 'CODE') {
        var lang = '';
        var cls = child.className || '';
        var m = /language-(\\w+)/.exec(cls) || /lang-(\\w+)/.exec(cls);
        if (m) lang = ' data-lang="' + m[1] + '"';
        paragraphs.push('<pre' + lang + '>' + (child.textContent || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</pre>');
      } else if (tag === 'FIGURE') {
        var img = child.querySelector('img');
        var figcap = child.querySelector('figcaption');
        var capText = figcap ? '<figcaption>' + textOf(figcap) + '</figcaption>' : '';
        var src = img ? (img.src || img.dataset.src || '') : '';
        if (src && !/\\b(spinner|placeholder|avatar|logo|icon|1x\\.png|blank\\.gif)\\b/i.test(src)) {
          paragraphs.push('<figure><img src="' + src + '" alt="' + (img.alt || textOf(figcap) || title) + '" />' + capText + '</figure>');
        } else {
          paragraphs.push('<p>' + text + '</p>');
        }
      } else if (tag === 'IMG') {
        var src2 = child.src || child.dataset.src || '';
        if (src2 && !/\\b(spinner|placeholder|avatar|logo|icon|1x\\.png|blank\\.gif)\\b/i.test(src2)) {
          paragraphs.push('<p><img src="' + src2 + '" alt="' + (child.alt || title) + '" /></p>');
        }
      } else if (tag === 'UL' || tag === 'OL') {
        var items = [];
        var lis = child.querySelectorAll('li');
        for (var k = 0; k < lis.length; k++) {
          var lit = lis[k];
          if (wordCount(textOf(lit)) > 2) items.push('<li>' + textOf(lit) + '</li>');
        }
        if (items.length > 0) paragraphs.push('<' + tag + '>' + items.join('') + '</' + tag + '>');
      } else if (tag === 'TABLE') {
        // Basic table — only if it doesn't look like a nav or calendar
        if (!/\\b(calendar|schedule|nav|menu)\\b/i.test(child.className || '')) {
          paragraphs.push('<div class="table-wrapper"><table>' + child.innerHTML + '</table></div>');
        }
      } else if (['SECTION', 'ARTICLE', 'DIV'].indexOf(tag) !== -1 && wordCount(text) > 40) {
        // Recurse into major content blocks
        collectFrom(child);
      } else if (tag === 'BR') {
        // ignore
      } else {
        paragraphs.push('<p>' + text + '</p>');
      }
    }
  }

  collectFrom(articleEl);

  // ── Sanitize HTML ────────────────────────────────────────────────────────────
  // Remove any remaining dangerous or unwanted elements from the collected HTML.
  var tempDiv = doc.createElement('div');
  tempDiv.innerHTML = paragraphs.join('\\n');

  // Remove dangerous elements
  var dangerous = tempDiv.querySelectorAll('script, style, noscript, iframe, embed, object, form, input, button, select, textarea, link, meta');
  for (var di = 0; di < dangerous.length; di++) dangerous[di].remove();

  // Remove event handlers and javascript: links
  var allWithHandlers = tempDiv.querySelectorAll('*');
  for (var hi = 0; hi < allWithHandlers.length; hi++) {
    var el2 = allWithHandlers[hi];
    // Remove all event attributes
    var attrs = Array.from(el2.attributes || []);
    for (var ai = 0; ai < attrs.length; ai++) {
      if (attrs[ai].name.startsWith('on')) el2.removeAttribute(attrs[ai].name);
    }
    // Downgrade links to prevent navigation
    if (el2.tagName === 'A') {
      el2.setAttribute('href', '#');
      el2.addEventListener('click', function (e) { e.preventDefault(); });
    }
    // Remove background images (often ad backgrounds)
    if (el2.tagName === 'IMG') {
      el2.removeAttribute('srcset');
      el2.removeAttribute('sizes');
    }
  }

  var cleanContent = tempDiv.innerHTML;
  var textContent = tempDiv.textContent || '';

  // ── Re-pick hero from content if still missing ───────────────────────────────
  if (!hero) {
    var contentImg = tempDiv.querySelector('img');
    if (contentImg) hero = contentImg.src || '';
  }

  // ── Validate result ──────────────────────────────────────────────────────────
  if (!textContent || textContent.length < 280) {
    return JSON.stringify({ error: 'page has no readable article content' });
  }

  var words = wordCount(textContent);
  var mins = Math.max(1, Math.round(words / 250));

  return JSON.stringify({
    title: title.trim(),
    byline: byline.trim(),
    dir: dir,
    siteName: siteName,
    content: cleanContent,
    textContent: textContent.trim().slice(0, 50000),
    length: textContent.length,
    excerpt: excerpt.trim(),
    heroImage: hero,
    readingMinutes: mins,
  });
})()`
}
