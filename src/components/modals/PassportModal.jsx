import { useMemo, useState } from 'react'
import { X, Clock, XCircle, AlertTriangle, Check, Coffee, CircleMinus, Wallet, Undo2, TrendingUp, TrendingDown, ChevronDown } from 'lucide-react'
import AvatarEmoji from '../common/AvatarEmoji'
import { RenderIcon } from '../common/IconPicker'
import { STATUS_VALUES } from '../../utils/constants'
import { formatDate, formatDateDisplay, getTaskDueDate, getTodayStr, isDoneStatus, normalizeStatus, parseDate, getTaskIcon, getStatusVisual, formatCurrency } from '../../utils/helpers'

function PassportModal({ student, tasks, studentStatus, onClose, onToggleStatus, onStudentUpdate, hasOverdue, settings, allLogs, currentDateStr, onBankTransaction, onUndoTransaction }) {
  const [activeTab, setActiveTab] = useState('tasks')
  const [editData, setEditData] = useState({ name: student.name || '', gender: student.gender || 'male', group: student.group || 'unassigned' })
  const [manualAmount, setManualAmount] = useState('')
  const [manualReason, setManualReason] = useState('')
  const [quickActionsOpen, setQuickActionsOpen] = useState(false)
  const status = studentStatus[student.id] || {}
  const hasTasks = tasks.length > 0
  const completedCount = tasks.filter(t => isDoneStatus(status[t.id])).length
  const isAllDone = hasTasks && completedCount === tasks.length

  const rates = settings?.currencyRates || { fish: 100, cookie: 1000 }
  const balance = student.bank?.balance || 0
  const currencyDisplay = formatCurrency(balance, rates)

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

  const saveEdit = () => {
    if (!editData.name.trim()) return
    const updatedStudent = { ...student, id: student.id || student.uuid, name: editData.name.trim(), group: editData.group, gender: editData.gender }
    if (onStudentUpdate) onStudentUpdate(updatedStudent)
    setActiveTab('tasks')
  }

  const handleManualTransaction = () => {
    const amount = parseInt(manualAmount)
    const reason = manualReason.trim() || '手動調整'
    if (!isNaN(amount) && amount !== 0 && onBankTransaction) {
      onBankTransaction(student.id, amount, reason)
      setManualAmount('')
      setManualReason('')
    }
  }

  // v3.4.4: 將行為規範依類別分組
  const groupedRules = useMemo(() => {
    const rules = settings?.behaviorRules || []
    const groups = {}
    rules.forEach(rule => {
      const cat = rule.category || '未分類'
      if (!groups[cat]) groups[cat] = { bonus: [], fine: [] }
      groups[cat][rule.type === 'fine' ? 'fine' : 'bonus'].push(rule)
    })
    return groups
  }, [settings?.behaviorRules])

  const totalRulesCount = (settings?.behaviorRules || []).length

  const studentJobs = useMemo(() => {
    const jobs = settings?.jobs || []
    const assignments = settings?.jobAssignments || {}
    return jobs.filter(job => (assignments[job.id] || []).includes(student.id))
  }, [settings, student.id])

  const tabs = [
    { key: 'tasks', label: '📋 任務' },
    { key: 'passbook', label: '💰 存摺與操作' },
    { key: 'edit', label: '⚙️ 編輯資料' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#fdfbf7] rounded-3xl shadow-2xl max-w-4xl w-full h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="h-3 shrink-0" style={{ background: 'repeating-linear-gradient(90deg, #A8D8B9, #A8D8B9 20px, #FFD6A5 20px, #FFD6A5 40px)' }} />
        <button onClick={onClose} className="absolute top-6 right-4 p-2 rounded-full bg-white/80 hover:bg-white shadow-md z-10">
          <X size={20} className="text-[#5D5D5D]" />
        </button>

        {/* Main 12-col grid */}
        <div className="flex-1 min-h-0 grid grid-cols-12">
          {/* ===== Left Column (span-4): Avatar + Asset + Inventory ===== */}
          <div className="col-span-4 border-r border-[#E8E8E8] p-5 flex flex-col overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
            {/* Large Avatar */}
            <div className={`w-32 h-32 mx-auto rounded-3xl overflow-hidden shadow-lg ring-4 shrink-0 ${isAllDone ? 'ring-[#A8D8B9]' : hasTasks ? 'ring-[#FFD6A5]' : 'ring-[#E8E8E8]'}`}>
              <AvatarEmoji seed={student.uuid || student.id} className="w-full h-full rounded-3xl text-6xl" />
            </div>

            {/* Student Info */}
            <div className="text-center mt-4 shrink-0">
              <div className="flex items-center justify-center gap-2 mb-1">
                <span className="text-xs px-2 py-0.5 rounded-full bg-[#FFD6A5]/30 text-[#8B6914] font-medium">
                  {student.number} 號
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-[#A8D8B9]/30 text-[#4A7C59] font-medium">
                  {student.group === 'unassigned' ? '待分配' : (settings?.groupAliases?.[student.group] || `${student.group || 'A'} 小隊`)}
                </span>
              </div>
              <h3 className="text-xl font-bold text-[#5D5D5D]">{student.name}</h3>

              {hasTasks && (
                <div className="mt-3 flex items-center gap-2 px-2">
                  <div className="flex-1 h-2 bg-[#E8E8E8] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${(completedCount / tasks.length) * 100}%`, background: isAllDone ? '#7BC496' : '#FFBF69' }}
                    />
                  </div>
                  <span className="text-xs font-medium text-[#5D5D5D]">{completedCount}/{tasks.length}</span>
                </div>
              )}
            </div>

            {/* Job Badges */}
            <div className="mt-3 flex flex-wrap gap-2 justify-center shrink-0">
              {studentJobs.length > 0 ? studentJobs.map(job => (
                <span key={job.id} className="px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-sm flex items-center gap-1">
                  <RenderIcon name={job.icon} size={14} />
                  <span>{job.title}</span>
                </span>
              )) : (
                <span className="text-xs text-[#B0B0B0]">尚未指派職務</span>
              )}
            </div>

            {/* Asset Overview */}
            <div className="mt-5 bg-gradient-to-br from-[#FFD6A5]/20 to-[#A8D8B9]/20 rounded-2xl p-4 border border-[#E8E8E8] shrink-0">
              <div className="text-xs font-bold text-[#8B8B8B] mb-1 flex items-center gap-1.5">
                <Wallet size={14} className="text-[#FFD6A5]" />
                資產總覽
              </div>
              <div className="text-xl font-bold text-[#5D5D5D] text-center">
                {currencyDisplay.display}
              </div>
              {balance > 0 && (
                <div className="mt-1.5 flex items-center justify-center gap-3 text-xs text-[#8B8B8B]">
                  {currencyDisplay.cookies > 0 && <span>{currencyDisplay.cookies} 🍪</span>}
                  {currencyDisplay.fish > 0 && <span>{currencyDisplay.fish} 🐟</span>}
                  {currencyDisplay.raw > 0 && <span>{currencyDisplay.raw} pt</span>}
                </div>
              )}
            </div>

            {/* Inventory */}
            {(student.inventory || []).length > 0 && (
              <div className="mt-4 shrink-0">
                <div className="text-xs font-bold text-[#8B8B8B] mb-2">道具背包</div>
                <div className="flex flex-wrap gap-1.5">
                  {(student.inventory || []).map((item, idx) => (
                    <div key={`${item.itemId}-${idx}`} className="flex items-center gap-1 px-2 py-1 bg-[#FFD6A5]/15 rounded-lg border border-[#FFD6A5]/30">
                      <span className="text-sm">{item.icon || '🎁'}</span>
                      <span className="text-[10px] font-medium text-[#5D5D5D]">{item.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ===== Right Column (span-8): Tabs + Content ===== */}
          <div className="col-span-8 flex flex-col min-h-0">
            {/* Tabs */}
            <div className="flex border-b border-[#E8E8E8] px-5 pt-3 shrink-0 gap-1">
              {tabs.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-4 py-2.5 rounded-t-xl font-bold text-sm transition-all ${
                    activeTab === tab.key
                      ? 'bg-white text-[#5D5D5D] border border-[#E8E8E8] border-b-white -mb-px'
                      : 'text-[#8B8B8B] hover:text-[#5D5D5D] hover:bg-[#F9F9F9]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="flex-1 min-h-0 overflow-y-auto p-5" style={{ scrollbarWidth: 'thin' }}>

              {/* ===== Tasks Tab ===== */}
              {activeTab === 'tasks' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    {tasks.length === 0 ? (
                      <div className="text-center py-12 bg-[#F9F9F9] rounded-2xl">
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
                            className={`flex items-center gap-3 p-3 rounded-2xl transition-all border-2 ${visual.bg} ${visual.border}`}
                          >
                            <div
                              onClick={() => onToggleStatus(student.id, task.id, isCompleted ? false : true)}
                              className="cursor-pointer flex items-center gap-3 flex-1 min-w-0"
                            >
                              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                                style={{ background: isCompleted ? visual.color : '#FFD6A5' }}>
                                <IconComponent size={18} className="text-white" />
                              </div>
                              <span className={`flex-1 font-medium text-sm ${isCompleted ? `${visual.text} line-through` : 'text-[#5D5D5D]'}`}>
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
                                className="px-2 py-1 text-xs rounded-lg bg-[#E8E8E8] text-[#5D5D5D] hover:bg-[#D8D8D8] flex items-center gap-0.5"
                              >
                                <Coffee size={12} />請假
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); onToggleStatus(student.id, task.id, 'exempt'); }}
                                className="px-2 py-1 text-xs rounded-lg bg-[#F3F4F6] text-[#9CA3AF] hover:bg-[#E5E7EB] flex items-center gap-0.5"
                              >
                                <CircleMinus size={12} />免交
                              </button>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>

                  {overdueItems.length > 0 && (
                    <div className="p-4 rounded-2xl border-2 border-[#FFADAD] bg-[#FFADAD]/10">
                      <div className="font-bold text-[#D64545] mb-2 text-sm">⚠️ 尚有未完成的歷史任務</div>
                      <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                        {overdueItems.map((item, idx) => (
                          <label
                            key={`${item.date || 'no-date'}-${item.task.id || 'no-id'}-${idx}`}
                            className="flex items-center gap-3 p-2.5 rounded-xl bg-white border-2 border-transparent hover:border-[#FFADAD]/40 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={false}
                              onChange={e => onToggleStatus(student.id, item.task.id, e.target.checked, item.date)}
                              className="sr-only"
                            />
                            <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-[#FFADAD]/60 text-white shrink-0">
                              <AlertTriangle size={16} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-bold text-[#D64545] truncate">{item.task.title}</div>
                              <div className="text-[10px] text-[#8B8B8B]">日期：{formatDateDisplay(item.date)}</div>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={(e) => { e.stopPropagation(); onToggleStatus(student.id, item.task.id, STATUS_VALUES.LATE, item.date); }}
                                className="px-2 py-1 text-[10px] rounded-lg bg-[#FFD6A5]/30 text-[#8B6914] hover:bg-[#FFD6A5] flex items-center gap-0.5"
                              >
                                <Clock size={10} />補交
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); onToggleStatus(student.id, item.task.id, STATUS_VALUES.MISSING, item.date); }}
                                className="px-2 py-1 text-[10px] rounded-lg bg-[#FFADAD]/30 text-[#D64545] hover:bg-[#FFADAD]/50 flex items-center gap-0.5"
                              >
                                <XCircle size={10} />未交
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); onToggleStatus(student.id, item.task.id, 'leave', item.date); }}
                                className="px-2 py-1 text-[10px] rounded-lg bg-[#E8E8E8] text-[#5D5D5D] hover:bg-[#D8D8D8] flex items-center gap-0.5"
                              >
                                <Coffee size={10} />請假
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); onToggleStatus(student.id, item.task.id, 'exempt', item.date); }}
                                className="px-2 py-1 text-[10px] rounded-lg bg-[#F3F4F6] text-[#9CA3AF] hover:bg-[#E5E7EB] flex items-center gap-0.5"
                              >
                                <CircleMinus size={10} />免交
                              </button>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ===== Passbook Tab ===== */}
              {activeTab === 'passbook' && (
                <div className="space-y-5">
                  {/* Quick Actions - Accordion */}
                  {Object.keys(groupedRules).length > 0 && (
                    <div className="rounded-xl border border-[#E8E8E8] overflow-hidden">
                      <button
                        onClick={() => setQuickActionsOpen(!quickActionsOpen)}
                        className="w-full px-4 py-3 bg-[#F9F9F9] text-sm font-bold text-[#5D5D5D] flex items-center justify-between hover:bg-[#F0F0F0] transition-colors"
                      >
                        <span>⚡ 快速操作 (點擊展開) — 共 {totalRulesCount} 個項目</span>
                        <ChevronDown size={16} className={`transition-transform ${quickActionsOpen ? 'rotate-180' : ''}`} />
                      </button>
                      {quickActionsOpen && (
                        <div className="p-3 space-y-3">
                          {Object.entries(groupedRules).map(([category, { bonus, fine }]) => {
                            const catMeta = (settings?.ruleCategories || []).find(c => c.name === category)
                            const allRules = [...bonus, ...fine]
                            return (
                              <div key={category}>
                                <div className="text-xs font-bold text-[#8B8B8B] mb-1.5 flex items-center gap-1">
                                  <span>{catMeta?.icon || '📋'}</span>
                                  {category}
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                  {allRules.map(rule => {
                                    const isFine = rule.type === 'fine'
                                    return (
                                      <button
                                        key={rule.id}
                                        onClick={() => onBankTransaction?.(student.id, rule.amount, rule.label)}
                                        className="h-10 text-sm flex items-center justify-center gap-2 border rounded-lg hover:bg-gray-50 transition-colors active:scale-95 bg-white"
                                        style={{ borderLeftWidth: 3, borderLeftColor: isFine ? '#FFADAD' : '#A8D8B9' }}
                                      >
                                        <RenderIcon name={rule.icon} size={14} className={isFine ? 'text-[#D64545]' : 'text-[#4A7C59]'} />
                                        <span className={isFine ? 'text-[#D64545]' : 'text-[#4A7C59]'}>{rule.label}</span>
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Manual Adjustment */}
                  <div>
                    <div className="text-sm font-bold text-[#5D5D5D] mb-2">手動調整</div>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={manualAmount}
                        onChange={e => setManualAmount(e.target.value)}
                        placeholder="金額 (正/負)"
                        className="w-28 px-3 py-2 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-sm"
                      />
                      <input
                        type="text"
                        value={manualReason}
                        onChange={e => setManualReason(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleManualTransaction() }}
                        placeholder="原因"
                        className="flex-1 px-3 py-2 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-sm"
                      />
                      <button
                        onClick={handleManualTransaction}
                        className="px-4 py-2 rounded-xl bg-[#A8D8B9] text-white font-bold text-sm hover:bg-[#7BC496] transition-colors"
                      >
                        送出
                      </button>
                    </div>
                  </div>

                  {/* Transaction History with Undo */}
                  <div>
                    <div className="text-sm font-bold text-[#5D5D5D] mb-2">交易紀錄</div>
                    <div className="max-h-64 overflow-y-auto border border-[#E8E8E8] rounded-xl" style={{ scrollbarWidth: 'thin' }}>
                      <table className="w-full text-sm">
                        <thead className="bg-[#F9F9F9] sticky top-0">
                          <tr>
                            <th className="px-3 py-2 text-left text-[#8B8B8B] font-medium text-xs">日期</th>
                            <th className="px-3 py-2 text-left text-[#8B8B8B] font-medium text-xs">摘要</th>
                            <th className="px-3 py-2 text-right text-[#8B8B8B] font-medium text-xs">收支</th>
                            <th className="px-3 py-2 text-right text-[#8B8B8B] font-medium text-xs">結餘</th>
                            <th className="px-2 py-2 text-center text-[#8B8B8B] font-medium text-xs w-12"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {(student.bank?.transactions || []).length === 0 ? (
                            <tr>
                              <td colSpan={5} className="px-3 py-8 text-center text-[#8B8B8B] text-sm">
                                尚無交易紀錄
                              </td>
                            </tr>
                          ) : (
                            [...(student.bank?.transactions || [])].reverse().map(tx => {
                              const isVoided = tx.voided
                              const isCorrection = tx.type === 'correction'
                              return (
                                <tr key={tx.id} className={`border-t border-[#F0F0F0] ${isVoided ? 'opacity-40' : 'hover:bg-[#F9F9F9]'}`}>
                                  <td className={`px-3 py-2 text-[#8B8B8B] text-xs whitespace-nowrap ${isVoided ? 'line-through' : ''}`}>
                                    {new Date(tx.date).toLocaleDateString()}
                                  </td>
                                  <td className={`px-3 py-2 text-xs ${isVoided ? 'line-through text-[#8B8B8B]' : isCorrection ? 'text-[#A0A0A0] italic' : 'text-[#5D5D5D]'}`}>
                                    {isCorrection && <span className="text-[10px] bg-[#E8E8E8] rounded px-1 py-0.5 mr-1">更正</span>}
                                    {tx.reason}
                                  </td>
                                  <td className={`px-3 py-2 text-right font-bold text-xs ${isVoided ? 'line-through text-[#8B8B8B]' : tx.amount >= 0 ? 'text-[#4A7C59]' : 'text-[#D64545]'}`}>
                                    {tx.amount > 0 ? '+' : ''}{tx.amount}
                                  </td>
                                  <td className={`px-3 py-2 text-right font-medium text-xs ${isVoided ? 'line-through text-[#8B8B8B]' : 'text-[#5D5D5D]'}`}>
                                    {tx.balance}
                                  </td>
                                  <td className="px-2 py-2 text-center">
                                    {!isVoided && !isCorrection && onUndoTransaction && (
                                      <button
                                        onClick={() => onUndoTransaction(student.id, tx.id)}
                                        className="p-1 rounded-lg hover:bg-[#FFADAD]/20 text-[#8B8B8B] hover:text-[#D64545] transition-colors"
                                        title="撤銷此筆交易"
                                      >
                                        <Undo2 size={14} />
                                      </button>
                                    )}
                                    {isCorrection && (
                                      <span className="text-[10px] text-[#A0A0A0]">↩</span>
                                    )}
                                  </td>
                                </tr>
                              )
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* ===== Edit Tab ===== */}
              {activeTab === 'edit' && (
                <div className="space-y-4 max-w-md">
                  <div>
                    <label className="text-xs font-bold text-[#5D5D5D] mb-1 block">村民姓名</label>
                    <input
                      type="text"
                      value={editData.name}
                      onChange={e => setEditData(p => ({...p, name: e.target.value}))}
                      className="w-full px-4 py-2.5 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-sm"
                      placeholder="村民姓名"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[#5D5D5D] mb-1 block">所屬小隊</label>
                    <select
                      value={editData.group}
                      onChange={e => setEditData(p => ({...p, group: e.target.value}))}
                      className="w-full px-4 py-2.5 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-sm"
                    >
                      <option key="unassigned" value="unassigned">待分配</option>
                      {['A', 'B', 'C', 'D', 'E', 'F'].map(g => (
                        <option key={g} value={g}>{settings?.groupAliases?.[g] || `${g} 小隊`}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button onClick={saveEdit} className="flex-1 bg-[#A8D8B9] text-white py-2.5 rounded-xl font-bold text-sm hover:bg-[#7BC496] transition-colors">
                      儲存變更
                    </button>
                    <button onClick={() => { setEditData({ name: student.name, gender: student.gender, group: student.group }); setActiveTab('tasks') }} className="bg-[#E8E8E8] text-[#5D5D5D] px-6 py-2.5 rounded-xl text-sm font-medium hover:bg-[#D8D8D8] transition-colors">
                      取消
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default PassportModal
