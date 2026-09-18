function normalizePath(basePath, relativePath) {
  const baseParts = basePath.split("/").slice(0, -1);
  const relParts = relativePath.split("/");
  const stack = [...baseParts];

  relParts.forEach((part) => {
    if (!part || part === ".") return;
    if (part === "..") {
      stack.pop();
      return;
    }
    stack.push(part);
  });

  return stack.join("/");
}

function stripFragmentAndQuery(path) {
  return path.split("#")[0].split("?")[0];
}

function mimeTypeFromPath(path) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

// namespace-safe helpers для XML-документов (OPF, container.xml)
// querySelector/querySelectorAll не работают с namespace в XML-документах в браузере
function xmlLocalName(el) {
  return (el.localName || el.tagName || "").toLowerCase();
}

function xmlFindFirst(root, tagName) {
  const lower = tagName.toLowerCase();
  const all = root.getElementsByTagName("*");
  for (const el of all) {
    if (xmlLocalName(el) === lower) return el;
  }
  return null;
}

function xmlFindAll(root, tagName) {
  const lower = tagName.toLowerCase();
  return Array.from(root.getElementsByTagName("*")).filter((el) => xmlLocalName(el) === lower);
}

function isSelectorError(error) {
  return error?.name === "SyntaxError";
}

function querySelectorSafely(doc, selector) {
  try {
    return doc.querySelector(selector);
  } catch (error) {
    if (isSelectorError(error)) return null;
    throw error;
  }
}

function getNodeText(doc, selectors) {
  for (const selector of selectors) {
    const node = querySelectorSafely(doc, selector);
    if (node?.textContent?.trim()) return node.textContent.trim();
  }
  return "";
}

