import { useMemo } from 'react'
import { Flag, Trophy, Users } from 'lucide-react'
import VillagerCard from './VillagerCard'
import { isDoneStatus, isCountedInDenominator } from '../../utils/helpers'

function SquadGrid({ students, tasks, studentStatus, settings, onSelectStudent, checkOverdue }) {
  const groupedStudents = useMemo(() => {
    const groups = {}
    students.forEach(s => {
      if (s.group === 'unassigned') return
      const g = s.group || 'A'
      if (!groups[g]) groups[g] = []
      groups[g].push(s)
    })
    return Object.keys(groups).sort().reduce((acc, k) => {
      acc[k] = groups[k]
      return acc
    }, {})
  }, [students])

  const unassignedStudents = useMemo(() => {
    return students
      .filter(s => s.group === 'unassigned')
      .sort((a, b) => (a.number || 0) - (b.number || 0))
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
    <div className="overflow-y-auto flex-1 min-h-0 p-1" style={{ scrollbarWidth: 'thin' }}>
      <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4 2xl:gap-3">
        {Object.entries(groupedStudents).map(([group, groupStudents], gi) => {
          const rate = getGroupCompletionRate(groupStudents)
          const isComplete = rate === 1 && tasks.length > 0
          const groupName = settings.groupAliases?.[group] || `${group} 小隊`
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
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-yellow-400/20 text-yellow-700 text-[12px] font-bold">
                      <Trophy size={12} />全員達成！
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

              <div className={`px-3 pb-3 pt-3 ${isComplete ? 'bg-gradient-to-b from-amber-50/50 to-white' : 'bg-white/40'}`}>
                <div className="grid grid-cols-3 gap-3 2xl:gap-2">
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

      {unassignedStudents.length > 0 && (
        <div className="mt-4 rounded-xl overflow-hidden border-2 border-dashed border-[#D8D8D8] shrink-0">
          <div className="px-2.5 py-1.5 flex items-center justify-between bg-[#F9F9F9]">
            <div className="flex items-center gap-1.5">
              <div className="w-6 h-6 rounded-md flex items-center justify-center bg-[#E8E8E8]">
                <Users size={12} className="text-[#8B8B8B]" />
              </div>
              <h3 className="font-black text-lg text-[#8B8B8B]">待分配</h3>
              <span className="text-xs text-[#B8B8B8] ml-1">{unassignedStudents.length} 人</span>
            </div>
          </div>
          <div className="px-3 pb-3 pt-3 bg-white/20">
            <div className="grid grid-cols-3 gap-3 2xl:gap-2">
              {unassignedStudents.map((student) => (
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
      )}
    </div>
  )
}

export default SquadGrid
