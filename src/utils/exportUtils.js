// v3.7.1: Excel 匯出與列印工具 (ExcelJS for styled export)
import { cellKey } from './seatingUtils'
import { SEATING_OBJECTS, JOB_CATEGORIES } from './constants'

// ExcelJS 動態載入，降低首次載入體積
let ExcelJS = null
async function loadExcelJS() {
  if (!ExcelJS) {
    ExcelJS = await import('exceljs')
  }
  return ExcelJS
}

/** 下載 workbook 為 .xlsx 檔案 */
async function downloadWorkbook(workbook, filename) {
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** hex color → ExcelJS ARGB format (e.g. '#A8D8B9' → 'FFA8D8B9') */
function toArgb(hex) {
  return 'FF' + hex.replace('#', '')
}

/**
 * 匯出座位表為 Excel (styled)
 * 將 Grid 對應到 Excel 儲存格位置，含色彩與格式
 */
export async function exportSeatingToExcel(seatingChart, students, className) {
  const exceljs = await loadExcelJS()
  const { rows, cols, grid, objects, customObjects, perspective } = seatingChart
  const isStudentPerspective = perspective === 'student'
  const studentMap = Object.fromEntries(students.map(s => [s.id, s]))
  const objectMap = Object.fromEntries(SEATING_OBJECTS.map(o => [o.id, o]))
  ;(customObjects || []).forEach(o => { objectMap[o.id] = o })

  const workbook = new exceljs.Workbook()
  const ws = workbook.addWorksheet('座位表')

  // --- 標題列 ---
  ws.mergeCells(1, 1, 1, Math.max(cols, 1))
  const titleCell = ws.getCell(1, 1)
  titleCell.value = `${className || '班級'} 座位表`
  titleCell.font = { bold: true, size: 16, color: { argb: toArgb('#FFFFFF') } }
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: toArgb('#7BC496') } }
  ws.getRow(1).height = 36

  // --- 空行 ---
  ws.getRow(2).height = 10

  // --- Grid 資料列（學生視角時行列鏡像） ---
  for (let ri = 0; ri < rows; ri++) {
    const r = isStudentPerspective ? (rows - 1 - ri) : ri
    const excelRow = ri + 3
    const row = ws.getRow(excelRow)
    row.height = 55

    for (let ci = 0; ci < cols; ci++) {
      const c = isStudentPerspective ? (cols - 1 - ci) : ci
      const key = cellKey(r, c)
      const cell = ws.getCell(excelRow, ci + 1)
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }

      if (objects[key]) {
        const obj = objectMap[objects[key]]
        cell.value = obj ? `${obj.icon}\n${obj.label}` : objects[key]
        const color = obj?.color || '#8B8B8B'
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: toArgb(color) } }
        cell.font = { size: 11, bold: true, color: { argb: toArgb('#FFFFFF') } }
        cell.border = {
          top: { style: 'dashed', color: { argb: toArgb(color) } },
          bottom: { style: 'dashed', color: { argb: toArgb(color) } },
          left: { style: 'dashed', color: { argb: toArgb(color) } },
          right: { style: 'dashed', color: { argb: toArgb(color) } },
        }
      } else if (grid[key]) {
        const student = studentMap[grid[key]]
        if (student) {
          cell.value = `${student.number}號\n${student.name}`
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: toArgb('#FFFFFF') } }
          cell.font = { size: 10, bold: true, color: { argb: toArgb('#5D5D5D') } }
          cell.border = {
            top: { style: 'thin', color: { argb: toArgb('#D8D8D8') } },
            bottom: { style: 'thin', color: { argb: toArgb('#D8D8D8') } },
            left: { style: 'thin', color: { argb: toArgb('#D8D8D8') } },
            right: { style: 'thin', color: { argb: toArgb('#D8D8D8') } },
          }
        }
      } else {
        cell.value = ''
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: toArgb('#FAFAFA') } }
        cell.border = {
          top: { style: 'hair', color: { argb: toArgb('#F0F0F0') } },
          bottom: { style: 'hair', color: { argb: toArgb('#F0F0F0') } },
          left: { style: 'hair', color: { argb: toArgb('#F0F0F0') } },
          right: { style: 'hair', color: { argb: toArgb('#F0F0F0') } },
        }
      }
    }
  }

  // --- 欄寬 ---
  for (let c = 1; c <= cols; c++) {
    ws.getColumn(c).width = 14
  }

  await downloadWorkbook(workbook, `${className || '班級'}_座位表.xlsx`)
}

