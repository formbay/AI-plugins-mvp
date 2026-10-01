/**
 * @file Formbay Solar Jobs — MCP Apps showcase View.
 *
 * Every control exercises one MCP Apps feature. Controls that need a host
 * capability (data-needs="...") are disabled with an explanation when the host
 * does not support it, and the "What works" tab lists what this host supports.
 */
import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiDisplayMode,
  type McpUiHostCapabilities,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { z } from "zod";
import { hydrateIcons, icon } from "./icons";
import "./styles.css";

// ---------------------------------------------------------------------------
// Types (mirror server.py)
// ---------------------------------------------------------------------------

interface Job {
  id: string;
  customer: string;
  suburb: string;
  region: string;
  systemKw: number;
  stcs: number;
  status: string;
  installedOn: string;
  installer: string;
}

interface Dashboard {
  view: "dashboard";
  region: string;
  installer: string;
  installers: string[];
  facets?: { installers: Record<string, number>; regions: Record<string, number> };
  jobs: Job[];
  monthly: { month: string; stcs: number }[];
  totals: { jobs: number; stcs: number; kw: number; approved: number };
  generatedAt: string;
}

interface Draft {
  customer?: string;
  suburb?: string;
  region?: string;
  system_kw?: number;
  systemKw?: number;
  notes?: string;
  installer?: string;
  stcs?: number | null;
}

type Tab = "start" | "dashboard" | "form" | "live" | "features";

const STATUSES = ["Draft", "Submitted", "Approved", "Rejected"];
const ZONE_RATING: Record<string, number> = { NSW: 1.382, VIC: 1.185, QLD: 1.382, SA: 1.382, WA: 1.382 };
const CALL_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const mainEl = $("main");

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { dataset?: Record<string, string> } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const { dataset, ...rest } = props;
  const node = Object.assign(document.createElement(tag), rest);
  if (dataset) Object.assign(node.dataset, dataset);
  node.append(...children);
  return node;
}

function iconEl(name: string): HTMLElement {
  const span = el("span");
  span.innerHTML = icon(name);
  return span;
}

const SVG_NS = "http://www.w3.org/2000/svg";
function svgEl(tag: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
}

function tile(label: string, value: string | number, hint = "", iconName = ""): HTMLElement {
  return el(
    "div",
    { className: "tile" },
    el("div", { className: "tile-label" }, ...(iconName ? [iconEl(iconName)] : []), label),
    el("div", { className: "tile-value" }, String(value)),
    ...(hint ? [el("div", { className: "tile-hint" }, hint)] : []),
  );
}

const statusClass = (s: string) => `status-${s.toLowerCase()}`;

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Feedback: toasts, banner, busy buttons, activity log
// ---------------------------------------------------------------------------

/** Turn raw server/SDK errors into something a non-developer can understand. */
const FIELD_LABELS: Record<string, string> = {
  customer: "customer name", suburb: "suburb", region: "state", system_kw: "system size",
  installer: "installer", status: "status", job_id: "job", min_stcs: "minimum STCs",
};
function friendlyError(raw: string): string {
  const msg = raw.replace(/^Error executing tool \S+:\s*/i, "").trim();
  if (/validation error/i.test(msg)) {
    const fields = [...new Set([...msg.matchAll(/(?:^|\s)([a-z_]+)\s+(?:Field required|Input should|Value error)/gi)].map((m) => FIELD_LABELS[m[1]] ?? m[1].replace(/_/g, " ")))];
    return fields.length ? `Some details are missing or not valid: ${fields.join(", ")}.` : "Some details are missing or not valid.";
  }
  if (/timed? ?out/i.test(msg)) return "The server took too long to answer.";
  if (/fetch|network|connection/i.test(msg)) return "Couldn't reach the server.";
  return msg.length > 220 ? `${msg.slice(0, 220)}…` : msg || "Something went wrong.";
}

function toast(text: string, kind: "ok" | "error" | "info" = "ok") {
  const t = el("div", { className: `toast ${kind}` }, iconEl(kind === "error" ? "alert" : kind === "ok" ? "check" : "info"), text);
  $("toasts").append(t);
  setTimeout(() => t.classList.add("hide"), 3200);
  setTimeout(() => t.remove(), 3700);
}

let bannerRetry: (() => void) | null = null;
function showBanner(text: string, retry?: () => void) {
  $("banner-text").textContent = text;
  $("banner-retry").hidden = !retry;
  bannerRetry = retry ?? null;
  $("banner").hidden = false;
}
function hideBanner() {
  $("banner").hidden = true;
}
$("banner-retry").addEventListener("click", () => {
  hideBanner();
  bannerRetry?.();
});

/** Disable a button and show a spinner while `fn` runs; ignore double clicks. */
async function busy<T>(btn: HTMLButtonElement | null, fn: () => Promise<T>): Promise<T | undefined> {
  if (btn?.dataset.busy) return;
  if (btn) {
    btn.dataset.busy = "1";
    btn.disabled = true;
    btn.classList.add("loading");
  }
  try {
    return await fn();
  } finally {
    if (btn) {
      delete btn.dataset.busy;
      btn.disabled = false;
      btn.classList.remove("loading");
      applyCapabilityGates();
    }
  }
}

function logEvent(kind: string, detail = "") {
  const item = el("li", {}, el("code", {}, new Date().toLocaleTimeString()), " ", el("strong", {}, kind), detail ? ` ${detail}` : "");
  const list = $("event-log");
  list.prepend(item);
  while (list.children.length > 80) list.lastElementChild?.remove();
  console.info(`[view] ${kind}`, detail);
}

// ---------------------------------------------------------------------------
// App instance + state
// ---------------------------------------------------------------------------

const app = new App({ name: "Formbay Solar Jobs", version: "1.1.0" });

