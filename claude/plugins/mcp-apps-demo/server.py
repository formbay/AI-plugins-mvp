#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "mcp>=2.2,<3",
#     "uvicorn>=0.34.0",
#     "starlette>=0.46.0",
# ]
# ///
"""Formbay Solar Jobs: a small demo MCP App. Its tools open an interactive dashboard / form inside Claude.

Run:
    uv run server.py            # HTTP on http://localhost:3001/mcp (basic-host, tunnels)
    uv run server.py --stdio    # stdio (Claude Desktop / Claude Code plugin)

The UI lives in dist/mcp-app.html, built from mcp-app.html + src/ with `npm run build`.
All data is fake demo data held in memory.
"""

from __future__ import annotations

import functools
import math
import os
import sys
import time
from dataclasses import asdict, dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Annotated

from mcp.server.apps import Apps, ResourceCsp
from mcp.server.mcpserver import MCPServer
from mcp_types import CallToolResult, TextContent
from pydantic import Field

HERE = Path(__file__).resolve().parent
VIEW_URI = "ui://formbay-demo/showcase.html"
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "3001"))

STATES = ["NSW", "VIC", "QLD", "SA", "WA"]

# Friendly spellings Claude (or a user) might use for a state.
STATE_ALIASES = {
    "new south wales": "NSW", "nsw": "NSW", "sydney": "NSW",
    "victoria": "VIC", "vic": "VIC", "melbourne": "VIC",
    "queensland": "QLD", "qld": "QLD", "brisbane": "QLD",
    "south australia": "SA", "sa": "SA", "adelaide": "SA",
    "western australia": "WA", "wa": "WA", "perth": "WA",
    "all": "All", "": "All", "any": "All", "everywhere": "All", "all states": "All",
}


class FriendlyError(Exception):
    """An error whose message is safe and clear to show to a user."""


def normalize_state(value: str | None, *, allow_all: bool) -> str:
    code = STATE_ALIASES.get((value or "").strip().lower())
    if code is None or (code == "All" and not allow_all):
        options = ", ".join(STATES) + (" or All" if allow_all else "")
        raise FriendlyError(f'"{value}" isn\'t a state we have jobs in. Please use one of: {options}.')
    return code


# ---------------------------------------------------------------------------
# Demo data (in memory). Not real Formbay data.
# ---------------------------------------------------------------------------


@dataclass
class Job:
    id: str
    customer: str
    suburb: str
    region: str
    systemKw: float
    stcs: int
    status: str
    installedOn: str
    installer: str


JOBS: list[Job] = [
    Job("FB-1001", "A. Patel", "Parramatta", "NSW", 6.6, 92, "Approved", "2026-05-04", "Aman Gill"),
    Job("FB-1002", "J. Nguyen", "Geelong", "VIC", 10.2, 131, "Submitted", "2026-06-11", "Ben Carter"),
    Job("FB-1003", "M. Rossi", "Toowoomba", "QLD", 13.3, 186, "Approved", "2026-06-19", "Aman Gill"),
    Job("FB-1004", "S. Kaur", "Penrith", "NSW", 8.0, 111, "Rejected", "2026-07-02", "Chloe Tran"),
    Job("FB-1005", "L. Chen", "Glenelg", "SA", 6.6, 90, "Draft", "2026-07-15", "Ben Carter"),
    Job("FB-1006", "R. Smith", "Fremantle", "WA", 9.9, 138, "Submitted", "2026-08-01", "Dev Mehta"),
    Job("FB-1007", "D. Brown", "Ballarat", "VIC", 5.0, 63, "Approved", "2026-08-20", "Chloe Tran"),
    Job("FB-1008", "K. Singh", "Cairns", "QLD", 15.0, 214, "Submitted", "2026-09-09", "Aman Gill"),
    Job("FB-1009", "E. Wilson", "Newcastle", "NSW", 7.4, 102, "Draft", "2026-09-22", "Dev Mehta"),
    Job("FB-1010", "T. Okafor", "Townsville", "QLD", 8.8, 121, "Rejected", "2026-09-27", "Chloe Tran"),
]

ZONE_RATING = {"NSW": 1.382, "VIC": 1.185, "QLD": 1.382, "SA": 1.382, "WA": 1.382}


def installers() -> list[str]:
    return sorted({j.installer for j in JOBS})


def match_installer(query: str | None) -> str:
    """Resolve a partial installer name ("aman") to a known installer, or "" for everyone."""
    q = (query or "").strip().lower()
    if q in ("", "all", "any", "everyone", "anyone"):
        return ""
    hits = [name for name in installers() if q in name.lower()]
    if len(hits) == 1:
        return hits[0]
    known = ", ".join(installers())
    if not hits:
        raise FriendlyError(f'No installer called "{query}". Installers in the demo: {known}.')
    raise FriendlyError(f'"{query}" matches more than one installer ({", ".join(hits)}). Please be more specific.')