function plainTextLengthFromHtml(rawHtml) {
  return String(rawHtml || "")
    .replaceAll(/<[^>]*>/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim()
    .length;
}

async function inlineImages(doc, zip, chapterPath) {
  // Обычные <img src="...">
  const images = Array.from(doc.querySelectorAll("img[src]"));
  for (const image of images) {
    const src = image.getAttribute("src");
    if (!src || src.startsWith("data:") || src.startsWith("http")) continue;

    const clean = stripFragmentAndQuery(src);
    const imagePath = normalizePath(chapterPath, clean);
    const imageFile = zip.file(imagePath);
    if (!imageFile) continue;

    const base64 = await imageFile.async("base64");
    const mime = mimeTypeFromPath(imagePath);
    image.setAttribute("src", `data:${mime};base64,${base64}`);
    image.classList.add("book-image");
  }

  // SVG <image href="..."> / <image xlink:href="..."> внутри SVG-блоков
  const svgImages = Array.from(doc.querySelectorAll("image"));
  for (const image of svgImages) {
    const src = image.getAttribute("href") || image.getAttribute("xlink:href") || "";
    if (!src || src.startsWith("data:") || src.startsWith("http")) continue;

    const clean = stripFragmentAndQuery(src);
    const imagePath = normalizePath(chapterPath, clean);
    const imageFile = zip.file(imagePath);
    if (!imageFile) continue;

    const base64 = await imageFile.async("base64");
    const mime = mimeTypeFromPath(imagePath);
    image.setAttribute("href", `data:${mime};base64,${base64}`);
    image.removeAttribute("xlink:href");
    image.classList.add("book-image");
  }
}

function findCoverManifestItem(opfDoc, manifestMap) {
  // OPF3: <item properties="cover-image" .../>
  const items = xmlFindAll(opfDoc, "item");
  for (const item of items) {
    const props = (item.getAttribute("properties") || "").split(/\s+/);
    if (props.includes("cover-image")) {
      const id = item.getAttribute("id");
      const found = manifestMap.get(id);
      if (found) return found;
    }
  }

  // OPF2: <meta name="cover" content="image-id"/>
  const metas = xmlFindAll(opfDoc, "meta");
  for (const meta of metas) {
    if ((meta.getAttribute("name") || "").toLowerCase() === "cover") {
      const id = meta.getAttribute("content") || "";
      const found = manifestMap.get(id);
      if (found) return found;
    }
  }

  return null;
}

async function extractEpubCoverDataUrl(opfDoc, manifestMap, opfPath, zip) {
  const coverItem = findCoverManifestItem(opfDoc, manifestMap);
  if (!coverItem) return null;

  const coverPath = normalizePath(opfPath, coverItem.href);
  const coverFile = zip.file(coverPath);
  if (!coverFile) return null;

  const base64 = await coverFile.async("base64");
  const mime = coverItem.mediaType || mimeTypeFromPath(coverPath);
  return `data:${mime};base64,${base64}`;
}

import { escapeHtml } from "../utils.js";

const MIN_CHAPTER_CHARS = 100;

function collectFootnotesFromEl(rootEl) {
  const allWithId = new Map();
  rootEl.querySelectorAll("[id]").forEach((el) => {
    const id = el.getAttribute("id");
    if (!id) return;
    const cn = (el.className?.toLowerCase() || "");
    const isNote = cn.includes("note") || cn.includes("footnote") || el.tagName.toLowerCase() === "aside";
    if (isNote) allWithId.set(id, el.innerHTML || el.textContent || "");
  });

  const used = [];
  rootEl.querySelectorAll("a[href^='#']").forEach((anchor) => {
    const href = anchor.getAttribute("href");
    if (!href) return;
    const targetId = href.slice(1);
    const noteHtml = allWithId.get(targetId);
    if (!noteHtml) return;
    anchor.classList.add("footnote-ref");
    anchor.dataset.noteId = targetId;
    if (!used.some((note) => note.id === targetId)) {
      used.push({ id: targetId, label: String(used.length + 1), content: `<p>${noteHtml}</p>` });
    }
  });

  return used;
}

// namespace-safe helpers для toc.ncx
function ncxLocalName(el) {
  return (el.localName || el.tagName || "").toLowerCase();
}

function ncxDirectChildren(el, name) {
  return Array.from(el.children || []).filter((c) => ncxLocalName(c) === name);
}

function parseNcxNavMap(tocDoc) {
  let navMap = null;
  const all = tocDoc.getElementsByTagName("*");
  for (const el of all) {
    if (ncxLocalName(el) === "navmap") { navMap = el; break; }
  }
  if (!navMap) return [];

  function parseNavPoint(np) {
    const labelEl = ncxDirectChildren(np, "navlabel")[0];
    const textEl = labelEl ? ncxDirectChildren(labelEl, "text")[0] : null;
    const label = textEl?.textContent?.trim() || "";

    const contentEl = ncxDirectChildren(np, "content")[0];
    const src = contentEl?.getAttribute("src") || "";
    const hashIdx = src.indexOf("#");
    const navFile = hashIdx >= 0 ? src.slice(0, hashIdx) : src;
    const fragment = hashIdx >= 0 ? src.slice(hashIdx + 1) : null;

    const children = ncxDirectChildren(np, "navpoint").map(parseNavPoint);
    return { label, navFile, fragment, children };
  }

  return ncxDirectChildren(navMap, "navpoint").map(parseNavPoint);
}

// EPUB3 nav.xhtml parser
function parseNavXhtml(navDoc) {
  const tocNav = navDoc.querySelector('nav[epub\\:type="toc"], nav#toc');
  if (!tocNav) return [];

  function parseOl(ol, depth = 0) {
    const items = [];
    const lis = ol?.querySelectorAll(":scope > li") || [];
    for (const li of lis) {
      const anchor = li.querySelector(":scope > a, :scope > span");
      if (!anchor) continue;
      const label = anchor.textContent?.trim() || "";
      const href = anchor.getAttribute("href") || "";
      const hashIdx = href.indexOf("#");
      const navFile = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
      const fragment = hashIdx >= 0 ? href.slice(hashIdx + 1) : null;

      const childOl = li.querySelector(":scope > ol");
      const children = childOl ? parseOl(childOl, depth + 1) : [];
      items.push({ label, navFile, fragment, children });
    }
    return items;
  }

  const rootOl = tocNav.querySelector(":scope > ol");
  return parseOl(rootOl, 0);
}

function flattenNavTree(navPoints, partTitle = "") {
  const result = [];
  for (const np of navPoints) {
    if (np.children.length > 0) {
      result.push(...flattenNavTree(np.children, np.label));
    } else {
      result.push({ label: np.label, navFile: np.navFile, fragment: np.fragment, partTitle });
    }
  }
  return result;
}

async function readXmlDocFromZip(zip, filePath, missingError) {
  const xmlFile = zip.file(filePath);
  if (!xmlFile) throw new Error(missingError);
  const xml = await xmlFile.async("string");
  return new DOMParser().parseFromString(xml, "application/xml");
}

// В XHTML самозакрывающийся <title/> (и аналоги) без </title> заставляет HTML5-парсер
// "съедать" всё содержимое файла до закрывающего тега, который так и не найдётся.
// Итог: document.body оказывается пустым. Фикс: делаем явные закрывающие теги.
function prepareXhtmlAsHtml(source) {
  return source.replaceAll(/<(title|script|style|textarea)(\s[^>]*)?\s*\/>/gi, "<$1$2></$1>");
}

async function readHtmlDocFromZip(zip, filePath) {
  const htmlFile = zip.file(filePath);
  if (!htmlFile) return null;
  let html = await htmlFile.async("string");
  if (filePath.toLowerCase().endsWith(".xhtml")) {
    html = prepareXhtmlAsHtml(html);
  }
  return new DOMParser().parseFromString(html, "text/html");
}

async function resolveOpfPath(zip) {
  const containerDoc = await readXmlDocFromZip(zip, "META-INF/container.xml", "Invalid EPUB: container.xml not found");
  const opfPath = xmlFindFirst(containerDoc, "rootfile")?.getAttribute("full-path");
  if (!opfPath) throw new Error("Invalid EPUB: OPF path not found");
  return opfPath;
}

function getBookTitle(opfDoc, fallbackTitle) {
  // dc:title имеет localName "title" — используем namespace-safe поиск
  return xmlFindFirst(opfDoc, "title")?.textContent?.trim() || fallbackTitle;
}

function buildManifestMap(opfDoc) {
  const manifestMap = new Map();
  xmlFindAll(opfDoc, "item").forEach((item) => {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    const mediaType = item.getAttribute("media-type") || "";
    const properties = item.getAttribute("properties") || "";
    if (id && href) manifestMap.set(id, { href, mediaType, properties });
  });
  return manifestMap;
}

function buildSpineRefs(opfDoc) {
  return xmlFindAll(opfDoc, "itemref")
    .map((itemref) => itemref.getAttribute("idref"))
    .filter(Boolean);
}

function resolveTocPath(opfDoc, manifestMap, opfPath) {
  // EPUB2: spine toc attribute
  const tocIdRef = xmlFindFirst(opfDoc, "spine")?.getAttribute("toc");
  if (tocIdRef) {
    const tocHref = manifestMap.get(tocIdRef)?.href;
    if (tocHref) return normalizePath(opfPath, tocHref);
  }

  // EPUB3: find nav item in manifest
  const navItem = Array.from(manifestMap.values()).find((item) => {
    // Check for nav property or nav.xhtml/html filename
    const props = (item.properties || "").toLowerCase();
    const href = item.href.toLowerCase();
    return props.includes("nav") || href === "nav.xhtml" || href === "nav.html";
  });
  if (navItem) return normalizePath(opfPath, navItem.href);

  return null;
}

async function getOrLoadChapterDoc(fileDocCache, zip, chapterPath) {
  if (fileDocCache.has(chapterPath)) {
    return fileDocCache.get(chapterPath) || null;
  }

  const doc = await readHtmlDocFromZip(zip, chapterPath);
  if (!doc) return null;

  await inlineImages(doc, zip, chapterPath);
  fileDocCache.set(chapterPath, doc);
  return doc;
}

async function chapterFromNavItem(navItem, chapterNumber, fileDocCache, zip, opfPath) {
  const { label, navFile, fragment, partTitle } = navItem;
  if (!navFile) return null;

  const chapterPath = normalizePath(opfPath, navFile);
  const doc = await getOrLoadChapterDoc(fileDocCache, zip, chapterPath);
  if (!doc) return null;

  const contentEl = (fragment ? doc.getElementById(fragment) : null) ?? doc.body;
  if (!contentEl) return null;

  const footnotes = collectFootnotesFromEl(contentEl);
  const rawHtml = contentEl.innerHTML || "";
  if (plainTextLengthFromHtml(rawHtml) < MIN_CHAPTER_CHARS) return null;

  const chapterTitle = label || `Chapter ${chapterNumber}`;
  return {
    chapterNumber,
    title: chapterTitle,
    content: `<h2>${escapeHtml(chapterTitle)}</h2>${rawHtml}`,
    footnotes,
    partTitle,
  };
}

async function parseTocDrivenChapters(zip, opfPath, tocPath) {
  if (!tocPath) return [];

  const tocFile = zip.file(tocPath);
  if (!tocFile) return [];

  const tocXml = await tocFile.async("string");
  let navItems = [];

  // Determine if it's NCX (EPUB2) or Nav XHTML (EPUB3)
  const isNavXhtml = tocPath.toLowerCase().endsWith(".xhtml") || tocPath.toLowerCase().endsWith(".html");
  
  if (isNavXhtml) {
    // EPUB3: parse nav.xhtml
    const navDoc = new DOMParser().parseFromString(tocXml, "text/html");
    navItems = flattenNavTree(parseNavXhtml(navDoc));
  } else {
    // EPUB2: parse toc.ncx
    const tocDoc = new DOMParser().parseFromString(tocXml, "application/xml");
    navItems = flattenNavTree(parseNcxNavMap(tocDoc));
  }

  if (navItems.length === 0) return [];

  const chapters = [];
  const fileDocCache = new Map();

  for (const navItem of navItems) {
    const chapter = await chapterFromNavItem(navItem, chapters.length + 1, fileDocCache, zip, opfPath);
    if (chapter) chapters.push(chapter);
  }

  return chapters;
}

function isHtmlManifestItem(manifestItem) {
  return (
    manifestItem.mediaType.includes("html")
    || manifestItem.href.endsWith(".xhtml")
    || manifestItem.href.endsWith(".html")
  );
}

async function parseSpineFallbackChapters(zip, opfPath, manifestMap, spineRefs) {
  const chapters = [];

  for (const idref of spineRefs) {
    const manifestItem = manifestMap.get(idref);
    if (!manifestItem || !isHtmlManifestItem(manifestItem)) continue;

    const chapterPath = normalizePath(opfPath, manifestItem.href);
    const chapterDoc = await readHtmlDocFromZip(zip, chapterPath);
    if (!chapterDoc) continue;

    const chapterNumber = chapters.length + 1;
    const chapterTitle = getNodeText(chapterDoc, ["h1", "h2", "h3"]) || `Chapter ${chapterNumber}`;
    await inlineImages(chapterDoc, zip, chapterPath);

    const rawHtml = chapterDoc.body?.innerHTML || "";
    if (plainTextLengthFromHtml(rawHtml) < MIN_CHAPTER_CHARS) continue;

    chapters.push({
      chapterNumber,
      title: chapterTitle,
      content: `<h2>${escapeHtml(chapterTitle)}</h2>${rawHtml}`,
      footnotes: collectFootnotesFromEl(chapterDoc.body ?? chapterDoc),
    });
  }

  return chapters;
}

export async function parseEpub(file) {
  if (!globalThis.JSZip) {
    throw new Error("EPUB parser dependency missing");
  }

  const zip = await globalThis.JSZip.loadAsync(await file.arrayBuffer());
  const opfPath = await resolveOpfPath(zip);
  const opfDoc = await readXmlDocFromZip(zip, opfPath, "Invalid EPUB: OPF file missing");
  const title = getBookTitle(opfDoc, file.name);
  const manifestMap = buildManifestMap(opfDoc);
  const tocPath = resolveTocPath(opfDoc, manifestMap, opfPath);

  const coverDataUrl = await extractEpubCoverDataUrl(opfDoc, manifestMap, opfPath, zip);
  const coverHtml = coverDataUrl
    ? `<div class="book-cover"><img src="${coverDataUrl}" alt="Cover" class="book-image book-cover-image"/></div>`
    : "";

  const tocChapters = await parseTocDrivenChapters(zip, opfPath, tocPath);
  if (tocChapters.length > 0) {
    if (coverHtml && tocChapters[0]) {
      tocChapters[0].content = coverHtml + tocChapters[0].content;
    }
    return { title, format: "epub", chapters: tocChapters };
  }

  const spineRefs = buildSpineRefs(opfDoc);
  const spineChapters = await parseSpineFallbackChapters(zip, opfPath, manifestMap, spineRefs);
  if (!spineChapters.length) throw new Error("epubNoChapters");

  if (coverHtml && spineChapters[0]) {
    spineChapters[0].content = coverHtml + spineChapters[0].content;
  }
  return { title, format: "epub", chapters: spineChapters };
}
