// v3.7.0: 座位表 CSS Grid
import SeatingCell from './SeatingCell'
import { cellKey } from '../../utils/seatingUtils'

function SeatingGrid({ rows, cols, grid, objects, students, perspective, onRemoveObject, customObjectMap }) {
  const studentMap = Object.fromEntries(students.map(s => [s.id, s]))
  const isStudentPerspective = perspective === 'student'

  return (
    <div className="flex flex-col items-center gap-3">
      {/* 講台視覺區域 */}
      <div className={`flex flex-col items-center gap-1 w-full ${isStudentPerspective ? 'order-last' : ''}`}>
        <div className="w-[60%] h-3 rounded-full bg-gradient-to-r from-[#4A6741] via-[#5D7E4F] to-[#4A6741] shadow-sm" />
        <span className="text-[10px] text-[#8B8B8B] font-medium tracking-widest">講 台</span>
      </div>

      <div
        className={`seating-grid-container grid gap-1.5 transition-transform duration-500 ${isStudentPerspective ? 'rotate-180' : ''}`}
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(72px, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(72px, 1fr))`,
        }}
      >
        {Array.from({ length: rows }, (_, r) =>
          Array.from({ length: cols }, (_, c) => {
            const key = cellKey(r, c)
            const studentId = grid[key]
            const student = studentId ? studentMap[studentId] : null
            const objectType = objects[key] || null
            return (
              <SeatingCell
                key={key}
                cellKey={key}
                student={student}
                objectType={objectType}
                isStudentPerspective={isStudentPerspective}
                onRemoveObject={onRemoveObject}
                objectMap={customObjectMap}
              />
            )
          })
        )}
      </div>
    </div>
  )
}

export default SeatingGrid
