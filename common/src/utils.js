// Общие утилиты, используемые в нескольких модулях

export function escapeHtml(raw) {
  return String(raw)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isDangerousUrl(value) {
  const normalized = String(value || "")
    .trim()
    .replaceAll(/[\u0000-\u001F\u007F]+/g, "")
    .replaceAll(/\s+/g, "")
    .toLowerCase();

  if (normalized.startsWith("javascript:") || normalized.startsWith("vbscript:")) {
    return true;
  }
  if (normalized.startsWith("data:text/html") || normalized.startsWith("data:application")) {
    return true;
  }
  return false;
}

// Локальный санитайзер HTML без внешних зависимостей.
// Удаляет исполняемые теги и атрибуты-обработчики событий.
export function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const FORBIDDEN = ["script", "style", "iframe", "object", "embed", "meta", "link", "base"];
  const URL_ATTRS = new Set(["href", "src", "xlink:href", "formaction"]);
  FORBIDDEN.forEach((tag) => doc.body.querySelectorAll(tag).forEach((el) => el.remove()));

  doc.body.querySelectorAll("*").forEach((el) => {
    Array.from(el.attributes).forEach((attr) => {
      const attrName = attr.name.toLowerCase();
      if (/^on/i.test(attrName)) {
        el.removeAttribute(attr.name);
        return;
      }
      if (URL_ATTRS.has(attrName) && isDangerousUrl(attr.value)) {
        el.removeAttribute(attr.name);
      }
    });
  });
  return doc.body.innerHTML;
}
