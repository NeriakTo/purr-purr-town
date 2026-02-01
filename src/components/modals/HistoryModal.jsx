import { useEffect, useMemo, useState } from 'react'
import { X, Calendar as CalendarIcon, Search, ScrollText, Filter, ChevronDown, Check, Clock, XCircle, Coffee, CircleMinus } from 'lucide-react'
import AvatarEmoji from '../common/AvatarEmoji'
import { STATUS_VALUES } from '../../utils/constants'
import { formatDate, formatDateDisplay, getTodayStr, getTaskDueDate, getTaskCreatedAt, normalizeStatus, getStatusVisual, isDoneStatus, isCountedInDenominator, getTaskIcon } from '../../utils/helpers'

function HistoryModal({ allLogs, students, settings, onClose, onToggleStatus }) {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedTask, setExpandedTask] = useState(null)

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  // v3.0.1: 僅顯示已過期任務 (dueDate < 今天)
  const todayStr = getTodayStr()
  const allHistoryTasks = useMemo(() => {
    const tasks = []
    allLogs.forEach(log => {
      const logDate = typeof log.date === 'string' ? log.date.split('T')[0] : formatDate(log.date)
      const logTasks = log.tasks || []
      const logStatus = log.status || {}

      logTasks.forEach(task => {
        const dueDate = getTaskDueDate(task, logDate)
        const createdAt = getTaskCreatedAt(task, logDate)

        if (dueDate >= todayStr) return
        if (dateFrom && dueDate < dateFrom) return
        if (dateTo && dueDate > dateTo) return
        if (filterType !== 'all' && task.type !== filterType) return

        const studentStatuses = students.map(s => {
          const statusValue = logStatus[s.id]?.[task.id]
          return { student: s, status: statusValue, visual: getStatusVisual(statusValue) }
        })

        const totalCount = studentStatuses.filter(ss => isCountedInDenominator(ss.status)).length
        const completedCount = studentStatuses.filter(ss => isDoneStatus(ss.status)).length
        tasks.push({
          ...task,
          logDate,
          dueDate,
          createdAt,
          studentStatuses,
          completedCount,
          totalCount,
        })
      })
    })

    return tasks.sort((a, b) => new Date(b.dueDate) - new Date(a.dueDate))
  }, [allLogs, students, dateFrom, dateTo, filterType, todayStr])

  const filteredHistoryTasks = useMemo(() => {
    if (!searchQuery.trim()) return allHistoryTasks
    const q = searchQuery.trim().toLowerCase()
    return allHistoryTasks.filter(t => (t.title || '').toLowerCase().includes(q))
  }, [allHistoryTasks, searchQuery])

  const taskTypes = useMemo(() => {
    const types = new Set()
    allLogs.forEach(log => (log.tasks || []).forEach(t => t.type && types.add(t.type)))
    return Array.from(types)
  }, [allLogs])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" />
      <div className="relative bg-[#fdfbf7] rounded-3xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="h-3 bg-gradient-to-r from-[#FFD6A5] to-[#A8D8B9]" />

        {/* Header */}
        <div className="px-4 py-3 border-b border-[#E8E8E8] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#FFD6A5] to-[#A8D8B9] flex items-center justify-center">
              <ScrollText size={20} className="text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#5D5D5D]">村莊歷史</h2>
              <p className="text-xs text-[#8B8B8B]">已過期任務補登</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-[#E8E8E8] transition-colors">
            <X size={20} className="text-[#5D5D5D]" />
          </button>
        </div>

        {/* Filters */}
        <div className="px-4 py-2 border-b border-[#E8E8E8] flex flex-wrap items-center gap-2 shrink-0">
        <div className="flex items-center gap-2 flex-1">
          <Search size={16} className="text-[#8B8B8B]" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="搜尋任務名稱..."
            className="flex-1 min-w-0 px-2 py-1 rounded-lg border border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-xs text-[#5D5D5D]"
          />
        </div>
        <div className="flex items-center gap-2">
          <CalendarIcon size={16} className="text-[#8B8B8B]" />
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="px-2 py-1 rounded-lg border border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-xs text-[#5D5D5D]" />
          <span className="text-[#8B8B8B] text-xs">~</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="px-2 py-1 rounded-lg border border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-xs text-[#5D5D5D]" />
        </div>
        <div className="flex items-center gap-1 overflow-x-auto">
          <Filter size={18} className="text-[#8B8B8B] shrink-0" />
          <button onClick={() => setFilterType('all')}
            className={`px-2 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${filterType === 'all' ? 'bg-[#A8D8B9] text-white' : 'bg-[#E8E8E8] text-[#5D5D5D] hover:bg-[#D8D8D8]'}`}>
            全部
          </button>
          {taskTypes.map(type => (
            <button key={type} onClick={() => setFilterType(type)}
              className={`px-2 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${filterType === type ? 'bg-[#FFD6A5] text-white' : 'bg-[#E8E8E8] text-[#5D5D5D] hover:bg-[#D8D8D8]'}`}>
              {type}
            </button>
          ))}
        </div>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 min-h-0">
        {filteredHistoryTasks.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">📜</div>
            <p className="text-[#8B8B8B] text-sm">{allHistoryTasks.length === 0 ? '沒有已過期的歷史任務' : '搜尋無結果'}</p>
          </div>
        ) : (
          filteredHistoryTasks.map((task, idx) => {
            const taskKey = `${task.logDate}-${task.id}`
            const isExpanded = expandedTask === taskKey
            const IconComponent = getTaskIcon(task.title)
            const allDone = task.totalCount > 0 && task.completedCount === task.totalCount

            return (
              <div key={`${taskKey}-${idx}`} className="bg-white rounded-xl shadow-sm overflow-hidden">
                <div
                  className="p-3 cursor-pointer hover:bg-[#F9F9F9] transition-colors"
                  onClick={() => setExpandedTask(isExpanded ? null : taskKey)}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${allDone ? 'bg-[#A8D8B9]' : 'bg-[#FFD6A5]'}`}>
                      <IconComponent size={20} className="text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[#E8E8E8] text-[#5D5D5D]">
                          截止：{formatDateDisplay(task.dueDate)}
                        </span>
                        {task.createdAt !== task.dueDate && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-[#F0F0F0] text-[#8B8B8B]">
                            建立：{formatDateDisplay(task.createdAt)}
                          </span>
                        )}
                        {task.type && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-[#FFD6A5]/30 text-[#8B6914]">{task.type}</span>
                        )}
                      </div>
                      <h4 className="font-bold text-[#5D5D5D] truncate">{task.title}</h4>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`text-base font-bold ${allDone ? 'text-[#7BC496]' : 'text-[#5D5D5D]'}`}>{task.completedCount}/{task.totalCount}</div>
                    </div>
                    <ChevronDown size={18} className={`text-[#8B8B8B] transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
                  </div>
                  {/* Progress bar */}
                  <div className="mt-3 h-2 bg-[#E8E8E8] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${task.totalCount > 0 ? (task.completedCount / task.totalCount) * 100 : 0}%`,
                        background: allDone ? 'linear-gradient(90deg, #A8D8B9, #7BC496)' : 'linear-gradient(90deg, #FFD6A5, #FFBF69)'
                      }}
                    />
                  </div>
                </div>

                {/* Expanded: student list with status edit */}
                {isExpanded && (
                  <div className="px-3 pb-3 border-t border-[#E8E8E8]">
                    <div className="mt-2 space-y-1 max-h-60 overflow-y-auto">
                      {task.studentStatuses.map(({ student, status, visual }) => {
                        const StatusIcon = visual.icon
                        return (
                          <div key={student.id} className={`flex items-center gap-2 p-2 rounded-lg ${visual.bg} border ${visual.border} transition-all`}>
                            <div className="w-6 h-6 rounded-full overflow-hidden shrink-0">
                              <AvatarEmoji seed={student.uuid || student.id} className="w-full h-full rounded-full text-xs" />
                            </div>
                            <span className="font-medium text-[#5D5D5D] flex-1 min-w-0 truncate text-sm">{student.number}. {student.name}</span>
                            {StatusIcon && <StatusIcon size={14} style={{ color: visual.color }} />}
                            <span className={`text-xs font-bold shrink-0 ${visual.text}`}>{visual.label || '未完成'}</span>
                            <div className="flex items-center gap-0.5 shrink-0">
                              <button onClick={() => onToggleStatus(student.id, task.id, STATUS_VALUES.ON_TIME, task.logDate)}
                                className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${normalizeStatus(status) === STATUS_VALUES.ON_TIME ? 'bg-[#7BC496] text-white' : 'bg-[#A8D8B9]/20 hover:bg-[#A8D8B9] text-[#4A7C59] hover:text-white'}`}
                                title="準時">
                                <Check size={12} />
                              </button>
                              <button onClick={() => onToggleStatus(student.id, task.id, STATUS_VALUES.LATE, task.logDate)}
                                className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${normalizeStatus(status) === STATUS_VALUES.LATE ? 'bg-[#FFBF69] text-white' : 'bg-[#FFD6A5]/20 hover:bg-[#FFD6A5] text-[#8B6914] hover:text-white'}`}
                                title="遲交">
                                <Clock size={12} />
                              </button>
                              <button onClick={() => onToggleStatus(student.id, task.id, STATUS_VALUES.MISSING, task.logDate)}
                                className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${normalizeStatus(status) === STATUS_VALUES.MISSING ? 'bg-[#D64545] text-white' : 'bg-[#FFADAD]/20 hover:bg-[#FFADAD] text-[#D64545] hover:text-white'}`}
                                title="未交">
                                <XCircle size={12} />
                              </button>
                              <button onClick={() => onToggleStatus(student.id, task.id, STATUS_VALUES.LEAVE, task.logDate)}
                                className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${normalizeStatus(status) === STATUS_VALUES.LEAVE ? 'bg-[#8B8B8B] text-white' : 'bg-[#E8E8E8]/50 hover:bg-[#D8D8D8] text-[#8B8B8B]'}`}
                                title="請假">
                                <Coffee size={12} />
                              </button>
                              <button onClick={() => onToggleStatus(student.id, task.id, STATUS_VALUES.EXEMPT, task.logDate)}
                                className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${normalizeStatus(status) === STATUS_VALUES.EXEMPT ? 'bg-[#B8B8B8] text-white' : 'bg-[#F0F0F0]/50 hover:bg-[#E0E0E0] text-[#A0A0A0]'}`}
                                title="免交">
                                <CircleMinus size={12} />
                              </button>
                              {(normalizeStatus(status) && Object.values(STATUS_VALUES).includes(normalizeStatus(status))) && (
                                <button onClick={() => onToggleStatus(student.id, task.id, null, task.logDate)}
                                  className="w-6 h-6 rounded-full flex items-center justify-center bg-white/80 hover:bg-[#FFADAD]/20 text-[#D64545] transition-colors border border-[#E8E8E8]"
                                  title="清除狀態">
                                  <X size={12} />
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
      </div>
    </div>
  )
}

// ============================================
// 日曆導航
// ============================================

export default HistoryModal
