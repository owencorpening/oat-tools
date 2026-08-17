#!/usr/bin/env python3
"""One-shot: render credentials-inventory.md's table into an existing
Google Sheet (created and shared with the service account by Owen —
bare service accounts under a personal Gmail project have no Drive
storage quota of their own, so they can write to a shared file but
can't create new ones). Uses the table-tools service account (Sheets +
Drive scopes already granted) rather than the oat-promote-tables
Worker, since the Worker unconditionally makes sheets public — wrong
for this data.
"""
import re
import sys
from pathlib import Path

import requests
from google.oauth2 import service_account
import google.auth.transport.requests

INVENTORY = Path.home() / "dev/oat-standards/credentials-inventory.md"
SA_FILE = Path.home() / "dev/oat-tools/credentials/service-account.json"
SPREADSHEET_ID = "1H6lDXDJ8tmF_VFmHK_HF1tP6ZJ4gVsK-1b-nnqrNtk4"

DEEP_WATER_BLUE = {"red": 0, "green": 0.3725, "blue": 0.4510}
WHITE = {"red": 1, "green": 1, "blue": 1}
ROW_TINT = {"red": 0.9412, "green": 0.9686, "blue": 0.9725}


def get_token():
    creds = service_account.Credentials.from_service_account_file(
        str(SA_FILE),
        scopes=[
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/drive",
        ],
    )
    creds.refresh(google.auth.transport.requests.Request())
    return creds.token


def parse_table(text):
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
            rows.append(cells)
    header = ["Name", "Provider", "Location", "Issued", "Expiry",
              "Rotation policy", "Last rotated"]
    return [header] + rows


def strip_markdown(cell):
    return re.sub(r"[`*]", "", cell)


def main():
    token = get_token()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    values = [[strip_markdown(c) for c in row] for row in parse_table(INVENTORY.read_text())]
    num_rows = len(values)
    num_cols = len(values[0])

    # Use the existing sheet (Owen created + shared it with the service
    # account as Editor) — fetch its first tab's sheetId for styling calls
    spreadsheet_id = SPREADSHEET_ID
    r = requests.get(
        f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}",
        headers=headers,
    )
    r.raise_for_status()
    sheet_id = r.json()["sheets"][0]["properties"]["sheetId"]
    sheet_title = r.json()["sheets"][0]["properties"]["title"]

    # Write values
    end_col = chr(ord("A") + num_cols - 1)
    a1_range = f"{sheet_title}!A1:{end_col}{num_rows}"
    r = requests.put(
        f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values/{a1_range}",
        headers=headers,
        params={"valueInputOption": "RAW"},
        json={"range": a1_range, "majorDimension": "ROWS", "values": values},
    )
    r.raise_for_status()

    # Style: bold header, frozen row, alternating tint, autosize columns
    requests_body = [
        {"repeatCell": {
            "range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": 1},
            "cell": {"userEnteredFormat": {
                "backgroundColor": DEEP_WATER_BLUE,
                "textFormat": {"foregroundColor": WHITE, "bold": True},
            }},
            "fields": "userEnteredFormat(backgroundColor,textFormat)",
        }},
        {"updateSheetProperties": {
            "properties": {"sheetId": sheet_id, "gridProperties": {"frozenRowCount": 1}},
            "fields": "gridProperties.frozenRowCount",
        }},
        {"autoResizeDimensions": {
            "dimensions": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 0, "endIndex": num_cols}
        }},
    ]
    for i in range(1, num_rows):
        if i % 2 == 0:
            requests_body.append({"repeatCell": {
                "range": {"sheetId": sheet_id, "startRowIndex": i, "endRowIndex": i + 1},
                "cell": {"userEnteredFormat": {"backgroundColor": ROW_TINT}},
                "fields": "userEnteredFormat.backgroundColor",
            }})
    r = requests.post(
        f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}:batchUpdate",
        headers=headers,
        json={"requests": requests_body},
    )
    r.raise_for_status()

    url = f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit"
    print(f"Populated: {url}")


if __name__ == "__main__":
    main()