let connected = false;
let dashboard: Dashboard | null = null;
let selectedJob: Job | null = null;
let viewUUID: string | undefined;
let currentTab: Tab = "start";

const caps = (): McpUiHostCapabilities => app.getHostCapabilities() ?? {};

/** Server tool call with timeout and friendly errors. Returns null on failure (already reported). */
async function callTool(name: string, args: Record<string, unknown>, quiet = false): Promise<CallToolResult | null> {
  if (!connected) {
    if (!quiet) toast("Still connecting to Claude, try again in a moment.", "info");
    return null;
  }
  logEvent("callServerTool", name);
  try {
    const res = await app.callServerTool({ name, arguments: args }, { timeout: CALL_TIMEOUT_MS });
    if (res.isError) {
      const raw = res.content?.find((c) => c.type === "text")?.text ?? "Something went wrong";
      logEvent("tool error", `${name}: ${raw}`);
      if (!quiet) toast(friendlyError(raw), "error");
      return null;
    }
    return res;
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    logEvent("callServerTool failed", `${name}: ${msg}`);
    if (!quiet) {
      showBanner(friendlyError(msg), () => void refresh());
    }
    return null;
  }
}

// ---- Persisted view state (viewUUID + localStorage) ----

function saveState() {
  if (!viewUUID) return;
  try {
    localStorage.setItem(`formbay-demo:${viewUUID}`, JSON.stringify({ tab: currentTab, selected: selectedJob?.id }));
  } catch {
    /* storage can be unavailable in the sandbox; state just won't persist */
  }
}

function loadState(): { tab?: Tab; selected?: string } | null {
  if (!viewUUID) return null;
  try {
    const raw = localStorage.getItem(`formbay-demo:${viewUUID}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Capability gating: disable controls the host can't support, and say why
// ---------------------------------------------------------------------------

function supports(need: string): boolean {
  const c = caps() as Record<string, unknown>;
  return need.split("|").some((n) => !!c[n]);
}

function applyCapabilityGates() {
  if (!connected) return;
  document.querySelectorAll<HTMLButtonElement>("[data-needs]").forEach((btn) => {
    if (btn.dataset.busy) return;
    // Hosts don't always advertise everything they handle, so we never hard-disable:
    // the button is marked and still tries, falling back gracefully if it fails.
    const ok = supports(btn.dataset.needs!);
    btn.classList.toggle("unsupported", !ok);
    btn.title = ok ? "" : "Claude didn't say it supports this. We'll try, and fall back if it doesn't work.";
  });
  ($("ask-btn") as HTMLButtonElement).disabled = !selectedJob;
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function showTab(tab: Tab) {
  currentTab = tab;
  document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  document.querySelectorAll<HTMLElement>("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== tab));
  if (tab === "features") renderFeatures();
  if (tab === "dashboard" && !dashboard) void refresh();
  saveState();
}

document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab as Tab)));

// ---------------------------------------------------------------------------
// Start here: example prompts + feature cards
// ---------------------------------------------------------------------------

const EXAMPLE_PROMPTS = [
  "Show me the solar jobs dashboard",
  "Show only QLD jobs",
  "Draft a solar job for Priya Sharma in Bondi NSW, 8.2 kW, two-storey tile roof",
  "Which jobs are rejected, and what should I check?",
];

const FEATURE_CARDS: { icon: string; title: string; text: string; cta: string; go: () => void }[] = [
  { icon: "chart", title: "Charts & tables", text: "See all jobs, totals and a monthly chart. Filter by state or search.", cta: "Open dashboard", go: () => showTab("dashboard") },
  { icon: "chat", title: "Claude follows along", text: "Click a job and Claude knows which one you mean. Ask it anything about it.", cta: "Pick a job", go: () => showTab("dashboard") },
  { icon: "form", title: "Forms Claude fills in", text: "Ask Claude to draft a job. The form fills itself while Claude types.", cta: "Open the form", go: () => showTab("form") },
  { icon: "bolt", title: "Live updates", text: "Numbers that refresh by themselves, like a live monitor.", cta: "Go live", go: () => showTab("live") },
  { icon: "expand", title: "Bigger screen", text: "Switch to full screen for more room, or back into the chat.", cta: "Try full screen", go: () => void setDisplayMode("fullscreen") },
  { icon: "check", title: "What works here", text: "A live checklist of which features this version of Claude supports.", cta: "See checklist", go: () => showTab("features") },
];

function renderStart() {
  $("example-prompts").replaceChildren(
    ...EXAMPLE_PROMPTS.map((p) => {
      const chip = el("button", { className: "chip", title: "Send this to Claude" }, iconEl("chat"), p);
      chip.addEventListener("click", () => void busy(chip, () => sendChat(p)));
      return chip;
    }),
  );
  $("feature-cards").replaceChildren(
    ...FEATURE_CARDS.map((c) => {
      const btn = el("button", { className: "ghost small" }, c.cta, " →");
      btn.addEventListener("click", c.go);
      return el("div", { className: "feature-card" }, el("div", { className: "feature-icon" }, iconEl(c.icon)), el("h4", {}, c.title), el("p", {}, c.text), btn);
    }),
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function renderDashboard(d: Dashboard) {
  dashboard = d;
  hideBanner();
  // Dropdowns show how many jobs each choice has, given the other filter.
  const regionCounts = d.facets?.regions ?? {};
  const instCounts = d.facets?.installers ?? {};
  const count = (n: number | undefined) => (n === undefined ? "" : ` (${n})`);
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  const reg = $("region") as HTMLSelectElement;
  reg.replaceChildren(
    el("option", { value: "All" }, `All states${d.facets ? count(sum(regionCounts)) : ""}`),
    ...["NSW", "VIC", "QLD", "SA", "WA"].map((st) => el("option", { value: st }, `${st}${count(regionCounts[st])}`)),
  );
  reg.value = d.region;
  const inst = $("installer") as HTMLSelectElement;
  inst.replaceChildren(
    el("option", { value: "" }, `All installers${d.facets ? count(sum(instCounts)) : ""}`),
    ...d.installers.map((n) => el("option", { value: n }, `${n}${count(instCounts[n])}`)),
  );
  inst.value = d.installer ?? "";

  renderEmptyState(d);
  $("generated-at").textContent = `Updated ${fmtTime(d.generatedAt)}`;

  const approvedPct = d.totals.jobs ? Math.round((d.totals.approved / d.totals.jobs) * 100) : 0;
  $("tiles").replaceChildren(
    tile("Jobs", d.totals.jobs, [d.region === "All" ? "all states" : d.region, d.installer].filter(Boolean).join(" · "), "form"),
    tile("STCs", d.totals.stcs.toLocaleString(), "certificates earned", "sun"),
    tile("Capacity", `${d.totals.kw} kW`, "total system size", "bolt"),
    tile("Approved", `${approvedPct}%`, `${d.totals.approved} of ${d.totals.jobs} jobs`, "check"),
  );

  renderBarChart(d.monthly);
  renderTable();
}

/** When filters return nothing, explain why and offer one-click fixes instead of an empty chart. */
function renderEmptyState(d: Dashboard) {
  const box = $("empty-state");
  const empty = d.jobs.length === 0;
  box.hidden = !empty;
  $("dash-content").hidden = empty;
  if (!empty) return;

  const setFilters = (region: string, installer: string) => {
    ($("region") as HTMLSelectElement).value = region;
    ($("installer") as HTMLSelectElement).value = installer;
    void refresh();
  };
  const action = (label: string, region: string, installer: string) => {
    const b = el("button", { className: "ghost small" }, label);
    b.addEventListener("click", () => setFilters(region, installer));
    return b;
  };

  const scope = [d.installer, d.region !== "All" ? `in ${d.region}` : ""].filter(Boolean).join(" ");
  const lines: (Node | string)[] = [];
  const actions: HTMLElement[] = [];
  if (d.installer) {
    const where = Object.entries(d.facets?.regions ?? {}).filter(([, n]) => n).map(([st]) => st);
    if (where.length) {
      lines.push(el("p", {}, `${d.installer} has jobs in: `, el("strong", {}, where.join(", ")), "."));
      where.forEach((st) => actions.push(action(`${d.installer} in ${st}`, st, d.installer)));
      actions.push(action(`All of ${d.installer.split(" ")[0]}'s jobs`, "All", d.installer));
    }
  }
  if (d.region !== "All") {
    const who = Object.entries(d.facets?.installers ?? {}).filter(([, n]) => n).map(([name]) => name);
    if (who.length) {
      lines.push(el("p", {}, `Installers with jobs in ${d.region}: `, el("strong", {}, who.join(", ")), "."));
      actions.push(action(`All ${d.region} jobs`, d.region, ""));
    }
  }
  actions.push(action("Show everything", "All", ""));
  box.replaceChildren(
    el("div", { className: "empty-icon" }, iconEl("search")),
    el("h3", {}, scope ? `No jobs for ${scope}` : "No jobs match these filters"),
    ...lines,
    el("div", { className: "actions" }, ...actions),
  );
}

