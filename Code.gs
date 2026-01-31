// Purr Purr Town Backup API (Settings Table Only)

const SHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();
const SETTINGS_COLS = { KEY: 0, VALUE: 1 };

// ✅ Token（可自行改）
const TOKEN = "meow1234";

function ensureSettingsSheet(ss) {
  let sheet = ss.getSheetByName("Settings");
  if (!sheet) {
    sheet = ss.insertSheet("Settings");
    sheet.appendRow(["Key", "Value"]);
  }
  return sheet;
}

function doGet(e) {
  const action = e.parameter.action;
  const token = e.parameter.token;
  const ss = SpreadsheetApp.openById(SHEET_ID);

  // Token 驗證
  if (token !== TOKEN) return response({ success: false, message: "Invalid token" });

  // 下載備份（單一班級）
  if (action === "backup_download") {
    const classId = e.parameter.classId;
    if (!classId) return response({ success: false, message: "Missing classId" });

    const sheet = ensureSettingsSheet(ss);
    const rows = sheet.getDataRange().getValues();
    const key = `backup_${classId}`;
    let value = null;

    for (let i = 1; i < rows.length; i++) {
      if (rows[i][SETTINGS_COLS.KEY] === key) {
        value = rows[i][SETTINGS_COLS.VALUE];
        break;
      }
    }

    if (!value) return response({ success: false, message: "No backup found" });

    let data = null;
    try { data = JSON.parse(value); } catch (e) {}

    return response({ success: true, data });
  }

  return response({ success: false, message: "Unknown action" });
}

function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const ss = SpreadsheetApp.openById(SHEET_ID);

  // Token 驗證
  if (data.token !== TOKEN) return response({ success: false, message: "Invalid token" });

  // 上傳備份（單一班級）
  if (data.action === "backup_upload") {
    const { classId, className, data: payload } = data;
    if (!classId || !payload) return response({ success: false, message: "Missing payload" });

    const sheet = ensureSettingsSheet(ss);
    const rows = sheet.getDataRange().getValues();
    const key = `backup_${classId}`;
    const metaKey = `backup_${classId}_meta`;
    const payloadStr = JSON.stringify(payload);
    const metaStr = JSON.stringify({
      classId,
      className: className || "",
      updatedAt: payload.updatedAt || new Date().toISOString()
    });

    let rowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][SETTINGS_COLS.KEY] === key) {
        rowIndex = i + 1;
        break;
      }
    }

    if (rowIndex === -1) {
      sheet.appendRow([key, payloadStr]);
    } else {
      sheet.getRange(rowIndex, SETTINGS_COLS.VALUE + 1).setValue(payloadStr);
    }

    // meta
    let metaIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][SETTINGS_COLS.KEY] === metaKey) {
        metaIndex = i + 1;
        break;
      }
    }

    if (metaIndex === -1) {
      sheet.appendRow([metaKey, metaStr]);
    } else {
      sheet.getRange(metaIndex, SETTINGS_COLS.VALUE + 1).setValue(metaStr);
    }

    return response({ success: true });
  }

  return response({ success: false, message: "Unknown action" });
}

function response(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
