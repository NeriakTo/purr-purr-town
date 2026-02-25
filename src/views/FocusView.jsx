import { useEffect, useState } from 'react'
import { formatDateDisplay } from '../utils/helpers'

function FocusView({ tomorrowTasks, upcomingTasks, currentDateStr, onClose }) {
  const [checked, setChecked] = useState({})

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const toggleTask = (taskId) => {
    setChecked(prev => ({ ...prev, [taskId]: !prev[taskId] }))
  }

  const noTasks = tomorrowTasks.length === 0 && upcomingTasks.length === 0

  // 將 dueDate (yyyy-MM-dd) 轉為短顯示 (M/D)
  const formatDueDateShort = (dateStr) => {
    if (!dateStr) return ''
    const [, m, d] = dateStr.split('-')
    return `${parseInt(m, 10)}/${parseInt(d, 10)}`
  }

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 focus-overlay" />
      <div className="absolute inset-0 px-6 md:px-10 py-6 md:py-10 flex flex-col">
        {/* 頂部：日期 + 關閉 */}
        <div className="flex items-center justify-between gap-4 shrink-0">
          <div className="text-[#E8F5E9] font-chalk text-3xl md:text-5xl lg:text-6xl tracking-wide">
            {formatDateDisplay(currentDateStr)}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-[#E8F5E9] text-[#1f3327] font-bold text-lg shadow-lg hover:scale-105 transition-transform shrink-0"
          >
            ❌ 關閉
          </button>
        </div>

        {/* 主體內容 */}
        {noTasks ? (
          <div className="flex-1 flex flex-col items-center justify-center text-[#E8F5E9]">
            <div className="text-6xl md:text-8xl mb-6">🐾</div>
            <div className="font-chalk text-3xl md:text-5xl text-center">今日無作業，放學囉！</div>
          </div>
        ) : (
          <div className="mt-6 flex-1 flex gap-6 md:gap-8 overflow-hidden min-h-0">
            {/* 左側面板 — 隔日任務（明天到期） */}
            <div className="flex-1 flex flex-col min-w-0 min-h-0">
              <div className="font-chalk text-2xl md:text-3xl text-[#FFBF69] mb-4 shrink-0 flex items-center gap-2">
                <span>📋</span> 明日作業
              </div>
              <div className="flex-1 overflow-y-auto space-y-3 md:space-y-4 pr-2 focus-scrollbar">
                {tomorrowTasks.length === 0 ? (
                  <div className="text-[#E8F5E9]/40 font-chalk text-xl md:text-2xl text-center mt-8">
                    明天沒有作業
                  </div>
                ) : (
                  tomorrowTasks.map(task => {
                    const isChecked = !!checked[task.id]
                    return (
                      <button
                        key={task.id}
                        onClick={() => toggleTask(task.id)}
                        className="w-full flex items-center gap-3 md:gap-5 text-left group"
                      >
                        <span className={`focus-checkbox shrink-0 ${isChecked ? 'is-checked' : ''}`} />
                        <span className={`font-chalk text-2xl md:text-4xl lg:text-5xl text-[#E8F5E9] ${isChecked ? 'focus-strike' : ''}`}>
                          {task.title}
                        </span>
                      </button>
                    )
                  })
                )}
              </div>
            </div>

            {/* 分隔線 */}
            <div className="w-px bg-[#E8F5E9]/20 shrink-0 self-stretch" />

            {/* 右側面板 — 排定任務（非隔日） */}
            <div className="flex-1 flex flex-col min-w-0 min-h-0">
              <div className="font-chalk text-2xl md:text-3xl text-[#87CEEB] mb-4 shrink-0 flex items-center gap-2">
                <span>📅</span> 排定任務
              </div>
              <div className="flex-1 overflow-y-auto space-y-3 md:space-y-4 pr-2 focus-scrollbar">
                {upcomingTasks.length === 0 ? (
                  <div className="text-[#E8F5E9]/40 font-chalk text-xl md:text-2xl text-center mt-8">
                    目前沒有排定任務
                  </div>
                ) : (
                  upcomingTasks.map(task => {
                    const isChecked = !!checked[task.id]
                    return (
                      <button
                        key={task.id}
                        onClick={() => toggleTask(task.id)}
                        className="w-full flex items-center gap-3 md:gap-5 text-left group"
                      >
                        <span className={`focus-checkbox shrink-0 ${isChecked ? 'is-checked' : ''}`} />
                        <span className={`font-chalk text-lg md:text-2xl text-[#FFD6A5] shrink-0 ${isChecked ? 'opacity-40' : ''}`}>
                          {formatDueDateShort(task.dueDate)}
                        </span>
                        <span className={`font-chalk text-2xl md:text-4xl lg:text-5xl text-[#E8F5E9] ${isChecked ? 'focus-strike' : ''}`}>
                          {task.title}
                        </span>
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default FocusView