function renderTable() {
  const body = $("jobs-body");
  if (!dashboard) return;
  const q = ($("search") as HTMLInputElement).value.trim().toLowerCase();
  const rows = dashboard.jobs.filter((j) => !q || `${j.id} ${j.customer} ${j.suburb} ${j.region} ${j.installer}`.toLowerCase().includes(q));
  if (!rows.length) {
    body.replaceChildren(el("tr", {}, el("td", { colSpan: 7, className: "empty" }, q ? `No jobs match "${q}".` : "No jobs match these filters. Try \u201cAll states\u201d or \u201cAll installers\u201d.")));
    return;
  }
  body.replaceChildren(
    ...rows.map((job) => {
      const select = el(
        "select",
        { className: `status-pill ${statusClass(job.status)}`, title: "Change status", ariaLabel: `Status of ${job.id}` },
        ...STATUSES.map((s) => el("option", { value: s, selected: s === job.status }, s)),
      );
      select.addEventListener("click", (e) => e.stopPropagation());
      select.addEventListener("change", () => void updateStatus(job, select));
      const row = el(
        "tr",
        { className: job.id === selectedJob?.id ? "selected" : "", tabIndex: 0, dataset: { id: job.id } },
        el("td", {}, el("span", { className: "job-id" }, job.id)),
        el("td", {}, el("strong", {}, job.customer)),
        el("td", { className: "muted" }, `${job.suburb}, ${job.region}`),
        el("td", {}, job.installer),
        el("td", { className: "num" }, `${job.systemKw} kW`),
        el("td", { className: "num" }, String(job.stcs)),
        el("td", {}, select),
      );
      row.addEventListener("click", () => void selectJob(job));
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void selectJob(job);
        }
      });
      return row;
    }),
  );
}

