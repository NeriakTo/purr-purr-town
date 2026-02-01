import { useMemo, useState } from 'react'
import { X, AlertCircle, Pencil, Clock, XCircle, AlertTriangle, Check, ScrollText } from 'lucide-react'
import AvatarEmoji from '../common/AvatarEmoji'
import { STATUS_VALUES } from '../../utils/constants'
import { formatDate, formatDateDisplay, getTaskDueDate, getTodayStr, isDoneStatus, normalizeStatus, parseDate, getTaskIcon, getStatusVisual } from '../../utils/helpers'

function PassportModal({ student, tasks, studentStatus, onClose, onToggleStatus, onStudentUpdate, hasOverdue, settings, allLogs, currentDateStr }) {
  const [isEditMode, setIsEditMode] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [editData, setEditData] = useState({ name: student.name || '', gender: student.gender || 'male', group: student.group || 'A' })
  const status = studentStatus[student.id] || {}
  const hasTasks = tasks.length > 0
  const completedCount = tasks.filter(t => isDoneStatus(status[t.id])).length
  const isAllDone = hasTasks && completedCount === tasks.length

  const overdueItems = useMemo(() => {
    if (!allLogs) return []
    const today = parseDate(getTodayStr())
    const items = []
    allLogs.forEach(log => {
      const logDateStr = typeof log.date === 'string' ? log.date.split('T')[0] : formatDate(log.date)
      if (!logDateStr) return
      const logTasks = log.tasks || []
      const logStatus = log.status?.[student.id] || {}
      logTasks.forEach(task => {
        const dueDate = getTaskDueDate(task, logDateStr)
        if (parseDate(dueDate) >= today) return
        if (!isDoneStatus(logStatus[task.id])) {
          items.push({ date: logDateStr, dueDate, task })
        }
      })
    })
    return items
  }, [allLogs, student.id])

  const historyItems = useMemo(() => {
    if (!allLogs) return []
    const items = []
    allLogs.forEach(log => {
      const logDateStr = typeof log.date === 'string' ? log.date.split('T')[0] : formatDate(log.date)
      if (!logDateStr) return
      const logTasks = log.tasks || []
      const logStatus = log.status?.[student.id] || {}
      logTasks.forEach(task => {
        items.push({ date: logDateStr, task, completed: isDoneStatus(logStatus[task.id]) })
      })
    })
    return items.sort((a, b) => new Date(b.date) - new Date(a.date))
  }, [allLogs, student.id])

  const saveEdit = () => {
    if (!editData.name.trim()) return
    const updatedStudent = { ...student, id: student.id || student.uuid, name: editData.name.trim(), group: editData.group, gender: editData.gender }
    if (onStudentUpdate) onStudentUpdate(updatedStudent)
    setIsEditMode(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative bg-[#fdfbf7] rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="h-3" style={{ background: 'repeating-linear-gradient(90deg, #A8D8B9, #A8D8B9 20px, #FFD6A5 20px, #FFD6A5 40px)' }} />
        <button onClick={onClose} className="absolute top-6 right-4 p-2 rounded-full bg-white/80 hover:bg-white shadow-md z-10">
          <X size={20} className="text-[#5D5D5D]" />
        </button>
        
        <div className="p-6">
          {/* 欠交警示 */}
          {hasOverdue && (
            <div className="mb-4 p-3 rounded-xl bg-[#FFADAD]/20 border-2 border-[#D64545] text-[#D64545] text-sm flex items-start gap-2">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              <span>⚠️ 尚有過去任務未完成，請檢查歷史日誌</span>
            </div>
          )}
          
          {/* 頭像和基本資料 */}
          <div className="flex items-start gap-6 mb-6">
            <div className={`w-28 h-28 rounded-3xl overflow-hidden shadow-lg shrink-0 ring-4 ${isAllDone ? 'ring-[#A8D8B9]' : hasTasks ? 'ring-[#FFD6A5]' : 'ring-[#E8E8E8]'}`}>
              <AvatarEmoji seed={student.uuid || student.id} className="w-full h-full rounded-3xl text-5xl" />
            </div>
            <div className="flex-1">
              {isEditMode ? (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={editData.name}
                    onChange={e => setEditData(p => ({...p, name: e.target.value}))}
                    className="w-full px-3 py-2 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none"
                    placeholder="村民姓名"
                  />
                  <select
                    value={editData.group}
                    onChange={e => setEditData(p => ({...p, group: e.target.value}))}
                    className="w-full px-3 py-2 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none"
                  >
                    {['A', 'B', 'C', 'D', 'E', 'F'].map(g => (
                      <option key={g} value={g}>{settings?.groupAliases?.[g] || `${g} 小隊`}</option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <button onClick={saveEdit} className="flex-1 bg-[#A8D8B9] text-white py-2 rounded-xl font-medium">儲存</button>
                    <button onClick={() => setIsEditMode(false)} className="bg-[#E8E8E8] text-[#5D5D5D] px-4 py-2 rounded-xl">取消</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm px-2 py-0.5 rounded-full bg-[#FFD6A5]/30 text-[#8B6914] font-medium">
                      {student.number} 號
                    </span>
                    <span className="text-sm px-2 py-0.5 rounded-full bg-[#A8D8B9]/30 text-[#4A7C59] font-medium">
                      {settings?.groupAliases?.[student.group] || `${student.group || 'A'} 小隊`}
                    </span>
                  </div>
                  <h3 className="text-2xl font-bold mb-2 text-[#5D5D5D]">{student.name}</h3>
                  <button
                    onClick={() => { setEditData({ name: student.name, gender: student.gender, group: student.group }); setIsEditMode(true) }}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#FFD6A5]/30 text-[#8B6914] text-sm font-medium hover:bg-[#FFD6A5]/50 transition-colors"
                  >
                    <Pencil size={14} />編輯資料
                  </button>
                  
                  {/* 完成統計 */}
                  {hasTasks && (
                    <div className="mt-3 flex items-center gap-2">
                      <div className="flex-1 h-2 bg-[#E8E8E8] rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${(completedCount / tasks.length) * 100}%`,
                            background: isAllDone ? '#7BC496' : '#FFBF69'
                          }}
                        />
                      </div>
                      <span className="text-sm font-medium text-[#5D5D5D]">{completedCount}/{tasks.length}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
          
          {/* 任務列表 */}
          <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
            {tasks.length === 0 ? (
              <div className="text-center py-8 bg-[#F9F9F9] rounded-2xl">
                <div className="text-4xl mb-2">😸</div>
                <p className="text-[#8B8B8B]">今日暫無任務</p>
              </div>
            ) : (
              tasks.map(task => {
                const IconComponent = getTaskIcon(task.title)
                const statusValue = status[task.id]
                const isCompleted = isDoneStatus(statusValue)
                const visual = getStatusVisual(statusValue)
                const StatusIcon = visual.icon

                return (
                  <div
                    key={task.id}
                    className={`flex items-center gap-4 p-4 rounded-2xl transition-all border-2 ${visual.bg} ${visual.border}`}
                  >
                    <div
                      onClick={() => onToggleStatus(student.id, task.id, isCompleted ? false : true)}
                      className="cursor-pointer flex items-center gap-3 flex-1 min-w-0"
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0`}
                        style={{ background: isCompleted ? visual.color : '#FFD6A5' }}>
                        <IconComponent size={18} className="text-white" />
                      </div>
                      <span className={`flex-1 font-medium ${isCompleted ? `${visual.text} line-through` : 'text-[#5D5D5D]'}`}>
                        {task.title}
                      </span>
                      {visual.label && StatusIcon && (
                        <span className={`text-xs px-2 py-1 rounded-full ${visual.bg} ${visual.text} font-bold flex items-center gap-1`}>
                          <StatusIcon size={12} />{visual.label}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleStatus(student.id, task.id, STATUS_VALUES.LATE); }}
                        className="px-2 py-1 text-xs rounded-lg bg-[#FFD6A5]/30 text-[#8B6914] hover:bg-[#FFD6A5] flex items-center gap-0.5"
                        title="遲交"
                      >
                        <Clock size={12} />遲交
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleStatus(student.id, task.id, STATUS_VALUES.MISSING); }}
                        className="px-2 py-1 text-xs rounded-lg bg-[#FFADAD]/30 text-[#D64545] hover:bg-[#FFADAD] flex items-center gap-0.5"
                        title="未交"
                      >
                        <XCircle size={12} />未交
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleStatus(student.id, task.id, 'leave'); }}
                        className="px-2 py-1 text-xs rounded-lg bg-[#E8E8E8] text-[#5D5D5D] hover:bg-[#D8D8D8]"
                      >
                        請假
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleStatus(student.id, task.id, 'exempt'); }}
                        className="px-2 py-1 text-xs rounded-lg bg-[#F0F0F0] text-[#A0A0A0] hover:bg-[#E0E0E0]"
                      >
                        免交
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {overdueItems.length > 0 && (
            <div className="mt-4 p-4 rounded-2xl border-2 border-[#FFADAD] bg-[#FFADAD]/10">
              <div className="font-bold text-[#D64545] mb-2">⚠️ 尚有未完成的歷史任務</div>
              <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                {overdueItems.map((item, idx) => (
                  <label
                    key={`${item.date || 'no-date'}-${item.task.id || 'no-id'}-${idx}`}
                    className="flex items-center gap-3 p-3 rounded-xl bg-white border-2 border-transparent hover:border-[#FFADAD]/40 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={false}
                      onChange={e => onToggleStatus(student.id, item.task.id, e.target.checked, item.date)}
                      className="sr-only"
                    />
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#FFADAD]/60 text-white">
                      <AlertTriangle size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-[#D64545] truncate">{item.task.title}</div>
                      <div className="text-xs text-[#8B8B8B]">日期：{formatDateDisplay(item.date)}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleStatus(student.id, item.task.id, STATUS_VALUES.LATE, item.date); }}
                        className="px-2 py-1 text-xs rounded-lg bg-[#FFD6A5]/30 text-[#8B6914] hover:bg-[#FFD6A5] flex items-center gap-0.5"
                      >
                        <Clock size={10} />補交
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleStatus(student.id, item.task.id, STATUS_VALUES.MISSING, item.date); }}
                        className="px-2 py-1 text-xs rounded-lg bg-[#FFADAD]/30 text-[#D64545] hover:bg-[#FFADAD]/50 flex items-center gap-0.5"
                      >
                        <XCircle size={10} />未交
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleStatus(student.id, item.task.id, 'leave', item.date); }}
                        className="px-2 py-1 text-xs rounded-lg bg-[#E8E8E8] text-[#5D5D5D] hover:bg-[#D8D8D8]"
                      >
                        請假
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleStatus(student.id, item.task.id, 'exempt', item.date); }}
                        className="px-2 py-1 text-xs rounded-lg bg-[#F0F0F0] text-[#A0A0A0] hover:bg-[#E0E0E0]"
                      >
                        免交
                      </button>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {showHistory && (
            <div className="mt-4 p-4 rounded-2xl bg-[#F9F9F9] border border-[#E8E8E8]">
              <div className="font-bold text-[#5D5D5D] mb-3">📊 該生完整任務紀錄</div>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {historyItems.length === 0 ? (
                  <div className="text-sm text-[#8B8B8B]">尚無歷史紀錄。</div>
                ) : (
                  historyItems.map((item, idx) => (
                    <label
                      key={`${item.date || 'no-date'}-${item.task.id || 'no-id'}-${idx}-history`}
                      className={`flex items-center gap-3 p-3 rounded-xl border-2 ${item.completed ? 'bg-[#A8D8B9]/15 border-[#A8D8B9]/40' : 'bg-white border-[#E8E8E8]'}`}
                    >
                      <input
                        type="checkbox"
                        checked={item.completed}
                        onChange={e => onToggleStatus(student.id, item.task.id, e.target.checked, item.date)}
                        className="sr-only"
                      />
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${item.completed ? 'bg-[#A8D8B9]' : 'bg-[#FFD6A5]'}`}>
                        {item.completed ? <Check size={18} className="text-white" /> : <ScrollText size={18} className="text-white" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-[#5D5D5D] truncate">{item.task.title}</div>
                        <div className="text-xs text-[#8B8B8B]">日期：{formatDateDisplay(item.date)}</div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); onToggleStatus(student.id, item.task.id, true, item.date); }}
                          className="px-2 py-1 text-xs rounded-lg bg-[#A8D8B9]/30 text-[#4A7C59] hover:bg-[#A8D8B9]/50"
                        >
                          完成
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); onToggleStatus(student.id, item.task.id, 'leave', item.date); }}
                          className="px-2 py-1 text-xs rounded-lg bg-[#E8E8E8] text-[#5D5D5D] hover:bg-[#D8D8D8]"
                        >
                          請假
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); onToggleStatus(student.id, item.task.id, 'exempt', item.date); }}
                          className="px-2 py-1 text-xs rounded-lg bg-[#FFD6A5]/60 text-[#8B6914] hover:bg-[#FFD6A5]"
                        >
                          免交
                        </button>
                      </div>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================
// 設定 Modal (修復中文亂碼版)
// ============================================

export default PassportModal
