import { useState } from 'react'
import { Settings, Pin, UserCheck, Coins, ChevronDown, Check, Plus } from 'lucide-react'
import { generateId } from '../../utils/helpers'

function DutySetupCard({ jobs, onDutySetup }) {
  const [expanded, setExpanded] = useState(false)

  const handleAutoCreate = () => {
    const newJobId = generateId('job')
    onDutySetup(newJobId, { id: newJobId, title: '值日生', salary: 50, icon: '💂', cycle: 'daily', category: 'other' })
  }

  return (
    <div className="mb-3 p-3 rounded-xl bg-[#FFD6A5]/10 border border-[#FFD6A5]/30">
      <div className="text-xs font-bold text-[#8B6914] mb-2 flex items-center gap-1.5">
        <UserCheck size={14} />
        設定值日生職務
      </div>
      {!expanded ? (
        <div className="space-y-2">
          <p className="text-[10px] text-[#8B8B8B]">��次使用需先指定哪個職務是「值日生」</p>
          <div className="flex gap-2">
            <button
              onClick={handleAutoCreate}
              className="flex-1 py-1.5 rounded-lg bg-[#FFD6A5] text-white text-xs font-bold hover:bg-[#FFBF69] transition-colors"
            >
              一鍵建立
            </button>
            <button
              onClick={() => setExpanded(true)}
              className="flex-1 py-1.5 rounded-lg bg-white border border-[#E8E8E8] text-xs font-medium text-[#5D5D5D] hover:bg-[#F9F9F9] transition-colors"
            >
              從現有選擇
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-32 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
          {jobs.length === 0 ? (
            <p className="text-[10px] text-[#8B8B8B]">尚無職務，請先到設定中新增</p>
          ) : (
            jobs.map(job => (
              <button
                key={job.id}
                onClick={() => onDutySetup(job.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[#FFD6A5]/20 text-xs text-[#5D5D5D] transition-colors text-left"
              >
                <span>{job.icon}</span>
                <span className="font-medium">{job.title}</span>
                <span className="text-[#8B8B8B]">({job.salary} pt)</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function DutyStudentSection({ activeStudents, dailyDuty, dutyJob, onDutyChange, onDutyPayroll, onDutySetup, jobs }) {
  const [showPicker, setShowPicker] = useState(false)

  if (!dutyJob) {
    return <DutySetupCard jobs={jobs} onDutySetup={onDutySetup} />
  }

  const { studentIds = [], paid = false } = dailyDuty || {}
  const selectedStudents = studentIds.map(id => activeStudents.find(s => s.id === id)).filter(Boolean)

  const toggleStudent = (studentId) => {
    const next = studentIds.includes(studentId)
      ? studentIds.filter(id => id !== studentId)
      : [...studentIds, studentId]
    onDutyChange(next)
  }

  return (
    <div className="mb-3 p-3 rounded-xl bg-white/80 border border-[#E8E8E8]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-[#5D5D5D] flex items-center gap-1.5">
          <UserCheck size={13} className="text-[#FFD6A5]" />
          今日值日生
        </span>
        <span className="text-[10px] text-[#8B8B8B]">{dutyJob.icon} {dutyJob.salary} pt</span>
      </div>

      {selectedStudents.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selectedStudents.map(s => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#FFD6A5]/20 rounded-full text-xs font-medium text-[#8B6914] cursor-pointer hover:bg-[#FFADAD]/20 transition-colors"
              onClick={() => toggleStudent(s.id)}
            >
              {s.number}號 {s.name}
              <span className="text-[10px]">✕</span>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[10px] text-[#8B8B8B] mb-2">尚未選擇值日生</p>
      )}

      <div className="flex gap-1.5">
        <button
          onClick={() => setShowPicker(v => !v)}
          className="flex-1 py-1.5 rounded-lg bg-[#fdfbf7] border border-[#E8E8E8] text-xs text-[#5D5D5D] hover:border-[#FFD6A5] transition-colors flex items-center justify-center gap-1"
        >
          {showPicker ? <ChevronDown size={12} className="rotate-180" /> : <Plus size={12} />}
          選擇
        </button>
        {selectedStudents.length > 0 && (
          <button
            onClick={onDutyPayroll}
            disabled={paid}
            className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1
              ${paid
                ? 'bg-[#E8F5E9] text-[#4A7C59] cursor-default'
                : 'bg-gradient-to-r from-[#FFD6A5] to-[#FFBF69] text-white hover:shadow-md'
              }`}
          >
            {paid ? <><Check size={12} /> 已發放</> : <><Coins size={12} /> 發薪</>}
          </button>
        )}
      </div>

      {showPicker && (
        <div className="mt-2 max-h-36 overflow-y-auto border border-[#E8E8E8] rounded-lg p-1.5 space-y-0.5" style={{ scrollbarWidth: 'thin' }}>
          {activeStudents.map(s => {
            const isSelected = studentIds.includes(s.id)
            return (
              <button
                key={s.id}
                onClick={() => toggleStudent(s.id)}
                className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-xs transition-colors text-left
                  ${isSelected ? 'bg-[#FFD6A5]/20 text-[#8B6914] font-bold' : 'text-[#8B8B8B] hover:bg-[#F9F9F9]'}`}
              >
                {isSelected && <Check size={10} />}
                <span>{s.number}號 {s.name}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function BulletinBoard({ announcements = [], onOpenAnnouncements, activeStudents = [], dailyDuty, dutyJob, onDutyChange, onDutyPayroll, onDutySetup, jobs = [] }) {
  const handleDutySetup = (jobId, newJob) => {
    if (onDutySetup) onDutySetup(jobId, newJob)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2 shrink-0">
        <h2 className="text-xl font-bold text-[#5D5D5D] flex items-center gap-2">
          <Pin size={18} className="text-[#D97706]" />村莊布告欄
        </h2>
        <button
          onClick={onOpenAnnouncements}
          className="p-2 rounded-xl bg-white/70 hover:bg-white transition-colors"
          title="管理公告"
        >
          <Settings size={16} className="text-[#5D5D5D]" />
        </button>
      </div>

      <div className="flex-1 min-h-0 rounded-2xl p-4 shadow-md border border-[#C8A070] cork-texture overflow-y-auto">
        {onDutyChange && (
          <DutyStudentSection
            activeStudents={activeStudents}
            dailyDuty={dailyDuty}
            dutyJob={dutyJob}
            onDutyChange={onDutyChange}
            onDutyPayroll={onDutyPayroll}
            onDutySetup={handleDutySetup}
            jobs={jobs}
          />
        )}

        {announcements.length === 0 ? (
          <div className="text-xs text-[#5D5D5D]/70 bg-white/60 rounded-xl p-3 text-center">
            尚無公告，點擊右上角齒輪新增吧！
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {announcements.map((item) => (
              <div
                key={item.id}
                className="relative polaroid-card rounded-xl text-[#5D5D5D]"
                style={{ backgroundColor: item.color, '--rotation': `${item.rotate}deg` }}
              >
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Pin size={14} className="text-[#D97706]" />
                </div>
                <div className="text-base whitespace-pre-wrap leading-relaxed">
                  {item.text}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default BulletinBoard
