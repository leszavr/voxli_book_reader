function text(node) {
  return (node?.textContent || "").replaceAll(/\s+/g, " ").trim();
}

function elementTagName(node) {
  return (node?.localName || node?.tagName || "").toLowerCase();
}

function findDescendantsByTag(root, tagName) {
  if (!root) return [];
  const expected = String(tagName).toLowerCase();
  const allElements = root.getElementsByTagName("*");
  return Array.from(allElements).filter((element) => elementTagName(element) === expected);
}

function findFirstDescendantByTag(root, tagName) {
  return findDescendantsByTag(root, tagName)[0] || null;
}

function findDirectChildrenByTag(root, tagName) {
  if (!root) return [];
  const expected = String(tagName).toLowerCase();
  return Array.from(root.children || []).filter((element) => elementTagName(element) === expected);
}

function findFirstDirectChildByTag(root, tagName) {
  return findDirectChildrenByTag(root, tagName)[0] || null;
}

import { escapeHtml } from "../utils.js";

function binaryMapFromDoc(doc) {
  const map = new Map();
  findDescendantsByTag(doc, "binary").forEach((binary) => {
    const id = binary.getAttribute("id");
    const rawMime = binary.getAttribute("content-type") || "image/jpeg";
    const safeMime = /^image\/[\w.+-]+$/.test(rawMime) ? rawMime : "image/jpeg";
    const payload = text(binary).replaceAll(/\s+/g, "");
    if (id && payload) {
      map.set(id, `data:${safeMime};base64,${payload}`);
    }
  });
  return map;
}

function extractFb2CoverDataUrl(titleInfoNode, binaryMap) {
  if (!titleInfoNode) return null;
  const coverpage = findFirstDescendantByTag(titleInfoNode, "coverpage");
  if (!coverpage) return null;
  const imageNode = findFirstDescendantByTag(coverpage, "image");
  if (!imageNode) return null;
  const rawHref = hrefForImage(imageNode);
  const imageId = rawHref.startsWith("#") ? rawHref.slice(1) : rawHref;
  return binaryMap.get(imageId) || null;
}

function noteMapFromBody(notesBody) {
  const map = new Map();
  if (!notesBody) return map;

  findDescendantsByTag(notesBody, "section").forEach((section) => {
    const id = section.getAttribute("id");
    if (!id) return;
    const content = findDescendantsByTag(section, "p")
      .map((paragraph) => `<p>${escapeHtml(text(paragraph))}</p>`)
      .join("");
    if (content) {
      map.set(id, content);
    }
  });

  return map;
}

function hrefForImage(node) {
  return node.getAttribute("xlink:href")
    || node.getAttribute("l:href")
    || node.getAttribute("href")
    || "";
}

function renderChildren(node, context) {
  return Array.from(node.childNodes).map((child) => renderNode(child, context)).join("");
}

function renderTitleNode(node, tag) {
  const value = text(node);
  if (!value) return "";
  return tag === "title" ? `<h3>${escapeHtml(value)}</h3>` : `<h4>${escapeHtml(value)}</h4>`;
}

function renderInlineNode(node, tag, context) {
  const wrapped = renderChildren(node, context);
  return tag === "strong" ? `<strong>${wrapped}</strong>` : `<em>${wrapped}</em>`;
}

function renderImageNode(node, context) {
  const rawHref = hrefForImage(node);
  const imageId = rawHref.startsWith("#") ? rawHref.slice(1) : rawHref;
  const dataUrl = context.images.get(imageId);
  return dataUrl ? `<img src="${dataUrl}" alt="" class="book-image"/>` : "";
}

function renderLinkNode(node, context) {
  const href = node.getAttribute("href") || node.getAttribute("xlink:href") || "";
  const body = renderChildren(node, context) || escapeHtml(text(node));

  if (!href.startsWith("#")) {
    return body;
  }

  const noteId = href.slice(1);
  const noteContent = context.notes.get(noteId);
  if (!noteContent) {
    return body;
  }

  context.usedNotes.set(noteId, noteContent);
  return `<sup><a href="#" class="footnote-ref" data-note-id="${escapeHtml(noteId)}">${body}</a></sup>`;
}