def estimate_stcs(system_kw: float, region: str) -> int:
    """Rough STC estimate: kW x zone rating x deeming years. Demo only."""
    return math.floor(system_kw * ZONE_RATING[region] * 5 * 2)


def dashboard_data(region: str = "All", installer: str = "", min_stcs: int = 0) -> dict:
    jobs = [
        j
        for j in JOBS
        if (region == "All" or j.region == region) and (not installer or j.installer == installer) and j.stcs >= min_stcs
    ]
    by_month: dict[str, int] = {}
    for j in jobs:
        month = j.installedOn[:7]
        by_month[month] = by_month.get(month, 0) + j.stcs
    # Counts for the filter dropdowns, so the View can show "Ben Carter (0)" and explain empty results.
    in_region = [j for j in JOBS if region == "All" or j.region == region]
    for_installer = [j for j in JOBS if not installer or j.installer == installer]
    return {
        "view": "dashboard",
        "region": region,
        "installer": installer,
        "installers": installers(),
        "facets": {
            "installers": {name: sum(1 for j in in_region if j.installer == name) for name in installers()},
            "regions": {st: sum(1 for j in for_installer if j.region == st) for st in STATES},
        },
        "jobs": [asdict(j) for j in jobs],
        "monthly": [{"month": m, "stcs": s} for m, s in sorted(by_month.items())],
        "totals": {
            "jobs": len(jobs),
            "stcs": sum(j.stcs for j in jobs),
            "kw": round(sum(j.systemKw for j in jobs), 1),
            "approved": sum(1 for j in jobs if j.status == "Approved"),
        },
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }


def text_summary(d: dict) -> str:
    t = d["totals"]
    scope = d["region"] if d["region"] != "All" else "all states"
    if d["installer"]:
        scope += f", installer {d['installer']}"
    lines = [f"Formbay demo dashboard ({scope}): {t['jobs']} jobs, {t['stcs']} STCs, {t['kw']} kW, {t['approved']} approved."]
    if not d["jobs"]:
        lines.append("No jobs match these filters.")
        if d["installer"]:
            where = [st for st, n in d["facets"]["regions"].items() if n]
            if where:
                lines.append(f"{d['installer']} has jobs in: {', '.join(where)}.")
        if d["region"] != "All":
            who = [name for name, n in d["facets"]["installers"].items() if n]
            if who:
                lines.append(f"Installers with jobs in {d['region']}: {', '.join(who)}.")
    lines += [
        f"- {j['id']} {j['customer']}, {j['suburb']} {j['region']}, {j['systemKw']} kW, {j['stcs']} STCs, "
        f"{j['status']}, installer {j['installer']}"
        for j in d["jobs"]
    ]
    return "\n".join(lines)


_call_seq = 0


def result(text: str, structured: dict | None = None, *, opens_view: bool = False, error: bool = False) -> CallToolResult:
    """Tool result = text for Claude (and non-UI hosts) + structured data for the View.

    Results that open a View carry an election key {createdAt, seq}. When Claude
    calls a tool twice, every copy of the View compares keys and only the newest
    stays active (see Claude docs: "Supersede older widget instances").
    """
    global _call_seq
    if opens_view and structured is not None:
        _call_seq += 1
        structured = {**structured, "createdAt": int(time.time() * 1000), "seq": _call_seq}
    return CallToolResult(content=[TextContent(type="text", text=text)], structured_content=structured, is_error=error)


def friendly(fn):
    """Turn FriendlyError (and unexpected errors) into a clear isError result instead of a stack trace."""

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except FriendlyError as e:
            return result(str(e), error=True)
        except Exception as e:  # never leak internals to the user
            print(f"[server] {fn.__name__} failed: {e!r}", file=sys.stderr)
            return result("Something went wrong on the server. Please try again.", error=True)

    return wrapper


# ---------------------------------------------------------------------------
# MCP Apps tools
# ---------------------------------------------------------------------------

apps = Apps()

# ---- Model-visible tools: Claude can call these; each one opens the View ----
# Parameters are deliberately forgiving (plain strings, all optional) so a vague
# request still opens the app instead of failing schema validation.


@apps.tool(
    resource_uri=VIEW_URI,
    title="Show solar jobs dashboard",
    description=(
        "Opens an interactive dashboard of Formbay demo solar jobs: KPI tiles, an STC-per-month chart and a jobs "
        "table. Use when the user wants to see, find, filter or manage jobs, e.g. 'show QLD jobs done by Aman'. "
        "Filter by state and/or installer. Demo data only."
    ),
)
@friendly
def show_solar_dashboard(
    region: Annotated[str, Field(description="State: NSW, VIC, QLD, SA, WA, or All")] = "All",
    installer: Annotated[str, Field(description="Installer name or part of it, e.g. 'Aman'. Empty = everyone")] = "",
    min_stcs: Annotated[int, Field(description="Only include jobs with at least this many STCs")] = 0,
) -> CallToolResult:
    if min_stcs < 0:
        raise FriendlyError("The minimum number of STCs can't be negative. Use 0 or more.")
    data = dashboard_data(normalize_state(region, allow_all=True), match_installer(installer), min_stcs)
    return result(text_summary(data), data, opens_view=True)