function renderBarChart(data: { month: string; stcs: number }[]) {
  const svg = $("chart") as unknown as SVGSVGElement;
  const tip = $("chart-tip");
  const W = 640, H = 220, pad = { l: 36, r: 8, t: 22, b: 26 };
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.replaceChildren();
  if (!data.length) {
    svg.append(svgEl("text", { x: W / 2, y: H / 2, "text-anchor": "middle", class: "axis" }, "No data for this selection"));
    return;
  }
  const max = Math.max(...data.map((d) => d.stcs)) * 1.15 || 1;
  const innerW = W - pad.l - pad.r, innerH = H - pad.t - pad.b;
  const band = innerW / data.length;
  const barW = Math.min(56, band * 0.6);

  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const y = pad.t + innerH * (1 - t);
    svg.append(svgEl("line", { x1: pad.l, x2: W - pad.r, y1: y, y2: y, class: t === 0 ? "baseline" : "grid" }));
    if (t > 0) svg.append(svgEl("text", { x: pad.l - 6, y: y + 4, "text-anchor": "end", class: "axis" }, String(Math.round(max * t))));
  }

  data.forEach((d, i) => {
    const h = Math.max(2, (d.stcs / max) * innerH);
    const cx = pad.l + i * band + band / 2;
    const label = new Date(`${d.month}-01T00:00:00`).toLocaleDateString([], { month: "short", year: "2-digit" });
    const bar = svgEl("rect", { x: cx - barW / 2, y: pad.t + innerH - h, width: barW, height: h, rx: 4, class: "bar", tabindex: 0 });
    const show = () => {
      tip.textContent = `${label}: ${d.stcs} STCs`;
      tip.style.left = `${(cx / W) * 100}%`;
      tip.style.top = `${((pad.t + innerH - h) / H) * 100}%`;
      tip.hidden = false;
    };
    bar.addEventListener("mouseenter", show);
    bar.addEventListener("focus", show);
    bar.addEventListener("mouseleave", () => (tip.hidden = true));
    bar.addEventListener("blur", () => (tip.hidden = true));
    svg.append(bar);
    svg.append(svgEl("text", { x: cx, y: pad.t + innerH - h - 6, "text-anchor": "middle", class: "value" }, String(d.stcs)));
    svg.append(svgEl("text", { x: cx, y: H - 8, "text-anchor": "middle", class: "axis" }, label));
  });
}

async function refresh() {
  const region = ($("region") as HTMLSelectElement).value;
  const installer = ($("installer") as HTMLSelectElement).value;
  await busy($("refresh-btn") as HTMLButtonElement, async () => {
    const res = await callTool("refresh_dashboard", { region, installer });
    if (res?.structuredContent) renderDashboard(res.structuredContent as unknown as Dashboard);
  });
}

$("refresh-btn").addEventListener("click", () => void refresh());
$("region").addEventListener("change", () => void refresh());
$("installer").addEventListener("change", () => void refresh());
$("search").addEventListener("input", renderTable);

async function updateStatus(job: Job, select: HTMLSelectElement) {
  const previous = job.status;
  const status = select.value;
  select.disabled = true;
  const res = await callTool("update_job_status", { job_id: job.id, status });
  select.disabled = false;
  if (!res) {
    select.value = previous; // roll back on failure
    return;
  }
  job.status = status;
  select.className = `status-pill ${statusClass(status)}`;
  toast(`${job.id} is now ${status}`);
  if (selectedJob?.id === job.id) {
    renderSelection();
    await pushSelectionToModel();
  }
  await refresh();
}

// ---- Selection → updateModelContext ----

function renderSelection() {
  const box = $("selection-text");
  const j = selectedJob;
  if (!j) return;
  box.className = "selection-detail";
  box.replaceChildren(
    el("div", { className: "avatar" }, j.customer.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase()),
    el(
      "div",
      {},
      el("div", {}, el("strong", {}, j.customer), " ", el("span", { className: "job-id" }, j.id), " ", el("span", { className: `badge ${statusClass(j.status)}` }, j.status)),
      el("div", { className: "muted small" }, `${j.suburb}, ${j.region} · ${j.systemKw} kW · ${j.stcs} STCs · installed ${j.installedOn} by ${j.installer}`),
      el("div", { className: "shared-note" }, iconEl("eye"), supports("updateModelContext") ? "Claude can see this selection" : "This Claude version can't receive selections"),
    ),
  );
}

async function selectJob(job: Job) {
  selectedJob = job;
  document.querySelectorAll<HTMLTableRowElement>("#jobs-body tr").forEach((tr) => tr.classList.toggle("selected", tr.dataset.id === job.id));
  renderSelection();
  applyCapabilityGates();
  await pushSelectionToModel();
  saveState();
}

async function pushSelectionToModel() {
  if (!selectedJob || !supports("updateModelContext")) return;
  const j = selectedJob;
  const text = `---\nselected-job: ${j.id}\nstatus: ${j.status}\n---\n\nIn the Formbay Solar Jobs app the user has selected job ${j.id} for ${j.customer} (${j.suburb} ${j.region}, ${j.systemKw} kW, ${j.stcs} STCs, status ${j.status}, installed ${j.installedOn} by ${j.installer}).`;
  try {
    await app.updateModelContext({ content: [{ type: "text", text }] });
    logEvent("updateModelContext", j.id);
  } catch (e) {
    logEvent("updateModelContext failed", (e as Error).message);
  }
}

// ---- sendMessage ----

async function copyFallback(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied. Paste it into the chat.", "info");
  } catch {
    toast(`Type this in the chat: "${text}"`, "info");
  }
}

async function sendChat(text: string) {
  logEvent("sendMessage", text);
  try {
    const { isError } = await app.sendMessage({ role: "user", content: [{ type: "text", text }] }, { timeout: CALL_TIMEOUT_MS });
    if (isError) await copyFallback(text);
    else toast("Sent to Claude");
  } catch (e) {
    logEvent("sendMessage failed", (e as Error).message);
    await copyFallback(text);
  }
}

$("ask-btn").addEventListener("click", (e) => {
  const j = selectedJob;
  if (j) void busy(e.currentTarget as HTMLButtonElement, () => sendChat(`Tell me about job ${j.id} (${j.customer}, ${j.suburb}). Is anything unusual about it compared to the other jobs?`));
});

// ---- Summarise: createSamplingMessage, falling back to sendMessage ----

