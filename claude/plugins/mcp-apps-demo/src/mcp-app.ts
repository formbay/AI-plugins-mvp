/**
 * @file Formbay Solar Jobs — a small MCP App View.
 *
 * Two screens, chosen by the tool Claude called:
 *   show_solar_dashboard → dashboard (filters, tiles, chart, table)
 *   draft_solar_job      → new-job form (fills in live while Claude types)
 *
 * MCP Apps features used are marked with "MCP Apps:" comments.
 */
import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/client";
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
  facets: { installers: Record<string, number>; regions: Record<string, number> };
  jobs: Job[];
  monthly: { month: string; stcs: number }[];
  totals: { jobs: number; stcs: number; kw: number; approved: number };
}

interface Draft {
  customer?: string;
  suburb?: string;
  region?: string;
  systemKw?: number | null;
  system_kw?: number | null;
  installer?: string;
  notes?: string;
  stcs?: number | null;
}

const STATES = ["NSW", "VIC", "QLD", "SA", "WA"];
const ZONE_RATING: Record<string, number> = { NSW: 1.382, VIC: 1.185, QLD: 1.382, SA: 1.382, WA: 1.382 };

// ---------------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------------

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function iconEl(name: string) {
  const span = el("span");
  span.innerHTML = icon(name);
  return span;
}

function showError(text = "") {
  $("error").textContent = text;
  $("error").hidden = !text;
}

/** Plain-English version of raw server / SDK errors. */
function friendlyError(raw: string): string {
  const msg = raw.replace(/^Error executing tool \S+:\s*/i, "").trim();
  if (/validation error/i.test(msg)) return "Some details are missing or not valid.";
  if (/timed? ?out/i.test(msg)) return "The server took too long to answer. Please try again.";
  return msg.length > 200 ? `${msg.slice(0, 200)}…` : msg || "Something went wrong.";
}

// ---------------------------------------------------------------------------
// App + state
// ---------------------------------------------------------------------------

const app = new App({ name: "Formbay Solar Jobs", version: "2.0.0" });
let dashboard: Dashboard | null = null;
let selected: Job | null = null;
let superseded = false;

