import { AlertCircle, Check } from 'lucide-react'
import AvatarEmoji from '../common/AvatarEmoji'
import { STATUS_VALUES } from '../../utils/constants'
import { isDoneStatus, isCountedInDenominator, normalizeStatus, isDefaultName } from '../../utils/helpers'

function VillagerCard({ student, tasks, studentStatus, onClick, hasOverdue }) {
  const status = studentStatus[student.id] || {}
  const hasTasks = tasks.length > 0

  const effectiveTasks = tasks.filter(t => isCountedInDenominator(status[t.id]))
  const completedCount = tasks.filter(t => isDoneStatus(status[t.id])).length
  const totalTasks = effectiveTasks.length
  const allDone = hasTasks && totalTasks > 0 && completedCount === totalTasks
  const hasIncomplete = hasTasks && completedCount < totalTasks

  const studentNumber = student.number || student.seatNumber
  const hasDefaultName = isDefaultName(student.name, studentNumber)

  const hasMissing = hasTasks && tasks.some(t => normalizeStatus(status[t.id]) === STATUS_VALUES.MISSING)

  const getBgStyle = () => {
    if (!hasTasks) return 'bg-[#F7F7F7] border-[#EBEBEB]'
    if (allDone) return 'bg-gradient-to-br from-[#EDF7EF] to-[#DFF0E3] border-[#B5DFBF]'
    if (hasMissing) return 'bg-gradient-to-br from-[#FFF0F0] to-[#FFE0E0] border-[#F0B5B5]'
    return 'bg-gradient-to-br from-[#FFF8F0] to-[#FFEDDA] border-[#F0D9B5]'
  }

  return (
    <div
      onClick={onClick}
      className={`relative h-full m-1 ${getBgStyle()} rounded-xl 2xl:rounded-lg p-2 2xl:p-1.5 cursor-pointer group transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md border flex flex-col`}
    >
      {/* 座號標籤 */}
      <div className={`absolute -top-1.5 -left-1.5 w-8 h-8 rounded-md flex items-center justify-center text-white text-sm font-extrabold shadow-sm z-10 ${
        allDone ? 'bg-[#7BC496]' : hasIncomplete ? 'bg-[#FFBF69]' : 'bg-[#C8C8C8]'
      }`}>
        {studentNumber || '?'}
      </div>

      {/* 欠交警示 */}
      {hasOverdue && (
        <div className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-[#D64545] flex items-center justify-center z-20 animate-pulse shadow-sm">
          <AlertCircle size={10} className="text-white" />
        </div>
      )}

      {/* 頭像區 */}
      <div className="relative w-full flex-1 min-h-0 rounded-lg overflow-hidden bg-white/60">
        <AvatarEmoji
          seed={student.uuid || student.id}
          className="w-full h-full rounded-lg text-4xl 2xl:text-5xl transition-transform duration-200 group-hover:scale-105"
        />

        {/* 完成狀態指示器（僅顯示，不可點擊） */}
        {hasTasks && (
          <div className="absolute bottom-0 right-0">
            {allDone ? (
              <div className="w-5 h-5 rounded-full bg-[#7BC496] flex items-center justify-center shadow-sm">
                <Check size={10} className="text-white" />
              </div>
            ) : (
              <div className="bg-white px-1 py-0.5 rounded shadow-sm border border-gray-100">
                <span className="font-black text-sm text-[#E8963A]">{completedCount}/{totalTasks}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 名字 */}
      <div className="text-center mt-1 shrink-0">
        <h3 className={`text-sm font-bold truncate leading-tight ${hasDefaultName ? 'text-[#C0C0C0] italic' : 'text-[#5D5D5D]'}`}>
          {student.name || '未命名'}
        </h3>
      </div>
    </div>
  )
}

// ============================================
// 村民護照 Modal
// ============================================

export default VillagerCard