$("summarise-btn").addEventListener("click", (e) =>
  void busy(e.currentTarget as HTMLButtonElement, async () => {
    if (!dashboard) return;
    const out = $("ai-output");
    if (!supports("sampling")) {
      logEvent("sampling unsupported", "using sendMessage");
      await sendChat("Summarise the solar jobs dashboard I'm looking at in two sentences.");
      return;
    }
    out.hidden = false;
    out.replaceChildren(el("span", { className: "spinner" }), " Asking the AI…");
    logEvent("createSamplingMessage");
    try {
      const res = await app.createSamplingMessage(
        { messages: [{ role: "user", content: { type: "text", text: `Summarise these solar jobs in two short sentences for a busy manager:\n${JSON.stringify(dashboard.jobs)}` } }], maxTokens: 200 },
        { timeout: 60_000 },
      );
      const content = Array.isArray(res.content) ? res.content : [res.content];
      out.replaceChildren(el("div", { className: "ai-label" }, iconEl("sparkle"), "AI summary"), content.map((c) => (c.type === "text" ? c.text : "")).join("\n"));
    } catch (err) {
      out.textContent = `The AI couldn't answer: ${(err as Error).message}`;
    }
  }),
);

// ---- downloadFile ----

$("export-btn").addEventListener("click", (e) =>
  void busy(e.currentTarget as HTMLButtonElement, async () => {
    if (!dashboard) return;
    const header = "id,customer,suburb,region,systemKw,stcs,status,installedOn";
    const rows = dashboard.jobs.map((j) => [j.id, j.customer, j.suburb, j.region, j.systemKw, j.stcs, j.status, j.installedOn].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    logEvent("downloadFile", "formbay-jobs.csv");
    try {
      const { isError } = await app.downloadFile({
        contents: [{ type: "resource", resource: { uri: "file:///formbay-jobs.csv", mimeType: "text/csv", text: [header, ...rows].join("\n") } }],
      });
      toast(isError ? "Download cancelled" : "CSV downloaded", isError ? "info" : "ok");
    } catch (err) {
      logEvent("downloadFile failed", (err as Error).message);
      toast("Couldn't download the file.", "error");
    }
  }),
);

// ---- openLink ----

$("link-btn").addEventListener("click", (e) =>
  void busy(e.currentTarget as HTMLButtonElement, async () => {
    logEvent("openLink", "cer.gov.au");
    try {
      const { isError } = await app.openLink({ url: "https://cer.gov.au/schemes/small-scale-renewable-energy-scheme" });
      if (isError) toast("Claude didn't open the link.", "info");
    } catch {
      toast("Couldn't open the link.", "error");
    }
  }),
);

// ---------------------------------------------------------------------------
// New job form: streaming fill-in, validation, live estimate, submit
// ---------------------------------------------------------------------------

const form = $<HTMLFormElement>("job-form");
const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;

function fillForm(d: Draft) {
  const set = (name: string, v: unknown) => {
    if (v === undefined || v === null || v === "") return;
    field(name).value = String(v);
    field(name).closest("label")?.classList.remove("invalid");
  };
  set("customer", d.customer);
  set("suburb", d.suburb);
  set("region", d.region);
  set("systemKw", d.system_kw ?? d.systemKw);
  set("installer", d.installer);
  set("notes", d.notes);
  updateEstimate();
}

const MISSING_TO_FIELD: Record<string, string> = { "customer name": "customer", suburb: "suburb", state: "region", "system size": "systemKw" };
function markMissing(missing: string[]) {
  form.querySelectorAll("label.needed").forEach((l) => l.classList.remove("needed"));
  for (const m of missing) field(MISSING_TO_FIELD[m] ?? m)?.closest("label")?.classList.add("needed");
}

function setInstallerOptions(names: string[]) {
  const sel = field("installer") as unknown as HTMLSelectElement;
  const current = sel.value;
  sel.replaceChildren(el("option", { value: "" }, "Not assigned yet"), ...names.map((n) => el("option", { value: n }, n)));
  sel.value = names.includes(current) ? current : "";
}

function updateEstimate() {
  const kw = Number(field("systemKw").value);
  const zone = ZONE_RATING[field("region").value];
  const box = $("estimate");
  box.replaceChildren(iconEl("sun"));
  if (kw > 0 && zone) {
    box.append(el("span", {}, "Estimated ", el("strong", {}, `${Math.floor(kw * zone * 5 * 2)} STCs`), ` for a ${kw} kW system in ${field("region").value} (rough guide).`));
  } else {
    box.append(el("span", {}, "Fill in the state and size to see an STC estimate."));
  }
}
form.addEventListener("input", (e) => {
  (e.target as HTMLElement).closest("label")?.classList.remove("invalid", "needed");
  updateEstimate();
});
form.addEventListener("reset", () => {
  setTimeout(updateEstimate);
  form.querySelectorAll("label.invalid").forEach((l) => l.classList.remove("invalid"));
  $("form-success").hidden = true;
});

function validate(): boolean {
  let ok = true;
  for (const name of ["customer", "suburb", "region", "systemKw"]) {
    const input = field(name);
    const value = input.value.trim();
    const bad = !value || (name === "systemKw" && !(Number(value) > 0 && Number(value) <= 100));
    input.closest("label")?.classList.toggle("invalid", bad);
    if (bad && ok) input.focus();
    ok &&= !bad;
  }
  return ok;
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!validate()) return;
  void busy($("submit-btn") as HTMLButtonElement, async () => {
    const res = await callTool("submit_job", {
      customer: field("customer").value.trim(),
      suburb: field("suburb").value.trim(),
      region: field("region").value,
      system_kw: Number(field("systemKw").value),
      installer: field("installer").value,
      notes: field("notes").value.trim(),
    });
    const job = (res?.structuredContent as { job?: Job } | undefined)?.job;
    if (!job) return;
    const success = $("form-success");
    const view = el("button", { className: "ghost small" }, "View on dashboard →");
    view.addEventListener("click", async () => {
      showTab("dashboard");
      await refresh();
      const fresh = dashboard?.jobs.find((j) => j.id === job.id);
      if (fresh) void selectJob(fresh);
    });
    success.replaceChildren(iconEl("check"), el("div", {}, el("strong", {}, `Job ${job.id} created`), el("div", { className: "muted small" }, `${job.customer}, ${job.suburb} ${job.region} · ${job.systemKw} kW · ${job.stcs} STCs`)), view);
    success.hidden = false;
    form.reset();
    dashboard = null; // force a reload next time the dashboard opens
    toast(`Job ${job.id} created`);
    await sendChat(`I just submitted job ${job.id} for ${job.customer} in ${job.suburb} ${job.region} (${job.systemKw} kW, ${job.stcs} STCs).`);
  });
});

