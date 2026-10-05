/**
 * @file Formbay Playground — a chat page that pretends to be Claude so the
 * MCP App can be tried without installing it in Claude.
 *
 * There is no AI here: a simple keyword matcher turns your question into a
 * tool call (and shows which one), then the app renders like it would in Claude.
 * The MCP plumbing (connect, sandbox, AppBridge) comes from implementation.ts,
 * taken from the official basic-host example.
 */
import type { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { callTool, connectToServer, hasAppHtml, initializeApp, loadSandboxProxy, newAppBridge, type ServerInfo } from "./implementation";
import { getTheme, toggleTheme } from "./theme";
import "./styles.css";

// ---------------------------------------------------------------------------
// "Pretend Claude": question → tool call
// ---------------------------------------------------------------------------

interface Plan {
  tool: string;
  args: Record<string, unknown>;
}

const STATE_WORDS: [RegExp, string][] = [
  [/\b(nsw|new south wales|sydney)\b/, "NSW"],
  [/\b(vic|victoria|melbourne)\b/, "VIC"],
  [/\b(qld|queensland|brisbane)\b/, "QLD"],
  [/\b(sa|south australia|adelaide)\b/, "SA"],
  [/\b(wa|western australia|perth)\b/, "WA"],
  [/\b(tas|tasmania|hobart)\b/, "Tasmania"], // not a demo state: shows the friendly error
];
const INSTALLERS = ["Arash", "Ben", "Chloe", "Liam"];

function plan(question: string): Plan | null {
  const q = question.toLowerCase();
  const region = STATE_WORDS.find(([re]) => re.test(q))?.[1];

  if (/\b(draft|new|create|add)\b.*\bjob\b/.test(q)) {
    const kw = q.match(/(\d+(?:\.\d+)?)\s*kw/);
    const customer = question.match(/\bfor ([A-Z][a-z]+(?: [A-Z][a-z]+)?)/);
    const suburb = question.match(/\bin ([A-Z][a-z]+(?: [A-Z][a-z]+)?)\b/);
    const args: Record<string, unknown> = {};
    if (customer) args.customer = customer[1];
    if (suburb && !STATE_WORDS.some(([re]) => re.test(suburb[1].toLowerCase()))) args.suburb = suburb[1];
    if (region) args.region = region;
    if (kw) args.system_kw = Number(kw[1]);
    return { tool: "draft_solar_job", args };
  }

  if (/\b(job|jobs|dashboard|install|installs|stc|stcs|show|list)\b/.test(q)) {
    const args: Record<string, unknown> = {};
    if (region) args.region = region;
    const installer = INSTALLERS.find((n) => q.includes(n.toLowerCase()));
    if (installer) args.installer = installer;
    return { tool: "show_solar_dashboard", args };
  }
  return null;
}

const EXAMPLES = [
  "Show me the solar jobs dashboard",
  "Show QLD jobs done by Arash",
  "Show Ben's jobs in QLD",
  "Draft a new job for Shirin Karimi in Bondi NSW, 8.2 kW",
  "Create a new job",
  "Show jobs in NSW",
];

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const thread = $("thread");

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", ...children: (Node | string)[]) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children);
  return node;
}

function scrollDown() {
  requestAnimationFrame(() => thread.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "end" }));
}

function userBubble(text: string, tag?: string) {
  $("welcome").hidden = true;
  thread.append(el("div", "msg user", el("div", "bubble", ...(tag ? [el("span", "tag", tag)] : []), text)));
  scrollDown();
}

function claudeNote(...children: (Node | string)[]) {
  const block = el("div", "msg claude", el("div", "avatar", "✳"), el("div", "body", ...children));
  thread.append(block);
  scrollDown();
  return block.querySelector(".body") as HTMLElement;
}

// ---------------------------------------------------------------------------
// Ask → call the tool → render the app
// ---------------------------------------------------------------------------

let server: ServerInfo | null = null;