/** MCP Apps: callServerTool — the View calls an (app-only) server tool. */
async function callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult | null> {
  try {
    const res = await app.callServerTool({ name, arguments: args }, { timeout: 15_000 });
    const text = res.content?.find((c) => c.type === "text")?.text ?? "";
    if (res.isError) {
      showError(friendlyError(text));
      return null;
    }
    showError();
    return res;
  } catch (e) {
    showError(friendlyError((e as Error).message));
    return null;
  }
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function renderDashboard(d: Dashboard) {
  dashboard = d;
  $("title").textContent = "Solar jobs";
  $("subtitle").textContent = [d.region === "All" ? "All states" : d.region, d.installer || "all installers"].join(" · ");

  // Filters as visible chips (Claude's design guide: avoid dropdown menus), each with a job count.
  const chip = (label: string, count: number | undefined, active: boolean, onClick: () => void) => {
    const b = el("button", { className: `chip${active ? " active" : ""}` }, label, count === undefined ? "" : el("span", { className: "count" }, String(count)));
    b.setAttribute("aria-pressed", String(active));
    b.addEventListener("click", onClick);
    return b;
  };
  const total = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  $("state-chips").replaceChildren(
    chip("All", total(d.facets.regions), d.region === "All", () => loadDashboard("All", d.installer)),
    ...STATES.map((st) => chip(st, d.facets.regions[st], d.region === st, () => loadDashboard(st, d.installer))),
  );
  $("installer-chips").replaceChildren(
    chip("Everyone", total(d.facets.installers), !d.installer, () => loadDashboard(d.region, "")),
    ...d.installers.map((n) => chip(n.split(" ")[0], d.facets.installers[n], d.installer === n, () => loadDashboard(d.region, n))),
  );

  const empty = d.jobs.length === 0;
  $("results").hidden = empty;
  $("empty").hidden = !empty;
  if (empty) return renderEmpty(d);

  // Max 4 data points per card (Claude's design guide).
  const tile = (iconName: string, label: string, value: string | number, extra?: Node) =>
    el("div", { className: "tile" }, el("div", { className: "tile-label" }, iconEl(iconName), label), el("div", { className: "tile-value" }, String(value)), ...(extra ? [extra] : []));
  const pct = d.totals.jobs ? Math.round((d.totals.approved / d.totals.jobs) * 100) : 0;
  const bar = el("div", { className: "progress" }, el("span"));
  (bar.firstChild as HTMLElement).style.width = `${pct}%`;
  $("tiles").replaceChildren(
    tile("list", "Jobs", d.totals.jobs),
    tile("sun", "STCs", d.totals.stcs.toLocaleString()),
    tile("bolt", "Capacity", `${d.totals.kw} kW`),
    tile("check", "Approved", `${pct}%`, bar),
  );
  renderChart(d.monthly);

  $("rows").replaceChildren(
    ...d.jobs.map((j) => {
      const row = el(
        "tr",
        { className: j.id === selected?.id ? "selected" : "", tabIndex: 0 },
        el("td", { className: "mono muted" }, j.id),
        el("td", {}, el("span", { className: "person" }, el("span", { className: `avatar a${avatarColor(j.customer)}` }, initials(j.customer)), j.customer)),
        el("td", { className: "muted" }, `${j.suburb}, ${j.region}`),
        el("td", {}, j.installer),
        el("td", { className: "num" }, String(j.systemKw)),
        el("td", { className: "num" }, String(j.stcs)),
        el("td", {}, el("span", { className: `badge ${j.status.toLowerCase()}` }, el("i"), j.status)),
      );
      row.addEventListener("click", () => selectJob(j));
      row.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), selectJob(j)));
      return row;
    }),
  );
}