// ---------------------------------------------------------------------------
// Live tab: polling an app-only tool, paused when offscreen
// ---------------------------------------------------------------------------

let pollTimer: number | null = null;
let pollWanted = false;
let pollInFlight = false;
let pollFailures = 0;
const samples: number[] = [];

async function pollOnce() {
  if (pollInFlight) return; // never stack requests if the server is slow
  pollInFlight = true;
  const res = await callTool("poll_live_stats", {}, true);
  pollInFlight = false;
  const s = res?.structuredContent as { at: string; fleetOutputKw: number; installersOnSite: number } | undefined;
  if (!s) {
    if (++pollFailures >= 3) {
      setPolling(false);
      showBanner("Live updates stopped: the server isn't answering.", () => setPolling(true));
    }
    return;
  }
  pollFailures = 0;
  samples.push(s.fleetOutputKw);
  if (samples.length > 30) samples.shift();
  $("live-tiles").replaceChildren(
    tile("Fleet output", `${s.fleetOutputKw} kW`, "all systems combined", "bolt"),
    tile("Installers on site", s.installersOnSite, "right now", "home"),
    tile("Last update", fmtTime(s.at), "refreshes every 2s", "refresh"),
  );
  renderSparkline();
}

function renderSparkline() {
  const svg = $("sparkline") as unknown as SVGSVGElement;
  const W = 640, H = 140, pad = 10;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.replaceChildren();
  if (samples.length < 2) {
    svg.append(svgEl("text", { x: W / 2, y: H / 2, "text-anchor": "middle", class: "axis" }, pollWanted ? "Collecting readings…" : "Press \u201cStart live updates\u201d to begin"));
    return;
  }
  const min = Math.min(...samples) * 0.95, max = Math.max(...samples) * 1.05;
  const x = (i: number) => pad + (i / 29) * (W - 2 * pad);
  const y = (v: number) => H - pad - ((v - min) / (max - min || 1)) * (H - 2 * pad);
  const pts = samples.map((v, i) => `${x(i)},${y(v)}`);
  svg.append(svgEl("polygon", { points: `${x(0)},${H - pad} ${pts.join(" ")} ${x(samples.length - 1)},${H - pad}`, class: "spark-area" }));
  svg.append(svgEl("polyline", { points: pts.join(" "), class: "spark" }));
  svg.append(svgEl("circle", { cx: x(samples.length - 1), cy: y(samples.at(-1)!), r: 4, class: "spark-dot" }));
}

function startPolling() {
  if (pollTimer !== null) return;
  void pollOnce();
  pollTimer = window.setInterval(() => void pollOnce(), 2000);
}

function stopPolling() {
  if (pollTimer === null) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

function setPolling(on: boolean) {
  pollWanted = on;
  pollFailures = 0;
  const btn = $("poll-btn");
  btn.replaceChildren(iconEl(on ? "pause" : "play"), on ? "Stop live updates" : "Start live updates");
  btn.classList.toggle("ghost", on);
  if (!on) samples.length = 0;
  renderSparkline();
  $("live-badge").hidden = !on;
  logEvent(on ? "polling started" : "polling stopped");
  on ? startPolling() : stopPolling();
}

$("poll-btn").addEventListener("click", () => setPolling(!pollWanted));

// Pause polling while the View is scrolled out of sight.
new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!pollWanted) continue;
    entry.isIntersecting ? startPolling() : stopPolling();
  }
}).observe(mainEl);

// ---------------------------------------------------------------------------
// "What works" tab
// ---------------------------------------------------------------------------

function renderFeatures() {
  const c = caps();
  const ctx = app.getHostContext() ?? {};
  const modes = ctx.availableDisplayModes ?? [];
  const groups: { title: string; icon: string; items: [string, string, boolean, string][] }[] = [
    {
      title: "Show things",
      icon: "chart",
      items: [
        ["Open this app from a tool", "Claude shows a screen instead of text", connected, "ui:// resource"],
        ["Get fresh data", "The app asks the server for new numbers", !!c.serverTools, "callServerTool"],
        ["Load files from the server", "The app reads a document from the server", !!c.serverResources, "readServerResource"],
      ],
    },
    {
      title: "Talk to Claude",
      icon: "chat",
      items: [
        ["Send a chat message", "A button types a message into the chat for you", !!c.message, "sendMessage"],
        ["Share what you selected", "Claude knows which job you clicked", !!c.updateModelContext, "updateModelContext"],
        ["Ask the AI inside the app", "Get an AI answer right here in the app", !!c.sampling, "createSamplingMessage"],
      ],
    },
    {
      title: "Files & links",
      icon: "download",
      items: [
        ["Download files", "Save a CSV to your computer", !!c.downloadFile, "downloadFile"],
        ["Open websites", "Open a link in your browser", !!c.openLinks, "openLink"],
        ["Developer logs", "Send debug messages to Claude", !!c.logging, "sendLog"],
      ],
    },
    {
      title: "Window size",
      icon: "expand",
      items: [
        ["Inside the chat", "The normal view", modes.includes("inline") || !modes.length, "inline"],
        ["Full screen", "Use the whole window", modes.includes("fullscreen"), "fullscreen"],
        ["Floating window", "Stays on screen while you scroll", modes.includes("pip"), "pip"],
      ],
    },
    {
      title: "Look & feel",
      icon: "palette",
      items: [
        ["Light / dark mode", `Matches Claude (now: ${ctx.theme ?? "unknown"})`, !!ctx.theme, "theme"],
        ["Claude's colours & fonts", "Uses the same styling as Claude", !!(ctx.styles?.variables || ctx.styles?.css?.fonts), "styles"],
        ["Language & time zone", ctx.locale || ctx.timeZone ? [ctx.locale, ctx.timeZone].filter(Boolean).join(" · ") : "Not shared by this host", !!(ctx.locale || ctx.timeZone), "locale"],
      ],
    },
  ];

  let yes = 0, total = 0;
  $("features").replaceChildren(
    ...groups.map((g) =>
      el(
        "div",
        { className: "feature-group card" },
        el("h3", {}, iconEl(g.icon), g.title),
        el(
          "ul",
          {},
          ...g.items.map(([name, desc, ok, api]) => {
            total++;
            if (ok) yes++;
            return el(
              "li",
              { className: ok ? "yes" : "no" },
              el("span", { className: "dot" }, ok ? "✓" : "–"),
              el("div", {}, el("div", { className: "feat-name" }, name), el("div", { className: "muted small" }, desc)),
              el("code", { title: "SDK name" }, api),
            );
          }),
        ),
      ),
    ),
  );
  const host = app.getHostVersion();
  $("host-line").replaceChildren(
    el("strong", {}, host ? `${host.name}` : "Unknown host"),
    host?.version ? ` v${host.version}` : "",
    ctx.platform ? ` · ${ctx.platform}` : "",
    " · ",
    el("span", { className: "badge status-approved" }, `${yes} of ${total} supported`),
  );
}