/**
 * 匯出職務表為 Excel (styled)
 * 依 category 分為不同 Sheet
 */
export async function exportJobsToExcel(jobs, jobAssignments, students, className) {
  const exceljs = await loadExcelJS()
  const studentMap = Object.fromEntries(students.map(s => [s.id, s]))
  const workbook = new exceljs.Workbook()

  const categories = ['cadre', 'cleaning', 'other']
  for (const cat of categories) {
    const catJobs = jobs.filter(j => (j.category || 'other') === cat)
    if (catJobs.length === 0) continue

    const catInfo = JOB_CATEGORIES[cat]
    const ws = workbook.addWorksheet(catInfo.label)

    // 標題列
    ws.mergeCells(1, 1, 1, 5)
    const titleCell = ws.getCell(1, 1)
    titleCell.value = `${catInfo.icon} ${catInfo.label}職務表 - ${className || '班級'}`
    titleCell.font = { bold: true, size: 14, color: { argb: toArgb('#FFFFFF') } }
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: toArgb(catInfo.color) } }
    ws.getRow(1).height = 32

    // 空行
    ws.getRow(2).height = 8

    // 標頭列
    const headers = ['職務名稱', '圖示', '薪資', '週期', '指派學生']
    headers.forEach((h, i) => {
      const cell = ws.getCell(3, i + 1)
      cell.value = h
      cell.font = { bold: true, size: 10, color: { argb: toArgb('#5D5D5D') } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: toArgb('#F5F5F5') } }
      cell.border = { bottom: { style: 'thin', color: { argb: toArgb('#E8E8E8') } } }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
    })
    ws.getRow(3).height = 24

    // 資料列
    catJobs.forEach((job, idx) => {
      const rowNum = idx + 4
      const assigned = (jobAssignments[job.id] || [])
        .map(id => studentMap[id])
        .filter(Boolean)
        .map(s => `${s.number}號 ${s.name}`)
        .join('、')

      ws.getCell(rowNum, 1).value = job.title
      ws.getCell(rowNum, 2).value = job.icon
      ws.getCell(rowNum, 3).value = job.salary
      ws.getCell(rowNum, 4).value = job.cycle
      ws.getCell(rowNum, 5).value = assigned || '(無)'

      for (let c = 1; c <= 5; c++) {
        const cell = ws.getCell(rowNum, c)
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
        cell.border = { bottom: { style: 'hair', color: { argb: toArgb('#F0F0F0') } } }
      }
    })

    // 欄寬
    ws.getColumn(1).width = 14
    ws.getColumn(2).width = 6
    ws.getColumn(3).width = 8
    ws.getColumn(4).width = 10
    ws.getColumn(5).width = 40
  }

  await downloadWorkbook(workbook, `${className || '班級'}_職務表.xlsx`)
}

/**
 * 列印座位表 — 以獨立 HTML 視窗渲染後列印
 * v3.7.2: 支援教師視角/學生視角切換
 */