const elementRenderers = {
  section: (node, context) => renderChildren(node, context),
  title: (node) => renderTitleNode(node, "title"),
  subtitle: (node) => renderTitleNode(node, "subtitle"),
  p: (node, context) => `<p>${renderChildren(node, context)}</p>`,
  strong: (node, context) => renderInlineNode(node, "strong", context),
  emphasis: (node, context) => renderInlineNode(node, "emphasis", context),
  em: (node, context) => renderInlineNode(node, "em", context),
  i: (node, context) => renderInlineNode(node, "i", context),
  strikethrough: (node, context) => {
    const wrapped = renderChildren(node, context);
    return `<s>${wrapped}</s>`;
  },
  sub: (node, context) => {
    const wrapped = renderChildren(node, context);
    return `<sub>${wrapped}</sub>`;
  },
  sup: (node, context) => {
    const wrapped = renderChildren(node, context);
    return `<sup>${wrapped}</sup>`;
  },
  code: (node, context) => {
    const wrapped = renderChildren(node, context);
    return `<code>${wrapped}</code>`;
  },
  cite: (node, context) => {
    const wrapped = renderChildren(node, context);
    return `<cite>${wrapped}</cite>`;
  },
  "empty-line": () => "<br/>",
  image: (node, context) => renderImageNode(node, context),
  a: (node, context) => renderLinkNode(node, context),
  table: (node, context) => `<table>${renderChildren(node, context)}</table>`,
  tr: (node, context) => `<tr>${renderChildren(node, context)}</tr>`,
  td: (node, context) => `<td>${renderChildren(node, context)}</td>`,
  th: (node, context) => `<th>${renderChildren(node, context)}</th>`,
};

function renderNode(node, context) {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeHtml(node.nodeValue || "");
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const tag = node.tagName.toLowerCase();
  const renderer = elementRenderers[tag];
  return renderer ? renderer(node, context) : renderChildren(node, context);
}

function normalizeTitle(value) {
  return String(value || "").replaceAll(/\s+/g, " ").trim().toLowerCase();
}

function directChildrenByTag(parent, tagName) {
  return findDirectChildrenByTag(parent, tagName);
}

function getDirectChildByTag(parent, tagName) {
  return findFirstDirectChildByTag(parent, tagName);
}

function getSectionTitle(section) {
  const titleNode = getDirectChildByTag(section, "title");
  if (!titleNode) return "";

  const titleParagraphs = directChildrenByTag(titleNode, "p")
    .map((paragraph) => text(paragraph))
    .filter(Boolean);

  if (titleParagraphs.length > 0) {
    return titleParagraphs.join(" ");
  }

  return text(titleNode);
}

function isServiceChapterTitle(title) {
  return /^chapter\s+\d+$/i.test(String(title || "").trim());
}

function isExplicitChapterTitle(title) {
  const normalized = String(title || "").trim();
  return /^(глава|chapter)\s+(\d+|[ivxlcdm]+)\b/i.test(normalized);
}

function chapterTextLength(html) {
  return String(html || "").replaceAll(/<[^>]*>/g, " ").replaceAll(/\s+/g, " ").trim().length;
}

function collectChapterSections(mainBody, bookTitle) {
  const normalizedBookTitle = normalizeTitle(bookTitle);
  const chapters = [];

  function walk(sections) {
    for (const section of sections) {
      const title = getSectionTitle(section);
      const childSections = findDirectChildrenByTag(section, "section");
      const titledChildren = childSections.filter((s) => Boolean(getSectionTitle(s)));

      if (titledChildren.length > 0) {
        // Секция-контейнер (есть озаглавленные дочерние секции) — заходим внутрь
        walk(childSections);
        continue;
      }

      // Листовая секция — берём как главу, если название осмысленное
      if (title && normalizeTitle(title) !== normalizedBookTitle && !isServiceChapterTitle(title)) {
        chapters.push(section);
      }
    }
  }

  walk(findDirectChildrenByTag(mainBody, "section"));
  return chapters;
}