async function ask(question: string) {
  const text = question.trim();
  if (!text) return;
  userBubble(text);
  const p = plan(text);
  if (!p) {
    claudeNote(el("p", "", "This playground only understands questions about solar jobs (there's no AI here). Try one of the examples below."));
    return;
  }
  if (!server) {
    claudeNote(el("p", "error", "Not connected to the MCP server. Is server.py running on port 3001?"));
    return;
  }

  const body = claudeNote(
    el("div", "tool-line", el("span", "dot"), "Used ", el("code", "", p.tool), " ", el("code", "args", JSON.stringify(p.args))),
  );

  let info;
  try {
    info = callTool(server, p.tool, p.args);
  } catch (e) {
    body.append(el("p", "error", String(e)));
    return;
  }

  // What Claude itself receives (the tool's text), shown collapsed.
  const textBox = el("details", "tool-text", el("summary", "", "What Claude received"), el("pre", "", "…"));
  info.resultPromise.then(
    (r) => (textBox.querySelector("pre")!.textContent = r.content?.map((c) => ("text" in c ? c.text : `[${c.type}]`)).join("\n") ?? ""),
    (e) => (textBox.querySelector("pre")!.textContent = String(e)),
  );

  if (!hasAppHtml(info)) {
    body.append(textBox);
    return;
  }

  // The app: sandbox iframe + AppBridge, exactly like a real host.
  const frameWrap = el("div", "app-frame");
  const closeFull = el("button", "close-full", "✕ Close full screen");
  const iframe = document.createElement("iframe");
  iframe.title = `${p.tool} app`;
  frameWrap.append(closeFull, iframe);
  const contextLine = el("div", "context-line");
  contextLine.hidden = true;
  body.append(frameWrap, contextLine, textBox);
  scrollDown();

  const setFullscreen = (on: boolean) => {
    frameWrap.classList.toggle("fullscreen", on);
    document.body.classList.toggle("has-fullscreen", on);
  };
  const bridge: AppBridge = newAppBridge(server, iframe, {
    // The app posted a message into the chat (sendMessage).
    onMessage: (msg) => {
      const t = msg.content?.map((c) => ("text" in c ? c.text : "")).join(" ") ?? "";
      userBubble(t, "sent by the app");
      claudeNote(el("p", "muted", "In real Claude, Claude would answer this message here."));
    },
    // The app told Claude something in the background (updateModelContext).
    onContextUpdate: (ctx) => {
      const t = ctx?.content?.map((c) => ("text" in c ? c.text : "")).join(" ") ?? "";
      contextLine.hidden = !t;
      contextLine.replaceChildren(el("span", "", "Claude now knows: "), el("span", "muted", t));
    },
    onDisplayModeChange: (mode) => setFullscreen(mode === "fullscreen"),
  });
  closeFull.addEventListener("click", () => {
    setFullscreen(false);
    bridge.sendHostContextChange({ displayMode: "inline" });
  });

  try {
    const { csp, permissions } = await info.appResourcePromise;
    await loadSandboxProxy(iframe, csp, permissions);
    await initializeApp(iframe, bridge, info);
  } catch (e) {
    body.append(el("p", "error", `The app couldn't load: ${e}`));
  }
}

// ---------------------------------------------------------------------------
// Page setup
// ---------------------------------------------------------------------------

function renderExamples() {
  const make = (q: string) => {
    const b = el("button", "chip", q);
    b.addEventListener("click", () => ask(q));
    return b;
  };
  $("examples").replaceChildren(...EXAMPLES.map(make));
  $("welcome-examples").replaceChildren(...EXAMPLES.slice(0, 4).map(make));
}

$("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>("question");
  const q = input.value;
  input.value = "";
  ask(q);
});

const themeBtn = $("theme-btn");
const showTheme = () => (themeBtn.textContent = getTheme() === "dark" ? "☀ Light" : "☾ Dark");
themeBtn.addEventListener("click", () => {
  toggleTheme();
  showTheme();
});
showTheme();
renderExamples();

(async () => {
  const status = $("status");
  try {
    const urls: string[] = await (await fetch("/api/servers")).json();
    server = await connectToServer(new URL(urls[0]));
    status.textContent = `Connected to ${server.name}`;
    status.className = "status ok";
  } catch (e) {
    status.textContent = "Not connected — start server.py (uv run server.py)";
    status.className = "status bad";
    console.error(e);
  }
})();
