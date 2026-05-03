import { useState } from 'react'
import { Settings, Pin, Coins, Check } from 'lucide-react'
import { generateId } from '../../utils/helpers'

function DutySetupCard({ jobs, onDutySetup }) {
  const [expanded, setExpanded] = useState(false)

  const handleAutoCreate = () => {
    const newJobId = generateId('job')
    onDutySetup(newJobId, { id: newJobId, title: '值日生', salary: 50, icon: '💂', cycle: 'daily', category: 'other' })
  }

  return (
    <div className="relative polaroid-card rounded-xl text-[#5D5D5D] mb-3" style={{ backgroundColor: '#FFF8E7', '--rotation': '-1deg' }}>
      <div className="absolute -top-3 left-1/2 -translate-x-1/2">
        <Pin size={14} className="text-[#D97706]" />
      </div>
      <div className="text-sm font-bold mb-2">💂 值日生設定</div>
      {!expanded ? (
        <div className="space-y-2">
          <p className="text-xs text-[#8B8B8B]">首次使用需先指定值日生職務</p>
          <div className="flex gap-2">
            <button onClick={handleAutoCreate}
              className="flex-1 py-1.5 rounded-lg bg-[#FFD6A5] text-white text-xs font-bold hover:bg-[#FFBF69] transition-colors">
              一鍵建立
            </button>
            <button onClick={() => setExpanded(true)}
              className="flex-1 py-1.5 rounded-lg bg-white border border-[#E8E8E8] text-xs font-medium text-[#5D5D5D] hover:bg-[#F9F9F9] transition-colors">
              從現有選擇
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-1 max-h-28 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
          {jobs.length === 0 ? (
            <p className="text-xs text-[#8B8B8B]">尚無職務，請先到設定中新增</p>
          ) : jobs.map(job => (
            <button key={job.id} onClick={() => onDutySetup(job.id)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[#FFD6A5]/20 text-xs text-[#5D5D5D] transition-colors text-left">
              <span>{job.icon}</span>
              <span className="font-medium">{job.title}</span>
              <span className="text-[#8B8B8B]">({job.salary} pt)</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function DutyStudentSection({ activeStudents, dailyDuty, dutyJob, onDutyChange, onDutyPayroll, onDutySetup, jobs }) {
  const [inputValue, setInputValue] = useState('')

  if (!dutyJob) {
    return <DutySetupCard jobs={jobs} onDutySetup={onDutySetup} />
  }

  const { studentIds = [], paid = false } = dailyDuty || {}
  const selectedStudents = studentIds.map(id => activeStudents.find(s => s.id === id)).filter(Boolean)
  const validNumbers = activeStudents.map(s => s.number).filter(Boolean)

  const handleSubmit = () => {
    const numbers = inputValue
      .replace(/[,，、\s]+/g, ' ')
      .trim()
      .split(' ')
      .map(n => parseInt(n, 10))
      .filter(n => !isNaN(n) && validNumbers.includes(n))

    const ids = numbers
      .map(num => activeStudents.find(s => s.number === num))
      .filter(Boolean)
      .map(s => s.id)

    const unique = [...new Set(ids)]
    if (unique.length > 0) {
      onDutyChange(unique)
      setInputValue('')
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="relative polaroid-card rounded-xl text-[#5D5D5D] mb-3" style={{ backgroundColor: '#FFF8E7', '--rotation': '-1deg' }}>
      <div className="absolute -top-3 left-1/2 -translate-x-1/2">
        <Pin size={14} className="text-[#D97706]" />
      </div>

      {selectedStudents.length > 0 ? (
        <>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-bold">💂 今日值日生</span>
            <button
              onClick={onDutyPayroll}
              disabled={paid}
              className={`p-1.5 rounded-lg transition-all ${paid
                ? 'bg-[#E8F5E9] cursor-default'
                : 'bg-[#FFD6A5]/30 hover:bg-[#FFD6A5]/60'
              }`}
              title={paid ? '已發放' : '發放值日薪資'}
            >
              {paid
                ? <Check size={14} className="text-[#4A7C59]" />
                : <Coins size={14} className="text-[#8B6914]" />
              }
            </button>
          </div>
          <div className="text-base leading-relaxed">
            {selectedStudents.map((s, i) => (
              <span key={s.id}>
                {i > 0 && '、'}<span className="font-bold">{s.number}</span>號 {s.name}
              </span>
            ))}
          </div>
          {paid && (
            <div className="mt-1.5 text-[10px] text-[#4A7C59] font-medium">
              ✓ 已發放 {dutyJob.salary} pt / 人
            </div>
          )}
          <button
            onClick={() => onDutyChange([])}
            className="mt-2 text-[10px] text-[#AAAAAA] hover:text-[#8B8B8B] transition-colors"
          >
            重新設定
          </button>
        </>
      ) : (
        <>
          <div className="text-sm font-bold mb-2">💂 今日值日生</div>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="輸入座號（如 3 12）"
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-[#E8E8E8] focus:border-[#FFD6A5] outline-none text-sm bg-white"
            />
            <button
              onClick={handleSubmit}
              disabled={!inputValue.trim()}
              className="px-3 py-1.5 rounded-lg bg-[#FFD6A5] text-white text-xs font-bold hover:bg-[#FFBF69] transition-colors disabled:opacity-40 shrink-0"
            >
              確定
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-[#AAAAAA]">
            座號範圍 {Math.min(...validNumbers)}~{Math.max(...validNumbers)}，空格或逗號分隔
          </p>
        </>
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

        {announcements.length === 0 && !(onDutyChange) ? (
          <div className="text-xs text-[#5D5D5D]/70 bg-white/60 rounded-xl p-3 text-center">
            尚無公告，點擊右上角齒輪新增吧！
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {(announcements.length === 0 && onDutyChange) && (
              <div className="text-xs text-[#5D5D5D]/70 bg-white/60 rounded-xl p-3 text-center">
                尚無公告，點擊右上角齒輪新增吧！
              </div>
            )}
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
