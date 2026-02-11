// v3.7.0: Excel 匯出與列印工具
import { cellKey } from './seatingUtils'
import { SEATING_OBJECTS, JOB_CATEGORIES } from './constants'

// xlsx 動態載入，降低首次載入體積
let XLSX = null
async function loadXLSX() {
  if (!XLSX) {
    XLSX = await import('xlsx')
  }
  return XLSX
}

/** 下載 workbook 為 .xlsx 檔案 */
function downloadWorkbook(workbook, filename) {
  const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([wbout], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * 匯出座位表為 Excel
 * 將 Grid 對應到 Excel 儲存格位置
 */
export async function exportSeatingToExcel(seatingChart, students, className) {
  const xlsx = await loadXLSX()
  const { rows, cols, grid, objects } = seatingChart
  const studentMap = Object.fromEntries(students.map(s => [s.id, s]))
  const objectMap = Object.fromEntries(SEATING_OBJECTS.map(o => [o.id, o]))

  // 建立二維陣列
  const data = []
  // 標題列
  data.push([`${className || '班級'} 座位表`])
  data.push([]) // 空行

  for (let r = 0; r < rows; r++) {
    const row = []
    for (let c = 0; c < cols; c++) {
      const key = cellKey(r, c)
      if (objects[key]) {
        const obj = objectMap[objects[key]]
        row.push(obj ? `${obj.icon} ${obj.label}` : objects[key])
      } else if (grid[key]) {
        const student = studentMap[grid[key]]
        row.push(student ? `${student.number}號 ${student.name}` : '')
      } else {
        row.push('')
      }
    }
    data.push(row)
  }

  const wb = xlsx.utils.book_new()
  const ws = xlsx.utils.aoa_to_sheet(data)

  // 設定欄寬
  ws['!cols'] = Array(cols).fill({ wch: 14 })

  xlsx.utils.book_append_sheet(wb, ws, '座位表')
  downloadWorkbook(wb, `${className || '班級'}_座位表.xlsx`)
}

/**
 * 匯出職務表為 Excel
 * 依 category 分為不同 Sheet
 */
export async function exportJobsToExcel(jobs, jobAssignments, students, className) {
  const xlsx = await loadXLSX()
  const studentMap = Object.fromEntries(students.map(s => [s.id, s]))
  const wb = xlsx.utils.book_new()

  const categories = ['cadre', 'cleaning', 'other']
  for (const cat of categories) {
    const catJobs = jobs.filter(j => (j.category || 'other') === cat)
    if (catJobs.length === 0) continue

    const catInfo = JOB_CATEGORIES[cat]
    const data = [
      [`${catInfo.icon} ${catInfo.label}職務表 - ${className || '班級'}`],
      [],
      ['職務名稱', '圖示', '薪資', '週期', '指派學生'],
    ]

    for (const job of catJobs) {
      const assigned = (jobAssignments[job.id] || [])
        .map(id => studentMap[id])
        .filter(Boolean)
        .map(s => `${s.number}號 ${s.name}`)
        .join('、')
      data.push([job.title, job.icon, job.salary, job.cycle, assigned || '(無)'])
    }

    const ws = xlsx.utils.aoa_to_sheet(data)
    ws['!cols'] = [{ wch: 14 }, { wch: 6 }, { wch: 8 }, { wch: 10 }, { wch: 40 }]
    xlsx.utils.book_append_sheet(wb, ws, catInfo.label)
  }

  downloadWorkbook(wb, `${className || '班級'}_職務表.xlsx`)
}

/** 觸發瀏覽器列印 */
export function triggerPrint(mode = 'seating') {
  document.body.dataset.printMode = mode
  window.print()
  delete document.body.dataset.printMode
}
