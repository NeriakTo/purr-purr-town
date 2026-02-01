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
      <div className="absolute inset-0 px-6 md:px-12 py-8 md:py-12 flex flex-col">
        <div className="flex items-start justify-between gap-4">
          <div className="text-[#E8F5E9] font-chalk text-4xl md:text-6xl lg:text-7xl tracking-wide">
            {formatDateDisplay(currentDateStr)}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-[#E8F5E9] text-[#1f3327] font-bold text-lg shadow-lg hover:scale-105 transition-transform"
          >
            ❌ 關閉
          </button>
        </div>

        <div className="mt-8 flex-1 overflow-y-auto">
          {tasks.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-[#E8F5E9]">
              <div className="text-6xl md:text-8xl mb-6">🐾</div>
              <div className="font-chalk text-3xl md:text-5xl text-center">今日無作業，放學囉！</div>
            </div>
          ) : (
            <div className="space-y-4 md:space-y-6">
              {tasks.map(task => {
                const isChecked = !!checked[task.id]
                return (
                  <button
                    key={task.id}
                    onClick={() => toggleTask(task.id)}
                    className="w-full flex items-center gap-4 md:gap-6 text-left"
                  >
                    <span className={`focus-checkbox ${isChecked ? 'is-checked' : ''}`} />
                    <span className={`font-chalk text-3xl md:text-5xl lg:text-6xl text-[#E8F5E9] ${isChecked ? 'focus-strike' : ''}`}>
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

// ============================================
// 課堂法寶 (Gadgets)
// ============================================

export default FocusView
