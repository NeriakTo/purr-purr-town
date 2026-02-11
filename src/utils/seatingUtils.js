// v3.7.0: 座位表 Grid 操作純函式 (全部回傳新物件，不可變)

/** 產生格子 key */
export function cellKey(row, col) {
  return `${row}_${col}`
}

/** 解析格子 key → { row, col } */
export function parseKey(key) {
  const [r, c] = key.split('_').map(Number)
  return { row: r, col: c }
}

/** 取得未入座的學生清單 */
export function getUnassignedStudents(grid, students) {
  const placed = new Set(Object.values(grid))
  return students.filter(s => !placed.has(s.id))
}

/** 將學生放入指定格，回傳新 grid；若該格已有人則互換 */
export function placeStudent(grid, targetKey, studentId) {
  const next = { ...grid }
  // 找到該學生目前所在的格子 (若已在 grid 中)
  const currentKey = Object.keys(next).find(k => next[k] === studentId)
  const existing = next[targetKey]

  if (currentKey) {
    // 學生已在 grid 上 → 互換
    if (existing) {
      next[currentKey] = existing
    } else {
      delete next[currentKey]
    }
  }
  next[targetKey] = studentId
  return next
}

/** 互換兩格的內容 */
export function swapCells(grid, keyA, keyB) {
  const next = { ...grid }
  const a = next[keyA]
  const b = next[keyB]
  if (a) next[keyB] = a; else delete next[keyB]
  if (b) next[keyA] = b; else delete next[keyA]
  return next
}

/** 從 grid 移除某格的學生 */
export function removeFromCell(grid, key) {
  const next = { ...grid }
  delete next[key]
  return next
}

/** 放置地圖物件，同時清除該格的學生 */
export function placeObject(grid, objects, key, objectType) {
  return {
    grid: removeFromCell(grid, key),
    objects: { ...objects, [key]: objectType },
  }
}

/** 移除地圖物件 */
export function removeObject(objects, key) {
  const next = { ...objects }
  delete next[key]
  return next
}

/** 格子是否被佔用 */
export function isCellOccupied(grid, objects, key) {
  return key in grid || key in objects
}

/** 縮小 Grid 時清除超出範圍的資料 */
export function resizeGrid(grid, objects, newRows, newCols) {
  const nextGrid = {}
  const nextObjects = {}
  for (const [key, val] of Object.entries(grid)) {
    const { row, col } = parseKey(key)
    if (row < newRows && col < newCols) nextGrid[key] = val
  }
  for (const [key, val] of Object.entries(objects)) {
    const { row, col } = parseKey(key)
    if (row < newRows && col < newCols) nextObjects[key] = val
  }
  return { grid: nextGrid, objects: nextObjects }
}
