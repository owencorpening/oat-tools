#!/usr/bin/env python3
"""Weekly credential lifecycle check — reads credentials-inventory.md
directly (single source of truth, no parallel data file to drift out of
sync) and flags rows that are expiring soon, overdue for rotation, or
missing the data needed to judge either.
"""
import re
import subprocess
from datetime import date, timedelta
from pathlib import Path

INVENTORY = Path.home() / "dev/oat-standards/credentials-inventory.md"
WARN_DAYS = 14

DATE_RE = re.compile(r"\b(20\d{2}-\d{2}-\d{2})\b")
DAYS_RE = re.compile(r"(\d+)\s*days?", re.IGNORECASE)


def parse_date(cell):
    m = DATE_RE.search(cell)
    return date.fromisoformat(m.group(1)) if m else None


def is_na(cell):
    # "n/a"/"none", or either followed by explanatory text (e.g.
    # "N/A — retired, project deleted"), means tracking doesn't apply
    # here at all — distinct from "unknown", which means we should know
    # but don't. Prefix match, not exact — the inventory's own style is
    # "N/A — reasoning", never a bare "n/a".
    normalized = cell.strip().lower()
    return normalized.startswith("n/a") or normalized.startswith("none")


def parse_rows(text):
    rows = []
    in_table = False
    for line in text.splitlines():
        if line.startswith("|------"):
            in_table = True
            continue
        if in_table:
            if not line.startswith("|"):
                break
            cells = [c.strip() for c in line.strip("|").split("|")]
            if len(cells) == 7:
                rows.append(dict(zip(
                    ["name", "provider", "location", "issued", "expiry",
                     "rotation_policy", "last_rotated"], cells)))
    return rows


def check_row(row, today):
    flags = []

    # Real expiry
    if not is_na(row["expiry"]):
        exp = parse_date(row["expiry"])
        if exp:
            days_left = (exp - today).days
            if days_left <= WARN_DAYS:
                flags.append(f"expiring in {days_left}d (expiry {exp.isoformat()})")

    # Missing data — checked independent of whether a rotation policy
    # even applies, per the SOP: an unknown Last-rotated date means the
    # ledger itself is incomplete for that row. Still flagged even when
    # a fallback baseline lets the overdue check proceed below — "we're
    # missing a real record" and "here's our best-effort overdue guess"
    # are two different facts, not alternatives.
    last_rotated_cell = row["last_rotated"]
    last_rotated_missing = "unknown" in last_rotated_cell.lower() or "not rotated" in last_rotated_cell.lower()
    if last_rotated_missing:
        flags.append("Missing data (no Last rotated date)")

    if is_na(row["last_rotated"]):
        return flags  # explicitly not tracked, nothing to check further

    # Rotation-policy overdue (only when a numeric policy applies)
    if is_na(row["rotation_policy"]):
        return flags

    policy_match = DAYS_RE.search(row["rotation_policy"])
    if not policy_match:
        return flags
    policy_days = int(policy_match.group(1))

    last_rotated = parse_date(last_rotated_cell)
    baseline, baseline_label = last_rotated, "last rotated"

    if baseline is None and last_rotated_missing:
        # Fall back to Issued (verified or assumed) as the rotation
        # clock's starting point — better than never checking at all,
        # since a credential that's never been rotated has its issue
        # date as the true last time it was set.
        issued_date = parse_date(row["issued"])
        if issued_date:
            baseline, baseline_label = issued_date, "issued (no Last rotated on record)"

    if baseline:
        age_days = (today - baseline).days
        if age_days > policy_days:
            flags.append(f"rotation overdue ({age_days}d since {baseline_label}, policy {policy_days}d)")

    return flags


def main():
    today = date.today()
    rows = parse_rows(INVENTORY.read_text())

    results = []
    for row in rows:
        flags = check_row(row, today)
        if flags:
            results.append((row["name"], flags))

    if not results:
        print("Credential lifecycle: all clear, nothing expiring or overdue.")
        return

    lines = [f"{name}: {'; '.join(flags)}" for name, flags in results]
    summary = "\n".join(lines)
    print(summary)

    subprocess.run([
        "notify-send",
        f"Credential lifecycle: {len(results)} flagged",
        summary[:300],
        "-u", "critical",
    ], check=False)


if __name__ == "__main__":
    main()
