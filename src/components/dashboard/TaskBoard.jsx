import { useState } from 'react'
import { ClipboardList, Projector, Plus, Trash2 } from 'lucide-react'
import { getTodayStr, getNextDay, normalizeStatus, getTaskIcon, getTaskTypeColor } from '../../utils/helpers'
import { STATUS_VALUES } from '../../utils/constants'

function TaskBoard({ tasks, students, studentStatus, onTasksUpdate, onAddTask, onDeleteTask, taskTypes, onOpenFocus, currentDateStr }) {
  const [showAddTask, setShowAddTask] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskType, setNewTaskType] = useState(taskTypes?.[0] || '作業')
  const [newTaskDueDate, setNewTaskDueDate] = useState(getNextDay(getTodayStr()))

  const handleAddTask = async () => {
    if (!newTaskTitle.trim()) return
    // v3.0.1: 發布邏輯 - createdAt=今天, dueDate=明天
    const createdAt = getTodayStr()
    const dueDate = newTaskDueDate || getNextDay(createdAt)
    const newTask = { id: `task_${Date.now()}`, title: newTaskTitle.trim(), type: newTaskType, createdAt, dueDate }
    if (onAddTask) {
      onAddTask(newTask)
    } else if (onTasksUpdate) {
      onTasksUpdate([...tasks, newTask])
    }
    setNewTaskTitle('')
    setNewTaskType(taskTypes?.[0] || '作業')
    setNewTaskDueDate(getNextDay(getTodayStr()))
    setShowAddTask(false)
  }

  const handleDeleteTask = (taskId) => {
    if (onDeleteTask) onDeleteTask(taskId)
  }

  const getTaskCompletion = (taskId) => {
    let completed = 0
    let total = 0
    students.forEach(s => {
      const st = studentStatus[s.id]?.[taskId]
      const norm = normalizeStatus(st)
      if (norm === STATUS_VALUES.LEAVE || norm === STATUS_VALUES.EXEMPT) return
      total++
      if (norm === STATUS_VALUES.ON_TIME || norm === STATUS_VALUES.LATE) completed++
    })
    return { completed, total }
  }

  return (
    <div>
      <div className="flex items-center h-10 mb-2 shrink-0 justify-between gap-3">
        <h2 className="text-xl font-bold text-[#5D5D5D] flex items-center gap-2">
          <ClipboardList size={18} className="text-[#FFD6A5]" />今日任務
        </h2>
        <button
          onClick={onOpenFocus}
          className="p-2 rounded-2xl bg-[#fdfbf7] hover:bg-[#A8D8B9]/20 transition-colors"
          title="投影模式"
        >
          <Projector size={22} className="text-[#5D5D5D]" />
        </button>
      </div>
      
      <div className="rounded-2xl p-4 shadow-md relative overflow-hidden bg-[#F5E6D3] border-4 border-[#8B7355]">
        {!showAddTask && (
          <button
            onClick={() => {
              setNewTaskDueDate(getNextDay(getTodayStr()))
              setShowAddTask(true)
            }}
            className="w-full mb-4 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#A8D8B9] text-white font-medium hover:bg-[#7BC496] transition-all shadow-md"
          >
            <Plus size={18} />發布新任務
          </button>
        )}

        {showAddTask && (
          <div className="mb-4 p-4 bg-white rounded-2xl shadow-md space-y-3">
            <input
              type="text"
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleAddTask()}
              placeholder="輸入任務名稱..."
              className="w-full px-4 py-2.5 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-[#5D5D5D]"
              autoFocus
            />
            <select
              value={newTaskType}
              onChange={(e) => setNewTaskType(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none bg-white text-[#5D5D5D]"
            >
              {taskTypes?.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
            <input
              type="date"
              value={newTaskDueDate}
              onChange={(e) => setNewTaskDueDate(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none bg-white text-[#5D5D5D]"
            />
            <p className="text-xs text-[#8B8B8B]">📅 今日發布，可調整截止日期</p>
            <div className="flex gap-2">
              <button onClick={handleAddTask} className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#A8D8B9] to-[#7BC496] text-white font-medium">發布</button>
              <button onClick={() => setShowAddTask(false)} className="px-4 py-2.5 rounded-xl bg-[#E8E8E8] text-[#5D5D5D] font-medium">取消</button>
            </div>
          </div>
        )}

        {tasks.length === 0 ? (
          <div className="text-center py-8 bg-white/50 rounded-2xl">
            <div className="text-4xl mb-3">😸</div>
            <p className="text-[#6B5344] font-medium">今日暫無任務</p>
          </div>
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => {
              const IconComponent = getTaskIcon(task.title)
              const { completed, total } = getTaskCompletion(task.id)
              const isAllDone = completed === total && total > 0
              const percentage = total > 0 ? Math.round((completed / total) * 100) : 0

              return (
                <div key={task.id} className={`rounded-xl p-3 shadow-sm group border-l-4 ${getTaskTypeColor(task.type || task.title).border} ${getTaskTypeColor(task.type || task.title).bg}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${isAllDone ? 'bg-[#A8D8B9]' : 'bg-[#FFD6A5]'}`}>
                      <IconComponent size={20} className="text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className={`font-medium text-[#5D5D5D] text-sm ${isAllDone ? 'line-through opacity-60' : ''}`}>{task.title}</h4>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 h-1.5 bg-[#E8E8E8] rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${percentage}%`,
                              backgroundColor: isAllDone ? '#A8D8B9' : '#FFD6A5'
                            }}
                          />
                        </div>
                        <span className="text-xs text-[#8B8B8B] whitespace-nowrap">{completed}/{total}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteTask(task.id)}
                      className="p-1.5 rounded-lg opacity-70 hover:opacity-100 hover:bg-[#FFADAD]/20 transition-all"
                    >
                      <Trash2 size={16} className="text-[#D64545]" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================
// 投影模式 (Focus View)
// ============================================

export default TaskBoard
