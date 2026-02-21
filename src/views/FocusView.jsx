// v3.7.2: 投影模式 — 直式書寫 + 放大文字 + 依截止日期排序
import { useEffect, useState } from 'react'
import { formatDateDisplay } from '../utils/helpers'

function FocusView({ tasks, currentDateStr, onClose }) {
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

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 focus-overlay" />
      <div className="absolute inset-0 px-6 md:px-10 py-6 md:py-10 flex flex-col">
        {/* 頂部：日期 + 關閉 */}
        <div className="flex items-start justify-between gap-4 shrink-0">
          <div className="text-[#E8F5E9] font-chalk text-5xl md:text-7xl lg:text-8xl tracking-wide">
            {formatDateDisplay(currentDateStr)}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-[#E8F5E9] text-[#1f3327] font-bold text-lg shadow-lg hover:scale-105 transition-transform shrink-0"
          >
            ❌ 關閉
          </button>
        </div>

        {/* 任務區域 */}
        <div className="mt-6 flex-1 overflow-hidden">
          {tasks.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-[#E8F5E9]">
              <div className="text-7xl md:text-9xl mb-6">🐾</div>
              <div className="font-chalk text-4xl md:text-6xl text-center">今日無作業，放學囉！</div>
            </div>
          ) : (
            <div className="h-full flex flex-row-reverse items-stretch gap-4 md:gap-6 overflow-x-auto px-2 py-4">
              {tasks.map(task => {
                const isChecked = !!checked[task.id]
                return (
                  <button
                    key={task.id}
                    onClick={() => toggleTask(task.id)}
                    className="flex flex-col items-center gap-3 shrink-0 group"
                  >
                    <span className={`focus-checkbox-vertical ${isChecked ? 'is-checked' : ''}`} />
                    <span
                      className={`focus-vertical-text font-chalk text-4xl md:text-6xl lg:text-7xl text-[#E8F5E9] leading-tight ${isChecked ? 'focus-strike-vertical' : ''}`}
                    >
                      {task.title}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default FocusView