function resolvePartTitle(section, mainBody, bookTitle) {
  const normalizedBookTitle = normalizeTitle(bookTitle);
  let cursor = section?.parentElement || null;

  while (cursor && cursor !== mainBody) {
    if (elementTagName(cursor) === "section") {
      const title = getSectionTitle(cursor);
      const normalized = normalizeTitle(title);
      // Возвращаем первый осмысленный заголовок предка (не название книги, не сама глава)
      if (title && normalized !== normalizedBookTitle && !isExplicitChapterTitle(title) && !isServiceChapterTitle(title)) {
        return title;
      }
    }
    cursor = cursor.parentElement;
  }

  return "";
}

function chapterFromSection(section, index, context) {
  const usedNotes = new Map();
  const localContext = {
    ...context,
    usedNotes,
  };

  const titleText = getSectionTitle(section) || `Chapter ${index + 1}`;
  const body = Array.from(section.childNodes)
    .filter((child) => !(child.nodeType === Node.ELEMENT_NODE && elementTagName(child) === "title"))
    .map((child) => renderNode(child, localContext))
    .join("");

  const footnotes = Array.from(usedNotes.entries()).map(([id, content], noteIndex) => ({
    id,
    label: String(noteIndex + 1),
    content,
  }));

  return {
    chapterNumber: index + 1,
    title: titleText,
    content: `<h2>${escapeHtml(titleText)}</h2>${body}`,
    footnotes,
  };
}

function detectXmlEncoding(buffer) {
  const bytes = new Uint8Array(buffer.slice(0, 4));
  if (bytes[0] === 0xFF && bytes[1] === 0xFE) return "utf-16le";
  if (bytes[0] === 0xFE && bytes[1] === 0xFF) return "utf-16be";
  // Ищем encoding="..." в первых байтах как ASCII
  const head = new TextDecoder("ascii", { fatal: false }).decode(buffer.slice(0, 512));
  const match = /<\?xml[^?]+encoding=["']([^"']+)["']/i.exec(head);
  return match ? match[1].trim() : "utf-8";
}

export async function parseFb2(file) {
  const buffer = await file.arrayBuffer();
  const encoding = detectXmlEncoding(buffer);
  const xml = new TextDecoder(encoding, { fatal: false }).decode(buffer);
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const errorNode = findFirstDescendantByTag(doc, "parsererror");
  if (errorNode) {
    throw new Error("Invalid FB2 file");
  }

  const descriptionNode = findFirstDescendantByTag(doc, "description");
  const titleInfoNode = findFirstDescendantByTag(descriptionNode, "title-info");
  const title = text(findFirstDescendantByTag(titleInfoNode, "book-title")) || file.name;

  const allBodies = findDescendantsByTag(doc, "body");
  const mainBody = allBodies.find((body) => !body.hasAttribute("name")) || allBodies[0] || null;
  if (!mainBody) {
    throw new Error("FB2 main body not found");
  }

  const notesBody = allBodies.find((body) => (body.getAttribute("name") || "").toLowerCase() === "notes") || null;
  const binaryMap = binaryMapFromDoc(doc);
  const context = {
    images: binaryMap,
    notes: noteMapFromBody(notesBody),
  };

  const coverDataUrl = extractFb2CoverDataUrl(titleInfoNode, binaryMap);

  const chapterRoots = collectChapterSections(mainBody, title);

  const rawChapters = chapterRoots
    .filter(Boolean)
    .map((section, index) => ({
      ...chapterFromSection(section, index, context),
      partTitle: resolvePartTitle(section, mainBody, title),
    }));

  const chapters = rawChapters.filter((chapter) => {
    if (!chapter?.title) return false;
    if (isServiceChapterTitle(chapter.title) && rawChapters.length > 1) return false;
    return chapterTextLength(chapter.content) > 40;
  });

  const finalChapters = chapters.length ? chapters : rawChapters;
  if (coverDataUrl && finalChapters[0]) {
    const coverHtml = `<div class="book-cover"><img src="${coverDataUrl}" alt="Cover" class="book-image book-cover-image"/></div>`;
    finalChapters[0].content = coverHtml + finalChapters[0].content;
  }

  return {
    title,
    format: "fb2",
    chapters: finalChapters,
  };
}