export function printSeatingChart(seatingChart, students, className) {
  const { rows, cols, grid, objects, customObjects, perspective } = seatingChart
  const isStudentPerspective = perspective === 'student'
  const studentMap = Object.fromEntries(students.map(s => [s.id, s]))
  const objectMap = Object.fromEntries(SEATING_OBJECTS.map(o => [o.id, o]))
  ;(customObjects || []).forEach(o => { objectMap[o.id] = o })

  // 構建 Grid HTML（學生視角時行列鏡像：行反轉 + 列反轉，文字保持正常）
  let gridHtml = ''
  for (let ri = 0; ri < rows; ri++) {
    const r = isStudentPerspective ? (rows - 1 - ri) : ri
    gridHtml += '<tr>'
    for (let ci = 0; ci < cols; ci++) {
      const c = isStudentPerspective ? (cols - 1 - ci) : ci
      const key = cellKey(r, c)
      if (objects[key]) {
        const obj = objectMap[objects[key]]
        const color = obj?.color || '#8B8B8B'
        const label = obj ? obj.label : objects[key]
        const icon = obj?.icon || ''
        gridHtml += `<td class="cell obj-cell" style="border-color:${color};background:${color}22">
          <span class="obj-icon">${icon}</span>
          <span class="obj-label">${label}</span>
        </td>`
      } else if (grid[key]) {
        const student = studentMap[grid[key]]
        if (student) {
          gridHtml += `<td class="cell student-cell">
            <span class="stu-num">${student.number}號</span>
            <span class="stu-name">${student.name}</span>
          </td>`
        } else {
          gridHtml += '<td class="cell empty-cell"></td>'
        }
      } else {
        gridHtml += '<td class="cell empty-cell"></td>'
      }
    }
    gridHtml += '</tr>'
  }

  const title = `${className || '班級'} 座位表`
  const podiumHtml = `<div class="podium-bar"></div><div class="podium-label">講 台</div>`

  const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
  @page { size: A4 landscape; margin: 1cm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Noto Sans TC', 'Microsoft JhengHei', 'Segoe UI', sans-serif;
    color: #5D5D5D;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .container { padding: 12px; }
  h1 {
    text-align: center;
    font-size: 22px;
    font-weight: 700;
    color: #fff;
    background: #7BC496;
    padding: 10px 0;
    border-radius: 8px;
    margin-bottom: 12px;
  }
  .podium-bar {
    width: 50%;
    height: 10px;
    margin: 0 auto 4px;
    border-radius: 999px;
    background: linear-gradient(90deg, #4A6741, #5D7E4F, #4A6741);
  }
  .podium-label {
    text-align: center;
    font-size: 10px;
    color: #8B8B8B;
    letter-spacing: 4px;
    margin-bottom: 10px;
  }
  table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 4px;
    table-layout: fixed;
  }
  .cell {
    height: 60px;
    text-align: center;
    vertical-align: middle;
    border-radius: 6px;
    padding: 4px;
  }
  .student-cell {
    background: #fff;
    border: 1.5px solid #D8D8D8;
  }
  .stu-num {
    display: block;
    font-size: 11px;
    font-weight: 700;
    color: #5D5D5D;
    line-height: 1.4;
  }
  .stu-name {
    display: block;
    font-size: 10px;
    color: #8B8B8B;
    line-height: 1.4;
  }
  .obj-cell {
    border: 2px dashed;
  }
  .obj-icon {
    display: block;
    font-size: 18px;
    line-height: 1.2;
  }
  .obj-label {
    display: block;
    font-size: 9px;
    font-weight: 600;
    color: #5D5D5D;
  }
  .empty-cell {
    background: #FAFAFA;
    border: 1px solid #F0F0F0;
  }
</style>
</head>
<body>
<div class="container">
  <h1>${title}</h1>
  ${isStudentPerspective ? '' : podiumHtml}
  <table>${gridHtml}</table>
  ${isStudentPerspective ? podiumHtml : ''}
</div>
<script>window.onload=function(){window.print()}<\/script>
</body>
</html>`

  const printWindow = window.open('', '_blank')
  if (printWindow) {
    printWindow.document.write(html)
    printWindow.document.close()
  }
}
