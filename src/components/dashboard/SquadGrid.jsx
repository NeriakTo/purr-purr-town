import { useMemo } from 'react'
import { Flag, Trophy } from 'lucide-react'
import VillagerCard from './VillagerCard'
import { isDoneStatus, isCountedInDenominator } from '../../utils/helpers'

function SquadGrid({ students, tasks, studentStatus, settings, onSelectStudent, checkOverdue }) {
  const groupedStudents = useMemo(() => {
    const groups = {}
    students.forEach(s => {
      const g = s.group || 'A'
      if (!groups[g]) groups[g] = []
      groups[g].push(s)
    })
    return Object.keys(groups).sort().reduce((acc, k) => {
      acc[k] = groups[k]
      return acc
    }, {})
  }, [students])

  const getGroupCompletionRate = (groupStudents) => {
    if (tasks.length === 0 || groupStudents.length === 0) return 0
    let num = 0
    let denom = 0
    groupStudents.forEach(s => tasks.forEach(t => {
      const st = studentStatus[s.id]?.[t.id]
      if (!isCountedInDenominator(st)) return
      denom++
      if (isDoneStatus(st)) num++
    }))
    return denom > 0 ? num / denom : 0
  }

  const groupColors = ['#A8D8B9', '#FFD6A5', '#FFADAD', '#A0C4FF', '#BDB2FF', '#FDE2F3']

  return (
    <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4 2xl:gap-3 overflow-y-auto flex-1 min-h-0" style={{ scrollbarWidth: 'thin' }}>
      {Object.entries(groupedStudents).map(([group, groupStudents], gi) => {
        const rate = getGroupCompletionRate(groupStudents)
        const isComplete = rate === 1 && tasks.length > 0
        const groupName = settings.groupAliases?.[group] || `${group} ??`
        const accent = groupColors[gi % groupColors.length]

        return (
          <div
            key={group}
            className={`rounded-xl overflow-hidden transition-all shrink-0 ${
              isComplete ? 'border-2 border-yellow-300 shadow-lg' : 'border border-transparent shadow-sm'
            }`}
          >
            <div className={`px-2.5 py-1.5 flex items-center justify-between ${
              isComplete ? 'bg-gradient-to-r from-yellow-100 to-amber-100' : 'bg-[#f4ede3]'
            }`}>
              <div className="flex items-center gap-1.5">
                <div
                  className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                  style={{ background: isComplete ? '#FBBF24' : `${accent}30` }}
                >
                  <Flag size={12} className={isComplete ? 'text-white' : ''} style={isComplete ? {} : { color: accent }} />
                </div>
                <h3 className="font-black text-lg text-[#4A4A4A]">{groupName}</h3>
                {isComplete && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-yellow-400/20 text-yellow-700 text-[10px] font-bold">
                    <Trophy size={10} />????
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="w-20 h-2 bg-black/5 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${rate * 100}%`,
                      background: isComplete
                        ? 'linear-gradient(90deg, #FBBF24, #F59E0B)'
                        : `linear-gradient(90deg, ${accent}, ${accent})`
                    }}
                  />
                </div>
                <span className="text-xs font-semibold text-[#6B6B6B] w-8 text-right">{Math.round(rate * 100)}%</span>
              </div>
            </div>

            <div className={`px-2 pb-2 pt-1 ${isComplete ? 'bg-gradient-to-b from-amber-50/50 to-white' : 'bg-white/40'}`}>
              <div className="grid grid-cols-3 gap-2 2xl:gap-1.5">
                {groupStudents.map((student) => (
                  <VillagerCard
                    key={student.id}
                    student={student}
                    tasks={tasks}
                    studentStatus={studentStatus}
                    onClick={() => onSelectStudent(student)}
                    hasOverdue={checkOverdue(student.id)}
                  />
                ))}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default SquadGrid