@apps.tool(
    resource_uri=VIEW_URI,
    title="Draft a new solar job",
    description=(
        "Opens a new-job form for a Formbay demo solar job, pre-filled with whatever details are known, so the "
        "user can complete and submit it. Every field is optional; only use this to CREATE a job, not to search."
    ),
)
@friendly
def draft_solar_job(
    customer: Annotated[str, Field(description="Customer name")] = "",
    suburb: Annotated[str, Field(description="Installation suburb")] = "",
    region: Annotated[str, Field(description="State: NSW, VIC, QLD, SA or WA")] = "",
    system_kw: Annotated[float | None, Field(description="System size in kW")] = None,
    installer: Annotated[str, Field(description="Installer name")] = "",
    notes: Annotated[str, Field(description="Installer notes, can be long")] = "",
) -> CallToolResult:
    state = normalize_state(region, allow_all=False) if region.strip() else ""
    if system_kw is not None and not 0 < system_kw <= 100:
        raise FriendlyError("System size should be between 0.1 and 100 kW.")
    stcs = estimate_stcs(system_kw, state) if system_kw and state else None
    draft = {
        "customer": customer.strip(),
        "suburb": suburb.strip(),
        "region": state,
        "systemKw": system_kw,
        "installer": match_installer(installer) if installer.strip() else "",
        "notes": notes.strip(),
        "stcs": stcs,
    }
    labels = {"customer": "customer name", "suburb": "suburb", "region": "state", "systemKw": "system size"}
    missing = [label for key, label in labels.items() if not draft[key]]
    text = "Opened the new-job form" + (f" for {draft['customer']}" if draft["customer"] else "") + "."
    text += f" Still needed from the user: {', '.join(missing)}." if missing else f" All details filled (~{stcs} STCs); waiting for the user to submit."
    return result(text, {"view": "form", "draft": draft, "missing": missing, "installers": installers()}, opens_view=True)


# ---- App-only tools: hidden from Claude, callable only by the View ----


@apps.tool(resource_uri=VIEW_URI, visibility=["app"], description="Re-fetch dashboard data for the View.")
@friendly
def refresh_dashboard(region: str = "All", installer: str = "") -> CallToolResult:
    data = dashboard_data(normalize_state(region, allow_all=True), match_installer(installer))
    return result(text_summary(data), data)


@apps.tool(resource_uri=VIEW_URI, visibility=["app"], description="Save a new demo job from the form.")
@friendly
def submit_job(customer: str, suburb: str, region: str, system_kw: float, installer: str = "", notes: str = "") -> CallToolResult:
    if not customer.strip() or not suburb.strip():
        raise FriendlyError("Please fill in the customer name and suburb.")
    if not 0 < system_kw <= 100:
        raise FriendlyError("System size should be between 0.1 and 100 kW.")
    state = normalize_state(region, allow_all=False)
    job = Job(
        id=f"FB-{1001 + len(JOBS)}",
        customer=customer.strip(),
        suburb=suburb.strip(),
        region=state,
        systemKw=system_kw,
        stcs=estimate_stcs(system_kw, state),
        status="Submitted",
        installedOn=date.today().isoformat(),
        installer=match_installer(installer) if installer.strip() else "Unassigned",
    )
    JOBS.append(job)
    return result(f"Created {job.id}", {"job": asdict(job)})


# ---------------------------------------------------------------------------
# Resources
# ---------------------------------------------------------------------------

view_html = HERE / "dist" / "mcp-app.html"
if not view_html.exists():
    sys.exit(f"Missing {view_html}. Run `npm install && npm run build` first.")

apps.add_html_resource(
    VIEW_URI,
    view_html.read_text(encoding="utf-8"),
    name="Formbay Solar Jobs",
    description="Solar jobs dashboard and new-job form",
    # Blend into the chat and let the host load its font (Claude theming guide).
    prefers_border=False,
    csp=ResourceCsp(resource_domains=["https://assets.claude.ai"]),
)

mcp = MCPServer("Formbay Solar Jobs", version="1.0.0", extensions=[apps])


if __name__ == "__main__":
    if "--stdio" in sys.argv:
        mcp.run(transport="stdio")
    else:
        import uvicorn
        from starlette.middleware.cors import CORSMiddleware

        app = mcp.streamable_http_app(stateless_http=True, host=HOST)
        app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
        print(f"Formbay MCP Apps Showcase listening on http://{HOST}:{PORT}/mcp", file=sys.stderr)
        uvicorn.run(app, host=HOST, port=PORT)