const initials = (name: string) => name.replace(/\./g, "").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
const avatarColor = (name: string) => [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 5;

function renderEmpty(d: Dashboard) {
  const where = Object.entries(d.facets.regions).filter(([, n]) => n).map(([st]) => st);
  const scope = [d.installer, d.region !== "All" ? `in ${d.region}` : ""].filter(Boolean).join(" ");
  const showAll = el("button", { className: "ghost" }, "Show all jobs");
  showAll.addEventListener("click", () => loadDashboard("All", ""));
  $("empty").replaceChildren(
    el("p", {}, el("strong", {}, `No jobs ${scope ? `for ${scope}` : "match"}.`)),
    ...(d.installer && where.length ? [el("p", { className: "muted small" }, `${d.installer} has jobs in ${where.join(", ")}.`)] : []),
    showAll,
  );
}

function renderChart(data: { month: string; stcs: number }[]) {
  const svg = $("chart") as unknown as SVGSVGElement;
  const W = 600, H = 170, padB = 22, padT = 18;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const max = Math.max(1, ...data.map((d) => d.stcs));
  const band = W / Math.max(1, data.length);
  const bar = Math.min(44, band * 0.5);
  const inner = H - padB - padT;
  const grid = [0.5, 1].map((t) => `<line class="grid" x1="0" x2="${W}" y1="${H - padB - inner * t}" y2="${H - padB - inner * t}"/>`).join("");
  const bars = data
    .map((d, i) => {
      const h = Math.max(3, (d.stcs / max) * inner);
      const x = i * band + band / 2;
      const top = d.stcs === max ? " top" : "";
      const label = new Date(`${d.month}-01T00:00:00`).toLocaleDateString([], { month: "short" });
      return `<rect class="bar${top}" x="${x - bar / 2}" y="${H - padB - h}" width="${bar}" height="${h}" rx="6"><title>${label}: ${d.stcs} STCs</title></rect>
        <text class="value${top}" x="${x}" y="${H - padB - h - 6}" text-anchor="middle">${d.stcs}</text>
        <text class="axis" x="${x}" y="${H - 5}" text-anchor="middle">${label}</text>`;
    })
    .join("");
  svg.innerHTML = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f59e0b"/><stop offset="1" stop-color="#d97706" stop-opacity="0.55"/></linearGradient></defs>
    ${grid}<line class="baseline" x1="0" x2="${W}" y1="${H - padB}" y2="${H - padB}"/>${bars}`;
}

async function loadDashboard(region: string, installer: string) {
  if (superseded) return;
  $("dashboard").classList.add("loading");
  const res = await callTool("refresh_dashboard", { region, installer });
  $("dashboard").classList.remove("loading");
  if (res?.structuredContent) renderDashboard(res.structuredContent as unknown as Dashboard);
}

/** MCP Apps: updateModelContext — tell Claude which job the user selected. */
async function selectJob(job: Job) {
  selected = job;
  document.querySelectorAll("#rows tr").forEach((tr, i) => tr.classList.toggle("selected", dashboard?.jobs[i]?.id === job.id));
  $("selection-text").replaceChildren(
    el("span", { className: `avatar a${avatarColor(job.customer)}` }, initials(job.customer)),
    el("span", {}, el("strong", {}, `${job.customer} · ${job.id}`), el("br"), el("span", { className: "muted small" }, `${job.suburb} ${job.region} · ${job.systemKw} kW · ${job.stcs} STCs · ${job.status} · by ${job.installer}`)),
  );
  $("selection-text").classList.add("picked");
  ($("ask-btn") as HTMLButtonElement).disabled = superseded;
  if (superseded) return;
  try {
    await app.updateModelContext({
      content: [{ type: "text", text: `The user selected job ${job.id} in the Formbay Solar Jobs app: ${job.customer}, ${job.suburb} ${job.region}, ${job.systemKw} kW, ${job.stcs} STCs, status ${job.status}, installed ${job.installedOn} by ${job.installer}.` }],
    });
  } catch {
    /* host may not support it; the selection still works in the View */
  }
}

/** MCP Apps: sendMessage — put a message into the chat as if the user typed it. */
async function sendChat(text: string) {
  if (superseded) return;
  try {
    const { isError } = await app.sendMessage({ role: "user", content: [{ type: "text", text }] });
    if (isError) showError("Claude didn't accept the message. You can type it in the chat instead.");
  } catch {
    showError("Couldn't send the message. You can type it in the chat instead.");
  }
}

$("ask-btn").addEventListener("click", () => {
  if (selected) sendChat(`Tell me about job ${selected.id} (${selected.customer}, ${selected.suburb}). Is anything unusual about it?`);
});

// ---------------------------------------------------------------------------
// New job form
// ---------------------------------------------------------------------------

const form = $<HTMLFormElement>("job-form");
const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
const REQUIRED: Record<string, string> = { customer: "customer", suburb: "suburb", region: "state", systemKw: "size" };

function fillForm(d: Draft) {
  const set = (name: string, v: unknown) => {
    if (v !== undefined && v !== null && v !== "") field(name).value = String(v);
  };
  set("customer", d.customer);
  set("suburb", d.suburb);
  set("region", d.region);
  set("systemKw", d.system_kw ?? d.systemKw);
  set("installer", d.installer);
  set("notes", d.notes);
  updateForm();
}

/** Live STC estimate + highlight the fields that are still empty. */
function updateForm() {
  const missing = Object.keys(REQUIRED).filter((n) => !field(n).value.trim());
  for (const n of Object.keys(REQUIRED)) field(n).closest("label")!.classList.toggle("needed", missing.includes(n));
  const kw = Number(field("systemKw").value), zone = ZONE_RATING[field("region").value];
  const est = $("estimate");
  est.hidden = !(kw > 0 && zone);
  if (!est.hidden) est.replaceChildren(iconEl("sun"), el("span", {}, el("strong", { className: "est-num" }, String(Math.floor(kw * zone * 5 * 2))), " STCs estimated"), el("span", { className: "muted small" }, "rough guide"));
  return missing;
}
form.addEventListener("input", updateForm);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const missing = updateForm();
  if (missing.length) return showError(`Please add: ${missing.map((n) => REQUIRED[n]).join(", ")}.`);
  const btn = $("submit-btn") as HTMLButtonElement;
  btn.disabled = true;
  const res = await callTool("submit_job", {
    customer: field("customer").value.trim(),
    suburb: field("suburb").value.trim(),
    region: field("region").value,
    system_kw: Number(field("systemKw").value),
    installer: field("installer").value,
    notes: field("notes").value.trim(),
  });
  btn.disabled = false;
  const job = (res?.structuredContent as { job?: Job } | undefined)?.job;
  if (!job) return;
  form.hidden = true;
  $("form-hint").hidden = true;
  $("form-success").hidden = false;
  $("form-success").replaceChildren(iconEl("check"), `Job ${job.id} created for ${job.customer} (${job.stcs} STCs).`);
  await sendChat(`I submitted job ${job.id} for ${job.customer} in ${job.suburb} ${job.region} (${job.systemKw} kW).`);
});

// ---------------------------------------------------------------------------
// One live copy at a time (Claude docs: "Supersede older widget instances").
// Every tool call mounts a new copy of this app. The server stamps each result
// with {createdAt, seq}; copies compare keys over a BroadcastChannel and the
// older ones grey out and stop talking to Claude.
// ---------------------------------------------------------------------------

let myKey: { createdAt: number; seq: number; id: string } | null = null;
let channel: BroadcastChannel | null = null;
try {
  channel = new BroadcastChannel("formbay-solar-jobs");
} catch {
  channel = null; // not available: every copy just stays active
}

function isNewer(a: { createdAt: number; seq: number; id: string }, b: { createdAt: number; seq: number; id: string }) {
  return a.createdAt !== b.createdAt ? a.createdAt > b.createdAt : a.seq !== b.seq ? a.seq > b.seq : a.id > b.id;
}

function setSuperseded(on: boolean) {
  superseded = on;
  $("app").classList.toggle("superseded", on);
  $("superseded-note").hidden = !on;
  ($("ask-btn") as HTMLButtonElement).disabled = on || !selected;
}

if (channel) {
  channel.onmessage = (e) => {
    const other = e.data as { type: string; key: { createdAt: number; seq: number; id: string } };
    if (!myKey || !other?.key || other.key.id === myKey.id) return;
    if (other.type === "hello") channel!.postMessage({ type: "born", key: myKey });
    if (isNewer(other.key, myKey)) setSuperseded(true);
  };
}

function announce(createdAt: number, seq: number) {
  myKey = { createdAt, seq, id: app.getHostContext()?.toolInfo?.id?.toString() ?? crypto.randomUUID() };
  channel?.postMessage({ type: "hello", key: myKey });
}

// ---------------------------------------------------------------------------
// MCP Apps: host context — theme, Claude's colours and fonts, display mode
// ---------------------------------------------------------------------------

function applyHostContext(ctx: McpUiHostContext) {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  if (ctx.safeAreaInsets) {
    const s = ctx.safeAreaInsets;
    $("app").style.padding = `${s.top}px ${s.right}px ${s.bottom}px ${s.left}px`;
  }
  const full = app.getHostContext() ?? ctx;
  const isFull = full.displayMode === "fullscreen";
  // Claude's design guide: the app provides its own fullscreen button.
  const btn = $("fullscreen-btn");
  btn.hidden = !full.availableDisplayModes?.includes("fullscreen");
  btn.replaceChildren(iconEl(isFull ? "collapse" : "expand"));
  btn.title = isFull ? "Exit full screen" : "Full screen";
  document.documentElement.classList.toggle("is-fullscreen", isFull);
}

/** MCP Apps: requestDisplayMode — switch between inline and fullscreen. */
$("fullscreen-btn").addEventListener("click", async () => {
  const mode = app.getHostContext()?.displayMode === "fullscreen" ? "inline" : "fullscreen";
  try {
    await app.requestDisplayMode({ mode });
  } catch {
    showError("Couldn't change the size.");
  }
});

/** What this host says it supports (MCP Apps: getHostCapabilities). */
function renderSupports() {
  const c = app.getHostCapabilities() ?? {};
  const modes = app.getHostContext()?.availableDisplayModes ?? [];
  const rows: [string, boolean][] = [
    ["Call server tools from the app", !!c.serverTools],
    ["Send a chat message", !!c.message],
    ["Share what you selected with Claude", !!c.updateModelContext],
    ["Open links", !!c.openLinks],
    ["Download files", !!c.downloadFile],
    ["Ask the AI from inside the app", !!c.sampling],
    ["Full screen", modes.includes("fullscreen")],
    ["Floating window (PiP)", modes.includes("pip")],
    ["Claude's colours & fonts", !!app.getHostContext()?.styles],
  ];
  const host = app.getHostVersion();
  $("supports-list").replaceChildren(
    ...rows.map(([name, ok]) => el("li", { className: ok ? "yes" : "no" }, ok ? "✓ " : "– ", name)),
    el("li", { className: "muted small" }, `Host: ${host ? `${host.name} ${host.version}` : "unknown"}`),
  );
}

// ---------------------------------------------------------------------------
// MCP Apps: lifecycle handlers — registered BEFORE app.connect()
// ---------------------------------------------------------------------------

// Arguments stream in while Claude is still writing the tool call: fill the form live.
app.ontoolinputpartial = (params) => {
  const args = (params.arguments ?? {}) as Draft;
  if ("customer" in args || "suburb" in args || "notes" in args) {
    showView("form");
    fillForm(args);
  }
};

// The tool result: pick the screen and render it.
app.ontoolresult = (res) => {
  if (res.isError) return showError(friendlyError(res.content?.find((c) => c.type === "text")?.text ?? ""));
  const data = res.structuredContent as (Partial<Dashboard> & { draft?: Draft; missing?: string[]; createdAt?: number; seq?: number }) | undefined;
  if (!data) return;
  if (Number.isFinite(data.createdAt)) announce(data.createdAt!, data.seq ?? 0);
  if (data.view === "dashboard") {
    showView("dashboard");
    renderDashboard(data as Dashboard);
  } else if (data.view === "form" && data.draft) {
    showView("form");
    const sel = field("installer") as unknown as HTMLSelectElement;
    sel.replaceChildren(el("option", { value: "" }, "Not assigned"), ...(data.installers ?? []).map((n) => el("option", { value: n }, n)));
    fillForm(data.draft);
    const missing = data.missing ?? [];
    $("form-hint").textContent = missing.length ? `Claude filled in what it knows. Please add: ${missing.join(", ")}.` : "Claude filled this in. Check it, then press Submit.";
  }
};

app.onhostcontextchanged = applyHostContext;
app.onerror = (e) => console.error("[view]", e);

function showView(view: "dashboard" | "form") {
  $("dashboard").hidden = view !== "dashboard";
  $("form-view").hidden = view !== "form";
  if (view === "form") $("title").textContent = "New solar job";
}

// ---------------------------------------------------------------------------
// Connect
// ---------------------------------------------------------------------------

hydrateIcons();
app
  .connect()
  .then(() => {
    const ctx = app.getHostContext();
    if (ctx) applyHostContext(ctx);
    renderSupports();
  })
  .catch(() => showError("Couldn't connect to Claude. Close and reopen the app."));
