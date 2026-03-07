// Purr Purr Town Backup API v2 — Chunked Storage + Integrity Check

const SHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();
const SETTINGS_COLS = { KEY: 0, VALUE: 1 };
const CHUNK_SIZE = 40000; // 40K chars per chunk (safe under 50K cell limit)

// Token（可自行改）
const TOKEN = "meow1234";

function ensureSettingsSheet(ss) {
  let sheet = ss.getSheetByName("Settings");
  if (!sheet) {
    sheet = ss.insertSheet("Settings");
    sheet.appendRow(["Key", "Value"]);
  }
  return sheet;
}

// --- Helper: read/write/delete rows by key ---

function findRow(rows, key) {
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][SETTINGS_COLS.KEY] === key) return i + 1; // 1-based sheet row
  }
  return -1;
}

function upsertRow(sheet, rows, key, value) {
  const rowIndex = findRow(rows, key);
  if (rowIndex === -1) {
    sheet.appendRow([key, value]);
  } else {
    sheet.getRange(rowIndex, SETTINGS_COLS.VALUE + 1).setValue(value);
  }
}

function deleteRowsByPrefix(sheet, prefix) {
  const rows = sheet.getDataRange().getValues();
  // Delete from bottom to top to preserve indices
  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][SETTINGS_COLS.KEY]).startsWith(prefix)) {
      sheet.deleteRow(i + 1);
    }
  }
}

// --- Chunked write: split large JSON into multiple cells ---

function writeChunked(sheet, classId, payloadStr) {
  const chunkPrefix = `backup_${classId}_chunk_`;

  // Clean up old chunks first
  deleteRowsByPrefix(sheet, chunkPrefix);

  // Also clean up legacy single-cell key if exists
  const rows = sheet.getDataRange().getValues();
  const legacyRow = findRow(rows, `backup_${classId}`);
  if (legacyRow !== -1) {
    sheet.deleteRow(legacyRow);
  }

  // Write new chunks
  const totalChunks = Math.ceil(payloadStr.length / CHUNK_SIZE);
  for (let i = 0; i < totalChunks; i++) {
    const chunk = payloadStr.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    sheet.appendRow([`${chunkPrefix}${i}`, chunk]);
  }

  return totalChunks;
}

// --- Chunked read: reassemble from multiple cells ---

function readChunked(sheet, classId) {
  const rows = sheet.getDataRange().getValues();
  const chunkPrefix = `backup_${classId}_chunk_`;

  // Collect all chunks
  const chunks = [];
  for (let i = 1; i < rows.length; i++) {
    const key = String(rows[i][SETTINGS_COLS.KEY]);
    if (key.startsWith(chunkPrefix)) {
      const idx = parseInt(key.substring(chunkPrefix.length), 10);
      chunks[idx] = rows[i][SETTINGS_COLS.VALUE];
    }
  }

  // If chunks found, reassemble
  if (chunks.length > 0 && chunks[0] !== undefined) {
    return chunks.join('');
  }

  // Fallback: try legacy single-cell format
  const legacyRow = findRow(rows, `backup_${classId}`);
  if (legacyRow !== -1) {
    return String(rows[legacyRow - 1][SETTINGS_COLS.VALUE]);
  }

  return null;
}

// --- API Endpoints ---

function doGet(e) {
  const action = e.parameter.action;
  const token = e.parameter.token;
  const ss = SpreadsheetApp.openById(SHEET_ID);

  if (token !== TOKEN) return response({ success: false, message: "Invalid token" });

  if (action === "backup_download") {
    const classId = e.parameter.classId;
    if (!classId) return response({ success: false, message: "Missing classId" });

    const sheet = ensureSettingsSheet(ss);
    const raw = readChunked(sheet, classId);

    if (!raw) return response({ success: false, message: "No backup found" });

    let data = null;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      return response({ success: false, message: "Backup data corrupted: " + err.message });
    }

    // Return with integrity info for client verification
    const integrity = {
      students: (data.students || []).length,
      logs: (data.logs || []).length,
      bytes: raw.length,
      updatedAt: data.updatedAt || null
    };

    return response({ success: true, data, integrity });
  }

  return response({ success: false, message: "Unknown action" });
}

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return response({ success: false, message: "Invalid JSON body" });
  }

  const ss = SpreadsheetApp.openById(SHEET_ID);

  if (data.token !== TOKEN) return response({ success: false, message: "Invalid token" });

  if (data.action === "backup_upload") {
    const { classId, className, data: payload } = data;
    if (!classId || !payload) return response({ success: false, message: "Missing payload" });

    const sheet = ensureSettingsSheet(ss);
    const payloadStr = JSON.stringify(payload);

    // Write chunked data
    const totalChunks = writeChunked(sheet, classId, payloadStr);

    // Write meta (includes integrity info for verification)
    const meta = {
      classId,
      className: className || "",
      updatedAt: payload.updatedAt || new Date().toISOString(),
      integrity: {
        students: (payload.students || []).length,
        logs: (payload.logs || []).length,
        bytes: payloadStr.length,
        chunks: totalChunks
      }
    };
    const metaKey = `backup_${classId}_meta`;
    const freshRows = sheet.getDataRange().getValues();
    upsertRow(sheet, freshRows, metaKey, JSON.stringify(meta));

    return response({ success: true, meta });
  }

  return response({ success: false, message: "Unknown action" });
}

function response(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
