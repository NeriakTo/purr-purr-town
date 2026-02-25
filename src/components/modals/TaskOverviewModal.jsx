import { useMemo, useState } from 'react'
import { ListTodo, Filter, Trash2, ChevronDown, X, AlertCircle, CheckCircle, Check, Clock, XCircle, Eye, Coffee, CircleMinus, Calendar as CalendarIcon } from 'lucide-react'
import AvatarEmoji from '../common/AvatarEmoji'
import { STATUS_VALUES, BATCH_STATUS_CONFIG } from '../../utils/constants'
import { formatDateDisplay, getTaskDueDate, getTaskIcon, isDoneStatus, normalizeStatus, isCountedInDenominator, parseDate, shouldAutoExempt } from '../../utils/helpers'

function TaskOverviewModal({ allLogs, students, onClose, onNavigateToDate, settings, onToggleStatus, onDeleteTask }) {
  const [expandedTask, setExpandedTask] = useState(null)
  const [filterType, setFilterType] = useState('all')
  const [batchTaskKey, setBatchTaskKey] = useState(null)
  const [batchSelected, setBatchSelected] = useState({})
  
  // 整理所有任務資料
  const allTasks = useMemo(() => {
    const tasks = []
    allLogs.forEach(log => {
      const logTasks = log.tasks || []
      const logStatus = log.status || {}
      
      logTasks.forEach(task => {
        const onTimeStudents = students.filter(s => normalizeStatus(logStatus[s.id]?.[task.id]) === STATUS_VALUES.ON_TIME)
        const lateStudents = students.filter(s => normalizeStatus(logStatus[s.id]?.[task.id]) === STATUS_VALUES.LATE)
        const missingStudents = students.filter(s => normalizeStatus(logStatus[s.id]?.[task.id]) === STATUS_VALUES.MISSING)
        const leaveStudents = students.filter(s => normalizeStatus(logStatus[s.id]?.[task.id]) === STATUS_VALUES.LEAVE)
        const exemptStudents = students.filter(s => normalizeStatus(logStatus[s.id]?.[task.id]) === STATUS_VALUES.EXEMPT)
        const doneCount = onTimeStudents.length + lateStudents.length
        const incompleteStudents = students.filter(s => !isDoneStatus(logStatus[s.id]?.[task.id]) && isCountedInDenominator(logStatus[s.id]?.[task.id]))

        const dueDate = getTaskDueDate(task, log.date)
        tasks.push({
          ...task,
          date: log.date,
          dueDate,
          completedCount: doneCount,
          incompleteCount: incompleteStudents.length,
          totalCount: students.length,
          onTimeStudents,
          lateStudents,
          missingStudents,
          leaveStudents,
          exemptStudents,
          incompleteStudents,
          isComplete: incompleteStudents.length === 0
        })
      })
    })
    
    // v3.7.2: 未完成排前面，再按截止日期遞增排序（最早到期在前）
    return tasks.sort((a, b) => {
      if (a.isComplete !== b.isComplete) return a.isComplete ? 1 : -1
      return new Date(a.dueDate) - new Date(b.dueDate)
    })
  }, [allLogs, students])

  const filteredTasks = useMemo(() => {
    if (filterType === 'all') return allTasks
    if (filterType === 'incomplete') return allTasks.filter(t => !t.isComplete)
    if (filterType === 'complete') return allTasks.filter(t => t.isComplete)
    return allTasks.filter(t => t.type === filterType)
  }, [allTasks, filterType])

  const taskTypes = useMemo(() => {
    const types = new Set()
    allTasks.forEach(t => t.type && types.add(t.type))
    return Array.from(types)
  }, [allTasks])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative bg-[#fdfbf7] rounded-3xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="h-3 bg-gradient-to-r from-[#A8D8B9] to-[#7BC496]" />
        
        {/* Header */}
        <div className="p-6 border-b border-[#E8E8E8] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#A8D8B9] to-[#7BC496] flex items-center justify-center">
              <ListTodo size={24} className="text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-[#5D5D5D]">任務總覽</h2>
              <p className="text-sm text-[#8B8B8B]">檢視所有任務的完成狀況</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-[#E8E8E8] transition-colors">
            <X size={24} className="text-[#5D5D5D]" />
          </button>
        </div>

        {/* Filter */}
        <div className="px-6 py-4 border-b border-[#E8E8E8] flex items-center gap-3 overflow-x-auto">
          <Filter size={18} className="text-[#8B8B8B] shrink-0" />
          <button
            onClick={() => setFilterType('all')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
              filterType === 'all' ? 'bg-[#A8D8B9] text-white' : 'bg-[#E8E8E8] text-[#5D5D5D]'
            }`}
          >
            全部 ({allTasks.length})
          </button>
          <button
            onClick={() => setFilterType('incomplete')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
              filterType === 'incomplete' ? 'bg-[#FFADAD] text-white' : 'bg-[#E8E8E8] text-[#5D5D5D]'
            }`}
          >
            未完成 ({allTasks.filter(t => !t.isComplete).length})
          </button>
          <button
            onClick={() => setFilterType('complete')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
              filterType === 'complete' ? 'bg-[#7BC496] text-white' : 'bg-[#E8E8E8] text-[#5D5D5D]'
            }`}
          >
            已完成 ({allTasks.filter(t => t.isComplete).length})
          </button>
          {taskTypes.map(type => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                filterType === type ? 'bg-[#FFD6A5] text-white' : 'bg-[#E8E8E8] text-[#5D5D5D]'
              }`}
            >
              {type}
            </button>
          ))}
        </div>

        {/* Task List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {filteredTasks.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-5xl mb-4">📭</div>
              <p className="text-[#8B8B8B]">沒有符合條件的任務</p>
            </div>
          ) : (
            filteredTasks.map((task, idx) => {
              const isExpanded = expandedTask === `${task.date}-${task.id}`
              const IconComponent = getTaskIcon(task.title)
              
              return (
                <div key={`${task.date}-${task.id}-${idx}`} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                  <div
                    className="p-4 cursor-pointer hover:bg-[#F9F9F9] transition-colors"
                    onClick={() => setExpandedTask(isExpanded ? null : `${task.date}-${task.id}`)}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                        task.isComplete ? 'bg-[#A8D8B9]' : 'bg-[#FFD6A5]'
                      }`}>
                        <IconComponent size={24} className="text-white" />
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-[#E8E8E8] text-[#5D5D5D]">
                            截止：{formatDateDisplay(task.dueDate || task.date)}
                          </span>
                          {task.dueDate && task.dueDate !== task.date && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-[#F0F0F0] text-[#8B8B8B]">
                              建立：{formatDateDisplay(task.date)}
                            </span>
                          )}
                          {task.type && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-[#FFD6A5]/30 text-[#8B6914]">
                              {task.type}
                            </span>
                          )}
                        </div>
                        <h4 className="font-bold text-[#5D5D5D] truncate">{task.title}</h4>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className={`text-lg font-bold ${task.isComplete ? 'text-[#7BC496]' : 'text-[#FF8A8A]'}`}>
                            {task.completedCount}/{task.totalCount}
                          </div>
                          <div className="text-xs text-[#8B8B8B]">
                            {task.isComplete ? '✅ 全員完成' : `⏳ 剩餘 ${task.incompleteCount} 人`}
                          </div>
                        </div>
                        {onDeleteTask && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              if (window.confirm(`確定要刪除「${task.title}」任務嗎？`)) {
                                onDeleteTask(task.date, task.id)
                              }
                            }}
                            className="p-2 rounded-full hover:bg-[#FFADAD]/20 transition-colors"
                            title="刪除任務"
                          >
                            <Trash2 size={18} className="text-[#D64545]" />
                          </button>
                        )}
                        <div className={`p-2 rounded-full transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                          <ChevronDown size={20} className="text-[#8B8B8B]" />
                        </div>
                      </div>
                    </div>
                    
                    {/* Progress Bar */}
                    <div className="mt-3 h-2 bg-[#E8E8E8] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${(task.completedCount / task.totalCount) * 100}%`,
                          background: task.isComplete
                            ? 'linear-gradient(90deg, #A8D8B9, #7BC496)'
                            : 'linear-gradient(90deg, #FFD6A5, #FFBF69)'
                        }}
                      />
                    </div>
                  </div>

                  {/* Expanded Detail */}
                  {isExpanded && (() => {
                    const taskKey = `${task.date}-${task.id}`
                    const isBatchMode = batchTaskKey === taskKey
                    return (
                    <div className="px-4 pb-4 border-t border-[#E8E8E8]">
                      {/* 未完成 */}
                      {task.incompleteCount > 0 && (
                        <div className="mt-4">
                          <div className="flex items-center justify-between mb-2">
                            <h5 className="text-sm font-bold text-[#D64545] flex items-center gap-2">
                              <AlertCircle size={16} />
                              未完成 ({task.incompleteCount})
                            </h5>
                            {onToggleStatus && !isBatchMode && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setBatchTaskKey(taskKey); setBatchSelected({}) }}
                                className="px-3 py-1 rounded-lg bg-[#FFD6A5] text-white text-xs font-medium hover:bg-[#FFBF69] transition-colors flex items-center gap-1"
                              >
                                <CheckCircle size={14} />
                                批次操作
                              </button>
                            )}
                            {isBatchMode && (
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    const allSelected = task.incompleteStudents.every(s => batchSelected[s.id])
                                    const next = {}
                                    task.incompleteStudents.forEach(s => { next[s.id] = !allSelected })
                                    setBatchSelected(next)
                                  }}
                                  className="px-2 py-1 rounded-lg bg-[#E8E8E8] text-[#5D5D5D] text-xs font-medium hover:bg-[#D8D8D8] transition-colors"
                                >
                                  {task.incompleteStudents.every(s => batchSelected[s.id]) ? '取消全選' : '全選'}
                                </button>
                                {BATCH_STATUS_CONFIG.map(cfg => {
                                  const icons = { on_time: Check, late: Clock, missing: XCircle, leave: Coffee, exempt: CircleMinus }
                                  const Icon = icons[cfg.value]
                                  return (
                                    <button
                                      key={cfg.value}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        const selected = Object.entries(batchSelected).filter(([, v]) => v).map(([id]) => id)
                                        selected.forEach(studentId => onToggleStatus(studentId, task.id, cfg.value, task.date))
                                        setBatchTaskKey(null)
                                        setBatchSelected({})
                                      }}
                                      disabled={!Object.values(batchSelected).some(v => v)}
                                      className={`px-2 py-1 rounded-lg ${cfg.bgClass} text-white text-xs font-medium ${cfg.hoverClass} transition-colors disabled:opacity-40 flex items-center gap-1`}
                                    >
                                      <Icon size={12} />
                                      {cfg.label}
                                    </button>
                                  )
                                })}
                                <button
                                  onClick={(e) => { e.stopPropagation(); setBatchTaskKey(null); setBatchSelected({}) }}
                                  className="px-2 py-1 rounded-lg bg-[#FFADAD] text-white text-xs font-medium hover:bg-[#FF8A8A] transition-colors"
                                >
                                  取消
                                </button>
                              </div>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {task.incompleteStudents.map(s => (
                              <div
                                key={s.id}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (isBatchMode) {
                                    setBatchSelected(prev => ({ ...prev, [s.id]: !prev[s.id] }))
                                  } else if (onToggleStatus) {
                                    onToggleStatus(s.id, task.id, STATUS_VALUES.ON_TIME, task.date)
                                  }
                                }}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border transition-all cursor-pointer hover:opacity-80 ${
                                  isBatchMode
                                    ? batchSelected[s.id]
                                      ? 'bg-[#7BC496]/20 border-[#7BC496]'
                                      : 'bg-[#FFADAD]/20 border-[#FFADAD]/30 hover:border-[#7BC496]/50'
                                    : 'bg-[#FFADAD]/20 border-[#FFADAD]/30 hover:border-[#7BC496]/50'
                                }`}
                              >
                                {isBatchMode && (
                                  <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${
                                    batchSelected[s.id] ? 'bg-[#7BC496] border-[#7BC496]' : 'border-[#D8D8D8]'
                                  }`}>
                                    {batchSelected[s.id] && <Check size={10} className="text-white" />}
                                  </div>
                                )}
                                <div className="w-6 h-6 rounded-full overflow-hidden">
                                  <AvatarEmoji seed={s.uuid || s.id} className="w-full h-full rounded-full text-xs" />
                                </div>
                                <span className="text-[#D64545] font-medium">{s.number}. {s.name}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 準時完成 */}
                      {task.onTimeStudents.length > 0 && (
                        <div className="mt-4">
                          <h5 className="text-sm font-bold text-[#7BC496] mb-2 flex items-center gap-2">
                            <Check size={16} />
                            準時 ({task.onTimeStudents.length})
                          </h5>
                          <div className="flex flex-wrap gap-2">
                            {task.onTimeStudents.map(s => (
                              <div
                                key={s.id}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (onToggleStatus) onToggleStatus(s.id, task.id, false, task.date)
                                }}
                                className="flex items-center gap-2 px-3 py-1.5 bg-[#A8D8B9]/20 rounded-lg text-sm border border-[#A8D8B9]/30 cursor-pointer hover:opacity-80 hover:border-[#FFADAD]/50 transition-all"
                              >
                                <div className="w-6 h-6 rounded-full overflow-hidden">
                                  <AvatarEmoji seed={s.uuid || s.id} className="w-full h-full rounded-full text-xs" />
                                </div>
                                <span className="text-[#5D5D5D]">{s.number}. {s.name}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 遲交 */}
                      {task.lateStudents.length > 0 && (
                        <div className="mt-4">
                          <h5 className="text-sm font-bold text-[#8B6914] mb-2 flex items-center gap-2">
                            <Clock size={16} />
                            遲交 ({task.lateStudents.length})
                          </h5>
                          <div className="flex flex-wrap gap-2">
                            {task.lateStudents.map(s => (
                              <div
                                key={s.id}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (onToggleStatus) onToggleStatus(s.id, task.id, false, task.date)
                                }}
                                className="flex items-center gap-2 px-3 py-1.5 bg-[#FFD6A5]/20 rounded-lg text-sm border border-[#FFD6A5]/30 cursor-pointer hover:opacity-80 hover:border-[#FFADAD]/50 transition-all"
                              >
                                <div className="w-6 h-6 rounded-full overflow-hidden">
                                  <AvatarEmoji seed={s.uuid || s.id} className="w-full h-full rounded-full text-xs" />
                                </div>
                                <span className="text-[#8B6914]">{s.number}. {s.name}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 未交 */}
                      {task.missingStudents.length > 0 && (
                        <div className="mt-4">
                          <h5 className="text-sm font-bold text-[#D64545] mb-2 flex items-center gap-2">
                            <XCircle size={16} />
                            未交 ({task.missingStudents.length})
                          </h5>
                          <div className="flex flex-wrap gap-2">
                            {task.missingStudents.map(s => (
                              <div
                                key={s.id}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (onToggleStatus) onToggleStatus(s.id, task.id, false, task.date)
                                }}
                                className="flex items-center gap-2 px-3 py-1.5 bg-[#FFADAD]/20 rounded-lg text-sm border border-[#FFADAD]/30 cursor-pointer hover:opacity-80 hover:border-[#7BC496]/50 transition-all"
                              >
                                <div className="w-6 h-6 rounded-full overflow-hidden">
                                  <AvatarEmoji seed={s.uuid || s.id} className="w-full h-full rounded-full text-xs" />
                                </div>
                                <span className="text-[#D64545]">{s.number}. {s.name}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 請假 */}
                      {task.leaveStudents.length > 0 && (
                        <div className="mt-4">
                          <h5 className="text-sm font-bold text-[#8B8B8B] mb-2 flex items-center gap-2">
                            <Clock size={16} />
                            請假 ({task.leaveStudents.length})
                          </h5>
                          <div className="flex flex-wrap gap-2">
                            {task.leaveStudents.map(s => (
                              <div
                                key={s.id}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (onToggleStatus) onToggleStatus(s.id, task.id, false, task.date)
                                }}
                                className="flex items-center gap-2 px-3 py-1.5 bg-[#E8E8E8]/50 rounded-lg text-sm border border-[#D8D8D8] cursor-pointer hover:opacity-80 hover:border-[#FFADAD]/50 transition-all"
                              >
                                <div className="w-6 h-6 rounded-full overflow-hidden">
                                  <AvatarEmoji seed={s.uuid || s.id} className="w-full h-full rounded-full text-xs" />
                                </div>
                                <span className="text-[#8B8B8B]">{s.number}. {s.name}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 免交 */}
                      {task.exemptStudents.length > 0 && (
                        <div className="mt-4">
                          <h5 className="text-sm font-bold text-[#A0A0A0] mb-2 flex items-center gap-2">
                            <Eye size={16} />
                            免交 ({task.exemptStudents.length})
                          </h5>
                          <div className="flex flex-wrap gap-2">
                            {task.exemptStudents.map(s => (
                              <div
                                key={s.id}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (onToggleStatus) onToggleStatus(s.id, task.id, false, task.date)
                                }}
                                className="flex items-center gap-2 px-3 py-1.5 bg-[#F0F0F0]/50 rounded-lg text-sm border border-[#E0E0E0] cursor-pointer hover:opacity-80 hover:border-[#FFADAD]/50 transition-all"
                              >
                                <div className="w-6 h-6 rounded-full overflow-hidden">
                                  <AvatarEmoji seed={s.uuid || s.id} className="w-full h-full rounded-full text-xs" />
                                </div>
                                <span className="text-[#A0A0A0]">{s.number}. {s.name}</span>
                                {shouldAutoExempt(s, task.title, task.type) && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#B8B8B8]/20 text-[#8B8B8B]">自動</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <button
                        onClick={() => { onNavigateToDate(parseDate(task.date)); onClose() }}
                        className="mt-4 w-full py-2 rounded-xl border-2 border-[#A8D8B9] text-[#A8D8B9] font-medium hover:bg-[#A8D8B9] hover:text-white transition-all flex items-center justify-center gap-2"
                      >
                        <CalendarIcon size={18} />
                        前往該日期
                      </button>
                    </div>
                    )
                  })()}
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
// 村莊歷史 Modal (v2.2.0)
// ============================================

export default TaskOverviewModal
