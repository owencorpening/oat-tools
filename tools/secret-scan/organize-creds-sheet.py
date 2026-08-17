#!/usr/bin/env python3
"""One-shot: restructure the OAT Credentials Inventory sheet from a flat
insertion-order tab into a canonical 'All' tab plus three read-only,
formula-driven views (By Location, By Provider, By Rotation Urgency).
Adds parsed helper columns (H:L) on 'All' so the Urgency view can sort
on real values instead of re-parsing free-text cells in a formula.
"""
from google.oauth2 import service_account
import google.auth.transport.requests
import requests

SPREADSHEET_ID = "1H6lDXDJ8tmF_VFmHK_HF1tP6ZJ4gVsK-1b-nnqrNtk4"
SA_FILE = "/home/owen/dev/oat-tools/credentials/service-account.json"
LAST_DATA_ROW = 22  # header row 1 + 21 data rows, confirmed via API read

DEEP_WATER_BLUE = {"red": 0, "green": 0.3725, "blue": 0.4510}
WHITE = {"red": 1, "green": 1, "blue": 1}
BAND_TINT = {"red": 0.9412, "green": 0.9686, "blue": 0.9725}


def get_token():
    creds = service_account.Credentials.from_service_account_file(
        SA_FILE,
        scopes=["https://www.googleapis.com/auth/spreadsheets"],
    )
    creds.refresh(google.auth.transport.requests.Request())
    return creds.token


def batch_update(headers, requests_body):
    r = requests.post(
        f"https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}:batchUpdate",
        headers=headers,
        json={"requests": requests_body},
    )
    if not r.ok:
        print(r.text)
    r.raise_for_status()
    return r.json()


def header_row_csv():
    cols = ["Name", "Provider", "Location", "Issued", "Expiry", "Rotation policy", "Last rotated"]
    return ",".join(f'"{c}"' for c in cols)


def main():
    token = get_token()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # 1. Rename Sheet1 -> All
    batch_update(headers, [
        {"updateSheetProperties": {
            "properties": {"sheetId": 0, "title": "All"},
            "fields": "title",
        }}
    ])
    print("Renamed Sheet1 -> All")

    # 2. Helper columns H:L on All
    helper_headers = [["Policy Days (parsed)", "Last Rotated (parsed)", "Expiry (parsed)",
                        "Urgency Bucket", "Urgency Sort Value"]]
    r = requests.put(
        f"https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}/values/All!H1:L1",
        headers=headers, params={"valueInputOption": "USER_ENTERED"},
        json={"range": "All!H1:L1", "majorDimension": "ROWS", "values": helper_headers},
    )
    r.raise_for_status()

    formula_rows = []
    for row in range(2, LAST_DATA_ROW + 1):
        formula_rows.append([
            f'=IFERROR(VALUE(REGEXEXTRACT(F{row},"(\\d+)\\s*days?")),"")',
            f'=IFERROR(DATEVALUE(REGEXEXTRACT(G{row},"\\d{{4}}-\\d{{2}}-\\d{{2}}")),"")',
            f'=IFERROR(DATEVALUE(REGEXEXTRACT(E{row},"\\d{{4}}-\\d{{2}}-\\d{{2}}")),"")',
            f'=IF(J{row}<>"",1,IF(AND(H{row}<>"",I{row}<>"",(TODAY()-I{row})>H{row}),2,3))',
            f'=IF(K{row}=1,J{row},IF(K{row}=2,-((TODAY()-I{row})-H{row}),0))',
        ])
    r = requests.put(
        f"https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}/values/All!H2:L{LAST_DATA_ROW}",
        headers=headers, params={"valueInputOption": "USER_ENTERED"},
        json={"range": f"All!H2:L{LAST_DATA_ROW}", "majorDimension": "ROWS", "values": formula_rows},
    )
    r.raise_for_status()
    print("Wrote helper columns H:L on All")

    # 3. Create the three derived sheets
    new_sheets = ["By Location", "By Provider", "By Rotation Urgency"]
    resp = batch_update(headers, [
        {"addSheet": {"properties": {"title": name}}} for name in new_sheets
    ])
    sheet_ids = {
        reply["addSheet"]["properties"]["title"]: reply["addSheet"]["properties"]["sheetId"]
        for reply in resp["replies"]
    }
    print("Created tabs:", sheet_ids)

    # 4. Populate each with a header+SORT/QUERY array formula. Exactly one
    # outer {...} pair wraps "header row ; formula result" — Sheets array
    # literal syntax, rows separated by ";".
    hdr = header_row_csv()
    formulas = {
        "By Location": f'={{{hdr};SORT(All!A2:G{LAST_DATA_ROW},3,TRUE)}}',
        "By Provider": f'={{{hdr};SORT(All!A2:G{LAST_DATA_ROW},2,TRUE)}}',
        "By Rotation Urgency": (
            f'={{{hdr};QUERY(All!A2:L{LAST_DATA_ROW},'
            f'"select A,B,C,D,E,F,G order by K asc, L asc",0)}}'
        ),
    }
    for name, formula in formulas.items():
        a1_range = f"'{name}'!A1"
        r = requests.put(
            f"https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}/values/{requests.utils.quote(a1_range)}",
            headers=headers, params={"valueInputOption": "USER_ENTERED"},
            json={"range": a1_range, "majorDimension": "ROWS", "values": [[formula]]},
        )
        if not r.ok:
            print(name, "FAILED:", r.text)
        r.raise_for_status()
    print("Wrote array formulas to derived tabs")

    # 5. Style: freeze header, bold header row on each new tab; banding on
    #    By Location / By Provider grouped by their sort column
    style_requests = []
    for name in new_sheets:
        sid = sheet_ids[name]
        style_requests += [
            {"updateSheetProperties": {
                "properties": {"sheetId": sid, "gridProperties": {"frozenRowCount": 1}},
                "fields": "gridProperties.frozenRowCount",
            }},
            {"repeatCell": {
                "range": {"sheetId": sid, "startRowIndex": 0, "endRowIndex": 1},
                "cell": {"userEnteredFormat": {
                    "backgroundColor": DEEP_WATER_BLUE,
                    "textFormat": {"foregroundColor": WHITE, "bold": True},
                }},
                "fields": "userEnteredFormat(backgroundColor,textFormat)",
            }},
        ]

    # Group banding: By Location bands on column C, By Provider on column B
    band_specs = [("By Location", "C"), ("By Provider", "B")]
    for name, col in band_specs:
        sid = sheet_ids[name]
        style_requests.append({
            "addConditionalFormatRule": {
                "rule": {
                    "ranges": [{"sheetId": sid, "startRowIndex": 1, "endRowIndex": LAST_DATA_ROW,
                                "startColumnIndex": 0, "endColumnIndex": 7}],
                    "booleanRule": {
                        "condition": {
                            "type": "CUSTOM_FORMULA",
                            "values": [{"userEnteredValue": f'=ISEVEN(COUNTUNIQUE(${col}$2:${col}2))'}],
                        },
                        "format": {"backgroundColor": BAND_TINT},
                    },
                },
                "index": 0,
            }
        })

    batch_update(headers, style_requests)
    print("Applied styling + banding")

    print(f"\nDone: https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit")


if __name__ == "__main__":
    main()