$("guide-btn").addEventListener("click", (e) =>
  void busy(e.currentTarget as HTMLButtonElement, async () => {
    const out = $("guide-output");
    out.hidden = false;
    logEvent("readServerResource", "formbay://guides/stc-basics");
    try {
      const res = await app.readServerResource({ uri: "formbay://guides/stc-basics" }, { timeout: CALL_TIMEOUT_MS });
      const c = res.contents[0];
      out.replaceChildren(el("div", { className: "ai-label" }, iconEl("book"), "STC basics (from the server)"), c && "text" in c ? c.text : "(empty)");
    } catch (err) {
      out.textContent = `Couldn't load the file: ${(err as Error).message}`;
    }
  }),
);

$("log-btn").addEventListener("click", async () => {
  try {
    await app.sendLog({ level: "info", data: { from: "Formbay Solar Jobs", at: new Date().toISOString() } });
    logEvent("sendLog", "info");
    toast("Log sent to Claude");
  } catch {
    toast("Couldn't send the log.", "error");
  }
});

// ---------------------------------------------------------------------------
// Display modes + close
// ---------------------------------------------------------------------------

async function setDisplayMode(mode: McpUiDisplayMode) {
  const modes = app.getHostContext()?.availableDisplayModes;
  if (modes && !modes.includes(mode)) {
    toast("This version of Claude can't change to that size.", "info");
    return;
  }
  logEvent("requestDisplayMode", mode);
  try {
    const res = await app.requestDisplayMode({ mode });
    if (res.mode !== mode) toast(`Claude kept the ${res.mode} view.`, "info");
  } catch {
    toast("Couldn't change the window size.", "error");
  }
}

document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((btn) => btn.addEventListener("click", () => void setDisplayMode(btn.dataset.mode as McpUiDisplayMode)));

$("close-btn").addEventListener("click", () => {
  logEvent("requestTeardown");
  void app.requestTeardown();
});

// ---------------------------------------------------------------------------
// Host context: theme, fonts, safe areas, display mode
// ---------------------------------------------------------------------------

function applyHostContext(ctx: McpUiHostContext) {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  if (ctx.safeAreaInsets) {
    const s = ctx.safeAreaInsets;
    mainEl.style.padding = `${s.top + 12}px ${s.right + 12}px ${s.bottom + 12}px ${s.left + 12}px`;
  }
  const full = app.getHostContext() ?? ctx;
  document.documentElement.classList.toggle("is-fullscreen", full.displayMode === "fullscreen");
  const modes = full.availableDisplayModes;
  document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) => {
    b.hidden = !!modes && !modes.includes(b.dataset.mode as McpUiDisplayMode);
    b.setAttribute("aria-pressed", String((full.displayMode ?? "inline") === b.dataset.mode));
  });
  const seg = document.querySelector<HTMLElement>(".segmented")!;
  seg.hidden = [...seg.querySelectorAll("button")].filter((b) => !b.hidden).length < 2;
  $("host-context").textContent = JSON.stringify({ ...full, styles: full.styles ? "(host colours + fonts, omitted)" : undefined }, null, 2);
  if (currentTab === "features") renderFeatures();
}

// ---------------------------------------------------------------------------
// One live copy at a time: every tool call makes the host open a NEW copy of
// this app. Copies share an origin, so they coordinate over a BroadcastChannel:
// when a newer copy gets data, older ones shrink to a one-line bar. If the
// browser blocks this, every copy simply stays visible (no harm done).
// ---------------------------------------------------------------------------

const INSTANCE_ID = Math.random().toString(36).slice(2);
let channel: BroadcastChannel | null = null;
try {
  channel = new BroadcastChannel("formbay-solar-jobs");
} catch {
  channel = null;
}

function setSuperseded(on: boolean) {
  document.documentElement.classList.toggle("superseded", on);
  $("superseded-bar").hidden = !on;
  mainEl.hidden = on;
  if (on) {
    stopPolling();
    logEvent("superseded", "a newer copy opened");
  } else if (pollWanted) {
    startPolling();
  }
}

function announceActive() {
  setSuperseded(false);
  channel?.postMessage({ type: "active", id: INSTANCE_ID });
}

