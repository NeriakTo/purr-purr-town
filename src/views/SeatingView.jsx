// v3.7.0: 座位表全螢幕編輯器
import { useEffect, useState, useMemo, useCallback } from 'react'
import { DndContext, DragOverlay, PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors } from '@dnd-kit/core'
import SeatingGrid from '../components/seating/SeatingGrid'
import SeatingToolbar from '../components/seating/SeatingToolbar'
import SeatingWaitingList from '../components/seating/SeatingWaitingList'
import AvatarEmoji from '../components/common/AvatarEmoji'
import { DEFAULT_SEATING_CHART, SEATING_OBJECTS } from '../utils/constants'
import { getUnassignedStudents, placeStudent, placeObject, removeObject, resizeGrid } from '../utils/seatingUtils'
import { exportSeatingToExcel, triggerPrint } from '../utils/exportUtils'

const objectMap = Object.fromEntries(SEATING_OBJECTS.map(o => [o.id, o]))

function SeatingView({ students, seatingChart, className, onClose, onSave }) {
  // v3.7.1: 清除不在 students 列表中的已放置學生（處理在家自學排除）
  const validStudentIds = useMemo(() => new Set(students.map(s => s.id)), [students])

  // 本地編輯狀態 (關閉時回存)
  const [chart, setChart] = useState(() => {
    const baseGrid = { ...(seatingChart?.grid || {}) }
    // 移除不在有效名單中的學生
    const cleanGrid = Object.fromEntries(
      Object.entries(baseGrid).filter(([, sid]) => validStudentIds.has(sid))
    )
    return {
      ...DEFAULT_SEATING_CHART,
      ...seatingChart,
      grid: cleanGrid,
      objects: { ...(seatingChart?.objects || {}) },
      customObjects: [...(seatingChart?.customObjects || [])],
    }
  })
  const [activeDrag, setActiveDrag] = useState(null) // { type: 'student', id } | { type: 'object', objectType, icon, label }

  // Escape 關閉 + 鎖定滾動
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') handleClose() }
    window.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 合併預設與自訂物件的查找表
  const allObjectMap = useMemo(() => {
    const map = { ...objectMap }
    ;(chart.customObjects || []).forEach(o => { map[o.id] = o })
    return map
  }, [chart.customObjects])

  // 未入座學生
  const unassigned = useMemo(
    () => getUnassignedStudents(chart.grid, students),
    [chart.grid, students]
  )

  // 取得正在拖曳的學生物件
  const draggedStudent = useMemo(() => {
    if (!activeDrag || activeDrag.type !== 'student') return null
    return students.find(s => s.id === activeDrag.id) || null
  }, [activeDrag, students])

  // 關閉並儲存
  const handleClose = useCallback(() => {
    onSave(chart)
    onClose()
  }, [chart, onSave, onClose])

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor)
  )

  const handleDragStart = useCallback((event) => {
    const { active } = event
    const data = active.data?.current
    if (data?.type === 'object') {
      setActiveDrag({ type: 'object', objectType: data.objectType, icon: data.icon, label: data.label })
    } else if (data?.studentId) {
      setActiveDrag({ type: 'student', id: data.studentId })
    }
  }, [])

  const handleDragEnd = useCallback((event) => {
    const { active, over } = event
    setActiveDrag(null)

    if (!over) return

    const activeData = active.data?.current
    const overData = over.data?.current

    if (!activeData || !overData) return

    // 目的地必須是格子
    if (overData.type !== 'cell') return
    const targetKey = overData.cellKey

    // 物件拖放
    if (activeData.type === 'object') {
      // 不能放到有學生的格子
      if (chart.grid[targetKey]) return
      setChart(prev => {
        const result = placeObject(prev.grid, prev.objects, targetKey, activeData.objectType)
        return { ...prev, grid: result.grid, objects: result.objects }
      })
      return
    }

    // 學生拖放
    const studentId = activeData.studentId
    if (!studentId) return

    // 不能放到地圖物件上
    if (chart.objects[targetKey]) return
    setChart(prev => ({ ...prev, grid: placeStudent(prev.grid, targetKey, studentId) }))
  }, [chart.grid, chart.objects])

  // 移除地圖物件
  const handleRemoveObject = useCallback((key) => {
    setChart(prev => ({ ...prev, objects: removeObject(prev.objects, key) }))
  }, [])

  // 行列變更
  const handleRowsChange = useCallback((newRows) => {
    setChart(prev => {
      const { grid, objects } = resizeGrid(prev.grid, prev.objects, newRows, prev.cols)
      return { ...prev, rows: newRows, grid, objects }
    })
  }, [])

  const handleColsChange = useCallback((newCols) => {
    setChart(prev => {
      const { grid, objects } = resizeGrid(prev.grid, prev.objects, prev.rows, newCols)
      return { ...prev, cols: newCols, grid, objects }
    })
  }, [])

  // 清空座位
  const handleClearAll = useCallback(() => {
    setChart(prev => ({ ...prev, grid: {}, objects: {} }))
  }, [])

  // 視角切換
  const handlePerspectiveChange = useCallback((p) => {
    setChart(prev => ({ ...prev, perspective: p }))
  }, [])

  // 匯出 Excel
  const handleExport = useCallback(() => {
    exportSeatingToExcel(chart, students, className)
  }, [chart, students, className])

  // 列印
  const handlePrint = useCallback(() => {
    triggerPrint('seating')
  }, [])

  // 自訂物件管理
  const handleAddCustomObject = useCallback((obj) => {
    setChart(prev => ({ ...prev, customObjects: [...prev.customObjects, obj] }))
  }, [])

  const handleRemoveCustomObject = useCallback((objId) => {
    setChart(prev => ({
      ...prev,
      customObjects: prev.customObjects.filter(o => o.id !== objId),
      // 也從已放置的物件中移除
      objects: Object.fromEntries(
        Object.entries(prev.objects).filter(([, type]) => type !== objId)
      ),
    }))
  }, [])

  return (
    <div className="fixed inset-0 z-50 bg-[#fdfbf7] flex flex-col" data-print-mode="seating">
      {/* 工具列 */}
      <SeatingToolbar
        rows={chart.rows}
        cols={chart.cols}
        perspective={chart.perspective}
        onRowsChange={handleRowsChange}
        onColsChange={handleColsChange}
        onPerspectiveChange={handlePerspectiveChange}
        onClearAll={handleClearAll}
        onExport={handleExport}
        onPrint={handlePrint}
        onClose={handleClose}
      />

      {/* 主體 */}
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex-1 flex overflow-hidden">
          {/* 左側面板 */}
          <SeatingWaitingList
            students={unassigned}
            customObjects={chart.customObjects}
            onAddCustomObject={handleAddCustomObject}
            onRemoveCustomObject={handleRemoveCustomObject}
            className="w-52 shrink-0 print:hidden"
          />

          {/* 中間 Grid */}
          <div className="flex-1 overflow-auto flex flex-col items-center print:overflow-visible">
            {/* 列印標題 */}
            <div className="hidden print:block text-center mb-4 w-full">
              <h1 className="text-2xl font-bold text-[#5D5D5D]">{className || '班級'} 座位表</h1>
            </div>

            <div className="flex-1 p-6 flex items-start justify-center print:p-0">
              <SeatingGrid
                rows={chart.rows}
                cols={chart.cols}
                grid={chart.grid}
                objects={chart.objects}
                students={students}
                perspective={chart.perspective}
                onRemoveObject={handleRemoveObject}
                customObjectMap={allObjectMap}
              />
            </div>
          </div>
        </div>

        {/* 拖曳 Overlay */}
        <DragOverlay dropAnimation={null}>
          {activeDrag?.type === 'student' && draggedStudent ? (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border-2 border-[#7BC496] shadow-xl print:hidden">
              <AvatarEmoji seed={draggedStudent.id} className="w-8 h-8 rounded-full" emojiClassName="text-base" />
              <span className="text-sm font-bold text-[#5D5D5D]">{draggedStudent.number}號 {draggedStudent.name}</span>
            </div>
          ) : null}
          {activeDrag?.type === 'object' ? (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border-2 border-[#7BC496] shadow-xl print:hidden">
              <span className="text-xl">{activeDrag.icon}</span>
              <span className="text-sm font-bold text-[#5D5D5D]">{activeDrag.label}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}

export default SeatingView
