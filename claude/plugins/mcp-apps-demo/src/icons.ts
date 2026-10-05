/**
 * @file Tiny inline icon set (outlined, monochrome, per Claude's design guide).
 * Elements with `data-icon="name"` are filled in by `hydrateIcons()`.
 */

const PATHS: Record<string, string> = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  collapse: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  chat: '<path d="M4 5h16v11H9l-5 4V5Z"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
};

export function icon(name: string): string {
  const body = PATHS[name];
  return body
    ? `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
    : "";
}

export function hydrateIcons(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>("[data-icon]").forEach((el) => (el.innerHTML = icon(el.dataset.icon!)));
}