if (channel) {
  channel.onmessage = (e: MessageEvent<{ type: string; id: string }>) => {
    if (e.data?.type === "active" && e.data.id !== INSTANCE_ID) setSuperseded(true);
  };
}
$("restore-btn").addEventListener("click", announceActive);

// ---------------------------------------------------------------------------
// Lifecycle handlers — all registered BEFORE app.connect()
// ---------------------------------------------------------------------------

// Arguments streaming in while Claude is still writing the tool call.
app.ontoolinputpartial = (params) => {
  const args = (params.arguments ?? {}) as Draft;
  if ("customer" in args || "suburb" in args || "notes" in args) {
    if (currentTab !== "form") showTab("form");
    fillForm(args);
    $("form-hint").replaceChildren(el("span", { className: "spinner" }), " ", el("strong", {}, "Claude is filling in this form…"), " watch the fields update as it types.");
  }
};

app.ontoolinput = (params) => {
  logEvent("ontoolinput", JSON.stringify(params.arguments ?? {}));
};

app.ontoolresult = (res) => {
  logEvent("ontoolresult", res.isError ? "error" : "ok");
  announceActive();
  viewUUID = res._meta?.viewUUID ? String(res._meta.viewUUID) : viewUUID;
  const data = res.structuredContent as { view?: string; draft?: Draft; missing?: string[]; installers?: string[] } | undefined;
  if (res.isError) {
    showBanner(friendlyError(res.content?.find((c) => c.type === "text")?.text ?? "The tool reported an error."));
    return;
  }
  if (data?.view === "dashboard") {
    renderDashboard(data as unknown as Dashboard);
    showTab("dashboard");
  } else if (data?.view === "form" && data.draft) {
    if (data.installers) setInstallerOptions(data.installers);
    fillForm(data.draft);
    markMissing(data.missing ?? []);
    const missing = data.missing ?? [];
    $("form-hint").replaceChildren(
      el("strong", {}, missing.length === 4 ? "Let's add a new job." : "Claude filled in what it knows."),
      missing.length ? ` Please add: ${missing.join(", ")} (highlighted below).` : ` Estimated ${data.draft.stcs} STCs. Check the details, then press Submit.`,
    );
    showTab("form");
  }
  // Restore the previous tab/selection for this view instance, if any.
  const saved = loadState();
  if (saved?.tab && saved.tab !== currentTab) showTab(saved.tab);
  if (saved?.selected && dashboard) {
    const job = dashboard.jobs.find((j) => j.id === saved.selected);
    if (job) void selectJob(job);
  }
};

app.ontoolcancelled = (params) => {
  logEvent("ontoolcancelled", params.reason ?? "");
  showBanner("Claude cancelled the request before it finished.");
};

app.onhostcontextchanged = (ctx) => {
  // Size changes arrive often; only log the interesting ones.
  const keys = Object.keys(ctx).filter((k) => k !== "containerDimensions");
  if (keys.length) logEvent("onhostcontextchanged", keys.join(", "));
  applyHostContext(ctx);
};

app.onteardown = async () => {
  logEvent("onteardown");
  stopPolling();
  saveState();
  return {};
};

app.onerror = (e) => console.error("[view] error", e);

// Tools the View itself offers. A host that supports app tools lets Claude call
// these to update the copy that's already open, instead of opening a new one.
app.registerTool(
  "set_dashboard_filters",
  {
    title: "Change filters in the open dashboard",
    description: "Updates the already-open Formbay Solar Jobs dashboard in place. Use instead of opening a new dashboard.",
    inputSchema: z.object({
      region: z.string().optional().describe("NSW, VIC, QLD, SA, WA or All"),
      installer: z.string().optional().describe("Installer name or part of it; empty for everyone"),
    }),
  },
  async ({ region, installer }) => {
    announceActive();
    showTab("dashboard");
    const res = await callTool("refresh_dashboard", { region: region ?? "All", installer: installer ?? "" });
    if (!res?.structuredContent) return { isError: true, content: [{ type: "text", text: res ? "No data" : "Couldn't update the dashboard" }] };
    renderDashboard(res.structuredContent as unknown as Dashboard);
    return { content: res.content ?? [] };
  },
);

app.registerTool(
  "fill_job_form",
  {
    title: "Fill in the open new-job form",
    description: "Fills fields in the already-open new-job form without opening a new one.",
    inputSchema: z.object({
      customer: z.string().optional(),
      suburb: z.string().optional(),
      region: z.string().optional(),
      system_kw: z.number().optional(),
      installer: z.string().optional(),
      notes: z.string().optional(),
    }),
  },
  async (args) => {
    announceActive();
    showTab("form");
    fillForm(args);
    return { content: [{ type: "text", text: "Form updated in the open app." }] };
  },
);

app.registerTool(
  "get_view_state",
  { title: "Get app view state", description: "Returns the tab and job the user currently has open in the Formbay Solar Jobs app." },
  async () => ({ content: [{ type: "text", text: JSON.stringify({ tab: currentTab, selectedJob, region: dashboard?.region ?? null }) }] }),
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

hydrateIcons();
renderStart();
renderSparkline();
updateEstimate();
showTab("start");

const connectTimeout = setTimeout(() => {
  if (!connected) showBanner("Still connecting to Claude… If this doesn't go away, close and reopen the app.");
}, 8000);

app
  .connect()
  .then(() => {
    connected = true;
    clearTimeout(connectTimeout);
    hideBanner();
    logEvent("connected", app.getHostVersion()?.name ?? "");
    const ctx = app.getHostContext();
    if (ctx) applyHostContext(ctx);
    applyCapabilityGates();
    renderFeatures();
  })
  .catch((e) => {
    clearTimeout(connectTimeout);
    console.error(e);
    showBanner("Couldn't connect to Claude. Close and reopen the app.");
  });
