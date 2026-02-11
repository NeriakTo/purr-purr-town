// v3.7.0: 職務設定 Tab (從 SettingsModal 抽取 + 快速分配模式)
import { useEffect, useRef, useState } from 'react'
import { X, Plus, Trash2, Briefcase, Banknote, ChevronDown, Zap, Download, Users } from 'lucide-react'
import { JOB_CYCLES, JOB_CATEGORIES } from '../../../utils/constants'
import { generateId, resolveCurrency } from '../../../utils/helpers'
import { exportJobsToExcel } from '../../../utils/exportUtils'
import IconPicker, { RenderIcon } from '../../common/IconPicker'

function JobSettingsTab({ localSettings, setLocalSettings, students, className, onProcessPayroll }) {
  const [showPayroll, setShowPayroll] = useState(false)
  const [selectedPayrollCycles, setSelectedPayrollCycles] = useState([])
  const [openStudentDropdown, setOpenStudentDropdown] = useState(null)
  const [dropdownAlignRight, setDropdownAlignRight] = useState(false)
  const [quickAssignMode, setQuickAssignMode] = useState(false)
  const [selectedJobId, setSelectedJobId] = useState(null)
  const studentDropdownRef = useRef(null)

  // 點擊外部關閉 dropdown
  useEffect(() => {
    if (!openStudentDropdown) return
    function handleClick(e) {
      if (studentDropdownRef.current && !studentDropdownRef.current.contains(e.target)) {
        setOpenStudentDropdown(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [openStudentDropdown])

  // --- Jobs CRUD ---
  const updateJob = (jobId, field, value) => {
    setLocalSettings(p => ({
      ...p,
      jobs: p.jobs.map(j => {
        if (j.id !== jobId) return j
        if (field === 'salary') return { ...j, salary: parseInt(value) || 0 }
        return { ...j, [field]: value }
      })
    }))
  }

  const addJob = () => {
    setLocalSettings(p => ({
      ...p,
      jobs: [...p.jobs, { id: generateId('job'), title: '', salary: 100, icon: '📋', cycle: 'weekly', category: 'other' }]
    }))
  }

  const removeJob = (jobId) => {
    setLocalSettings(p => ({
      ...p,
      jobs: p.jobs.filter(j => j.id !== jobId),
      jobAssignments: { ...p.jobAssignments, [jobId]: undefined },
    }))
  }

  // --- Job Assignments ---
  const addStudentToJob = (jobId, studentId) => {
    setLocalSettings(p => ({
      ...p,
      jobAssignments: {
        ...p.jobAssignments,
        [jobId]: [...(p.jobAssignments[jobId] || []), studentId],
      }
    }))
  }

  const removeStudentFromJob = (jobId, studentId) => {
    setLocalSettings(p => ({
      ...p,
      jobAssignments: {
        ...p.jobAssignments,
        [jobId]: (p.jobAssignments[jobId] || []).filter(id => id !== studentId),
      }
    }))
  }

  const toggleStudentJob = (jobId, studentId) => {
    const assigned = (localSettings.jobAssignments[jobId] || []).includes(studentId)
    if (assigned) removeStudentFromJob(jobId, studentId)
    else addStudentToJob(jobId, studentId)
  }

  const selectAllStudentsForJob = (jobId) => {
    setLocalSettings(p => ({
      ...p,
      jobAssignments: { ...p.jobAssignments, [jobId]: students.map(s => s.id) }
    }))
  }

  const clearAllStudentsForJob = (jobId) => {
    setLocalSettings(p => ({
      ...p,
      jobAssignments: { ...p.jobAssignments, [jobId]: [] }
    }))
  }

  // --- Payroll ---
  const payrollPreview = () => {
    const entries = []
    localSettings.jobs.forEach(job => {
      if (!selectedPayrollCycles.includes(job.cycle)) return
      const assignedIds = localSettings.jobAssignments[job.id] || []
      assignedIds.forEach(sid => {
        const student = students.find(s => s.id === sid)
        if (!student) return
        entries.push({ studentId: sid, studentName: student.name, amount: job.salary, reason: `${job.title} 薪資 (${JOB_CYCLES[job.cycle] || job.cycle})` })
      })
    })
    return entries
  }

  const handleProcessPayroll = () => {
    const entries = payrollPreview()
    if (entries.length === 0) return
    if (onProcessPayroll) onProcessPayroll(entries)
    setShowPayroll(false)
    setSelectedPayrollCycles([])
  }

  const handleExportJobs = () => {
    exportJobsToExcel(localSettings.jobs, localSettings.jobAssignments, students, className)
  }

  // 快速分配模式下選中的 job
  const selectedJob = localSettings.jobs.find(j => j.id === selectedJobId)
  const selectedJobAssigned = selectedJobId ? (localSettings.jobAssignments[selectedJobId] || []) : []

  return (
    <div className="p-6 space-y-6">
      {/* 標題列 */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h3 className="text-sm font-bold text-[#5D5D5D] flex items-center gap-2">
            <Briefcase size={16} className="text-[#FFD6A5]" />
            班級職務
          </h3>
          <p className="text-xs text-[#8B8B8B]">設定班級職務、薪資與發放週期，並指派村民</p>
        </div>
        <div className="flex items-center gap-2">
          {/* 快速分配模式切換 */}
          <button
            onClick={() => { setQuickAssignMode(v => !v); setSelectedJobId(null) }}
            className={`px-3 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-1.5
              ${quickAssignMode ? 'bg-[#A8D8B9] text-white shadow-md' : 'bg-[#fdfbf7] text-[#5D5D5D] hover:bg-[#A8D8B9]/20'}`}
          >
            <Zap size={14} />
            快速分配
          </button>
          {/* 匯出 */}
          <button
            onClick={handleExportJobs}
            className="px-3 py-2 rounded-xl bg-[#fdfbf7] text-[#5D5D5D] text-sm font-medium hover:bg-[#A8D8B9]/20 transition-colors flex items-center gap-1.5"
          >
            <Download size={14} />
            匯出
          </button>
          {/* 發放薪資 */}
          <button
            onClick={() => { setSelectedPayrollCycles([]); setShowPayroll(true) }}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#FFD6A5] to-[#FFBF69] text-white font-bold text-sm shadow-md hover:shadow-lg transition-all flex items-center gap-1.5"
          >
            <Banknote size={16} />
            發放薪資
          </button>
        </div>
      </div>

      {/* ===== 快速分配模式 ===== */}
      {quickAssignMode ? (
        <div className="flex gap-4 min-h-[400px]">
          {/* 左欄：職務卡片 */}
          <div className="w-64 shrink-0 space-y-2 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
            {localSettings.jobs.map(job => {
              const assigned = (localSettings.jobAssignments[job.id] || []).length
              const catInfo = JOB_CATEGORIES[job.category || 'other']
              const isSelected = selectedJobId === job.id
              return (
                <button
                  key={job.id}
                  onClick={() => setSelectedJobId(job.id)}
                  className={`w-full p-3 rounded-xl border-2 text-left transition-all
                    ${isSelected ? 'border-[#7BC496] bg-[#A8D8B9]/10 shadow-md' : 'border-[#E8E8E8] hover:border-[#A8D8B9] bg-white'}`}
                >
                  <div className="flex items-center gap-2">
                    <RenderIcon name={job.icon} size={20} />
                    <span className="font-bold text-sm text-[#5D5D5D] flex-1 truncate">{job.title || '(未命名)'}</span>
                    <span
                      className="px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                      style={{ backgroundColor: `${catInfo.color}30`, color: '#5D5D5D' }}
                    >
                      {catInfo.label}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-[#8B8B8B]">
                    已指派 <span className="font-bold text-[#5D5D5D]">{assigned}</span> 人
                  </div>
                </button>
              )
            })}
          </div>

          {/* 右欄：學生名單 */}
          <div className="flex-1 bg-white rounded-xl border border-[#E8E8E8] overflow-hidden flex flex-col">
            {!selectedJob ? (
              <div className="flex-1 flex items-center justify-center text-sm text-[#ABABAB]">
                <Users size={20} className="mr-2" />
                請先選擇左側職務
              </div>
            ) : (
              <>
                <div className="px-4 py-3 border-b border-[#E8E8E8] bg-[#F9F9F9] flex items-center justify-between">
                  <span className="text-sm font-bold text-[#5D5D5D]">
                    <RenderIcon name={selectedJob.icon} size={16} className="inline mr-1" />
                    {selectedJob.title} — 點擊學生即可指派/取消
                  </span>
                  <span className="text-xs text-[#8B8B8B]">
                    已指派 {selectedJobAssigned.length}/{students.length}
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto p-3" style={{ scrollbarWidth: 'thin' }}>
                  {/* 已指派 */}
                  {selectedJobAssigned.length > 0 && (
                    <div className="mb-3">
                      <div className="text-[10px] font-bold text-[#8B8B8B] uppercase tracking-wider mb-1.5">已指派</div>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedJobAssigned.map(sid => {
                          const s = students.find(x => x.id === sid)
                          if (!s) return null
                          return (
                            <button
                              key={sid}
                              onClick={() => toggleStudentJob(selectedJobId, sid)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#A8D8B9]/20 border border-[#A8D8B9] rounded-lg text-xs font-medium text-[#5D5D5D] hover:bg-[#FFADAD]/20 hover:border-[#FFADAD] transition-colors"
                            >
                              {s.number}號 {s.name}
                              <X size={10} className="text-[#8B8B8B]" />
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* 未指派 */}
                  {(() => {
                    const unassigned = students.filter(s => !selectedJobAssigned.includes(s.id))
                    if (unassigned.length === 0) return (
                      <div className="text-center text-xs text-[#ABABAB] py-4">全部已指派 🎉</div>
                    )
                    return (
                      <div>
                        <div className="text-[10px] font-bold text-[#8B8B8B] uppercase tracking-wider mb-1.5">未指派</div>
                        <div className="flex flex-wrap gap-1.5">
                          {unassigned.map(s => (
                            <button
                              key={s.id}
                              onClick={() => toggleStudentJob(selectedJobId, s.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#fdfbf7] border border-[#E8E8E8] rounded-lg text-xs text-[#8B8B8B] hover:bg-[#A8D8B9]/10 hover:border-[#A8D8B9] hover:text-[#5D5D5D] transition-colors"
                            >
                              {s.number}號 {s.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })()}
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        /* ===== 傳統模式 (原 SettingsModal 職務列表) ===== */
        <>
          <div className="space-y-3">
            {localSettings.jobs.map(job => (
              <div key={job.id} className="p-3 bg-white rounded-xl border border-[#E8E8E8] hover:border-[#FFD6A5] transition-colors space-y-2">
                <div className="flex items-center gap-3">
                  <IconPicker value={job.icon} onChange={v => updateJob(job.id, 'icon', v)} />
                  <input
                    type="text"
                    value={job.title}
                    onChange={e => updateJob(job.id, 'title', e.target.value)}
                    className="flex-1 px-3 py-2 rounded-lg border border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-sm font-medium"
                    placeholder="職務名稱"
                  />
                  <select
                    value={job.category || 'other'}
                    onChange={e => updateJob(job.id, 'category', e.target.value)}
                    className="px-2 py-2 rounded-lg border border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-xs font-medium"
                  >
                    {Object.entries(JOB_CATEGORIES).map(([k, v]) => (
                      <option key={k} value={k}>{v.icon} {v.label}</option>
                    ))}
                  </select>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      value={job.salary}
                      onChange={e => updateJob(job.id, 'salary', e.target.value)}
                      onFocus={e => e.target.select()}
                      className="w-20 px-2 py-2 rounded-lg border border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-sm text-center font-bold"
                    />
                    <span className="text-xs text-[#8B8B8B] whitespace-nowrap">pt</span>
                  </div>
                  <select
                    value={job.cycle || 'weekly'}
                    onChange={e => updateJob(job.id, 'cycle', e.target.value)}
                    className="px-2 py-2 rounded-lg border border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-xs font-medium"
                  >
                    {Object.entries(JOB_CYCLES).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => removeJob(job.id)}
                    className="p-1.5 rounded-lg hover:bg-[#FFADAD]/20 text-[#8B8B8B] hover:text-[#D64545] transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                {/* Student assignments */}
                <div className="ml-12 space-y-1.5">
                  {(localSettings.jobAssignments[job.id] || []).length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 max-h-[100px] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                      {(localSettings.jobAssignments[job.id] || []).map(sid => {
                        const s = students.find(x => x.id === sid)
                        if (!s) return null
                        return (
                          <span key={sid} className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#FFD6A5]/20 rounded-full text-xs font-medium text-[#8B6914]">
                            {s.number}號 {s.name}
                            <button onClick={() => removeStudentFromJob(job.id, sid)} className="hover:text-[#D64545]">
                              <X size={10} />
                            </button>
                          </span>
                        )
                      })}
                    </div>
                  )}
                  <div className="relative" ref={openStudentDropdown === job.id ? studentDropdownRef : null}>
                    <button
                      type="button"
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect()
                        setDropdownAlignRight(rect.left > window.innerWidth / 2)
                        setOpenStudentDropdown(openStudentDropdown === job.id ? null : job.id)
                      }}
                      className="text-xs px-2 py-1 rounded-lg border border-dashed border-[#E8E8E8] text-[#8B8B8B] hover:border-[#FFD6A5] cursor-pointer bg-transparent flex items-center gap-1"
                    >
                      <Plus size={10} /> 指派村民
                      <ChevronDown size={10} className={`transition-transform ${openStudentDropdown === job.id ? 'rotate-180' : ''}`} />
                    </button>
                    {openStudentDropdown === job.id && (
                      <div className={`absolute z-50 top-full mt-1 w-56 bg-white rounded-xl shadow-xl border border-[#E8E8E8] overflow-hidden ${dropdownAlignRight ? 'right-0' : 'left-0'}`}>
                        <div className="sticky top-0 bg-[#F9F9F9] border-b border-[#E8E8E8] px-2 py-1.5 flex gap-2 z-10">
                          <button
                            type="button"
                            onClick={() => selectAllStudentsForJob(job.id)}
                            className="flex-1 py-1 rounded-lg bg-[#A8D8B9] text-white text-xs font-bold hover:bg-[#7BC496] transition-colors"
                          >
                            全選
                          </button>
                          <button
                            type="button"
                            onClick={() => clearAllStudentsForJob(job.id)}
                            className="flex-1 py-1 rounded-lg bg-[#E8E8E8] text-[#5D5D5D] text-xs font-bold hover:bg-[#D8D8D8] transition-colors"
                          >
                            清空
                          </button>
                        </div>
                        <div className="max-h-48 overflow-y-auto p-1.5 space-y-0.5" style={{ scrollbarWidth: 'thin' }}>
                          {students.map(s => {
                            const isAssigned = (localSettings.jobAssignments[job.id] || []).includes(s.id)
                            return (
                              <label
                                key={s.id}
                                className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[#F9F9F9] cursor-pointer text-xs"
                              >
                                <input
                                  type="checkbox"
                                  checked={isAssigned}
                                  onChange={() => toggleStudentJob(job.id, s.id)}
                                  className="accent-[#A8D8B9] shrink-0"
                                />
                                <span className={isAssigned ? 'font-bold text-[#5D5D5D]' : 'text-[#8B8B8B]'}>
                                  {s.number}號 {s.name}
                                </span>
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={addJob}
            className="w-full py-3 rounded-xl border-2 border-dashed border-[#E8E8E8] text-[#8B8B8B] font-medium hover:border-[#FFD6A5] hover:text-[#8B6914] transition-colors flex items-center justify-center gap-2"
          >
            <Plus size={18} /> 新增職務
          </button>
        </>
      )}

      {/* ===== 薪資發放 Sub-Modal ===== */}
      {showPayroll && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full mx-4 shadow-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4 shrink-0">
              <h3 className="text-lg font-bold text-[#5D5D5D] flex items-center gap-2">
                <Banknote size={20} className="text-[#FFD6A5]" />
                發放薪資
              </h3>
              <button onClick={() => setShowPayroll(false)} className="p-1.5 rounded-full hover:bg-[#E8E8E8]">
                <X size={18} className="text-[#5D5D5D]" />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto space-y-4" style={{ scrollbarWidth: 'thin' }}>
              <p className="text-xs text-[#8B8B8B]">勾選要發放的薪資週期，系統會自動計算並批次入帳</p>

              <div className="space-y-2">
                {Object.entries(JOB_CYCLES).map(([cycleKey, cycleLabel]) => {
                  const jobsInCycle = localSettings.jobs.filter(j => j.cycle === cycleKey)
                  if (jobsInCycle.length === 0) return null
                  const checked = selectedPayrollCycles.includes(cycleKey)
                  return (
                    <label key={cycleKey} className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${checked ? 'border-[#FFD6A5] bg-[#FFD6A5]/10' : 'border-[#E8E8E8] hover:border-[#FFD6A5]/50'}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setSelectedPayrollCycles(prev =>
                            prev.includes(cycleKey) ? prev.filter(c => c !== cycleKey) : [...prev, cycleKey]
                          )
                        }}
                        className="mt-0.5 accent-[#FFD6A5]"
                      />
                      <div className="flex-1">
                        <div className="text-sm font-bold text-[#5D5D5D]">{cycleLabel}</div>
                        <div className="mt-1 space-y-1">
                          {jobsInCycle.map(job => {
                            const assigned = (localSettings.jobAssignments[job.id] || [])
                              .map(sid => students.find(s => s.id === sid))
                              .filter(Boolean)
                            return (
                              <div key={job.id} className="text-xs text-[#8B8B8B] flex items-center gap-2">
                                <RenderIcon name={job.icon} size={14} />
                                <span className="font-medium text-[#5D5D5D]">{job.title}</span>
                                <span>({job.salary} pt)</span>
                                <span className="text-[10px]">
                                  {assigned.length > 0 ? assigned.map(s => s.name).join(', ') : '(未指派)'}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </label>
                  )
                })}
              </div>

              {selectedPayrollCycles.length > 0 && (() => {
                const entries = payrollPreview()
                if (entries.length === 0) return (
                  <div className="p-3 rounded-xl bg-[#F9F9F9] text-center text-xs text-[#8B8B8B]">
                    選中的週期沒有已指派村民的職務
                  </div>
                )
                const total = entries.reduce((sum, e) => sum + e.amount, 0)
                return (
                  <div className="p-4 rounded-xl bg-[#E8F5E9] border border-[#A8D8B9]/30 space-y-2">
                    <div className="text-xs font-bold text-[#4A7C59]">發放預覽</div>
                    {entries.map((entry, idx) => (
                      <div key={idx} className="flex items-center justify-between text-xs">
                        <span className="text-[#5D5D5D]">{entry.studentName}</span>
                        <span className="font-bold text-[#4A7C59]">+{entry.amount} pt</span>
                      </div>
                    ))}
                    <div className="border-t border-[#A8D8B9]/30 pt-2 flex items-center justify-between text-sm">
                      <span className="font-bold text-[#5D5D5D]">總計</span>
                      <span className="font-bold text-[#4A7C59]">+{total} pt</span>
                    </div>
                  </div>
                )
              })()}
            </div>

            <div className="flex gap-3 mt-4 shrink-0">
              <button
                onClick={() => setShowPayroll(false)}
                className="flex-1 py-2.5 rounded-xl bg-[#E8E8E8] text-[#5D5D5D] font-medium hover:bg-[#D8D8D8] transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleProcessPayroll}
                disabled={payrollPreview().length === 0}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-[#FFD6A5] to-[#FFBF69] text-white font-bold shadow-md hover:shadow-lg transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              >
                <Banknote size={16} />
                確認發放
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default JobSettingsTab
