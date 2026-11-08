// OAT: Promote Tables — Google Apps Script web app
//
// RETIRED 2026-11-08 (#10): replaced by the Cloudflare Worker in ../worker/.
// All web-app deployments were archived because they ran with "Anyone"
// access and no auth. Kept for reference only. Do not redeploy as written.
// Returns: { spreadsheetId, sheetUrl } on success, { error } on failure

var DEEP_WATER_BLUE = '#005f73';
var WHITE           = '#ffffff';
var LIGHT_TEAL      = '#94d2bd';
var ROW_TINT        = '#f0f7f8';

function doPost(e) {
  try {
    var data    = JSON.parse(e.postData.contents);
    var title   = data.title;
    var headers = data.headers;
    var rows    = data.rows;

    if (!title || !headers || !rows) {
      throw new Error('Missing required fields: title, headers, rows');
    }

    var ss    = SpreadsheetApp.create(title);
    var sheet = ss.getSheets()[0];
    sheet.setName('Sheet1');

    var allRows = [headers].concat(rows);
    sheet.getRange(1, 1, allRows.length, headers.length).setValues(allRows);

    applyOatStyle(sheet, headers.length, rows.length);

    DriveApp.getFileById(ss.getId()).setSharing(
      DriveApp.Access.ANYONE_WITH_LINK,
      DriveApp.Permission.VIEW
    );

    return ContentService
      .createTextOutput(JSON.stringify({
        spreadsheetId: ss.getId(),
        sheetUrl:      ss.getUrl()
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function applyOatStyle(sheet, numCols, numDataRows) {
  // Header row
  var header = sheet.getRange(1, 1, 1, numCols);
  header.setBackground(DEEP_WATER_BLUE);
  header.setFontColor(WHITE);
  header.setFontWeight('bold');
  header.setFontSize(11);
  header.setFontFamily('Arial');
  header.setBorder(
    null, null, true, null, null, null,
    LIGHT_TEAL, SpreadsheetApp.BorderStyle.SOLID_MEDIUM
  );

  // Data rows — alternating background
  for (var i = 0; i < numDataRows; i++) {
    var row = sheet.getRange(i + 2, 1, 1, numCols);
    row.setBackground(i % 2 === 0 ? WHITE : ROW_TINT);
    row.setFontFamily('Arial');
    row.setFontSize(10);
  }

  // Vertical column borders (between columns, not outer edges)
  for (var col = 1; col < numCols; col++) {
    sheet.getRange(1, col, numDataRows + 1, 1).setBorder(
      null, null, null, true, null, null,
      LIGHT_TEAL, SpreadsheetApp.BorderStyle.SOLID
    );
  }

  // Polish
  sheet.setFrozenRows(1);
  for (var r = 1; r <= numDataRows + 1; r++) {
    sheet.setRowHeight(r, 32);
  }
  sheet.autoResizeColumns(1, numCols);
}
