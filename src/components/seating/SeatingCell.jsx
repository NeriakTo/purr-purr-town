// v3.7.0: 座位表單格元件
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { X } from 'lucide-react'
import AvatarEmoji from '../common/AvatarEmoji'

function SeatingCell({ cellKey, student, objectType, isStudentPerspective, onRemoveObject, objectMap }) {
  // 可放置區域
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `cell-${cellKey}`,
    data: { type: 'cell', cellKey },
  })

  // 若有學生則可拖曳
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: student ? `student-${student.id}` : `empty-${cellKey}`,
    data: { type: 'seated-student', studentId: student?.id, fromCellKey: cellKey },
    disabled: !student,
  })

  const obj = objectType ? (objectMap?.[objectType] || null) : null

  // 地圖物件
  if (obj) {
    return (
      <div
        ref={setDropRef}
        data-cell-key={cellKey}
        className="relative rounded-xl border-2 border-dashed flex items-center justify-center group transition-colors"
        style={{ borderColor: obj.color, backgroundColor: `${obj.color}22` }}
      >
        <div className={isStudentPerspective ? 'rotate-180' : ''}>
          <span className="text-2xl">{obj.icon}</span>
          <div className="text-xs font-medium text-[#5D5D5D] mt-0.5 text-center">{obj.label}</div>
        </div>
        <button
          onClick={() => onRemoveObject(cellKey)}
          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#FFADAD] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow print:!hidden"
        >
          <X size={12} />
        </button>
      </div>
    )
  }

  // 學生座位
  if (student) {
    return (
      <div
        ref={(node) => { setDropRef(node); setDragRef(node) }}
        {...attributes}
        {...listeners}
        className={`relative rounded-xl border-2 flex flex-col items-center justify-center gap-0.5 cursor-grab active:cursor-grabbing transition-all
          ${isDragging ? 'opacity-30 scale-95' : ''}
          ${isOver ? 'border-[#7BC496] bg-[#A8D8B9]/20 scale-105' : 'border-[#E8E8E8] bg-white hover:border-[#A8D8B9] hover:shadow-md'}`}
      >
        <div className={isStudentPerspective ? 'rotate-180 flex flex-col items-center gap-0.5' : 'flex flex-col items-center gap-0.5'}>
          <AvatarEmoji seed={student.id} className="w-8 h-8 rounded-full shrink-0" emojiClassName="text-base" />
          <span className="text-[10px] font-bold text-[#5D5D5D] leading-tight text-center truncate max-w-full px-1">
            {student.number}號
          </span>
          <span className="text-[10px] text-[#8B8B8B] leading-tight text-center truncate max-w-full px-1">
            {student.name}
          </span>
        </div>
      </div>
    )
  }

  // 空格
  return (
    <div
      ref={setDropRef}
      data-cell-key={cellKey}
      className={`rounded-xl border-2 border-dashed flex items-center justify-center transition-all
        ${isOver ? 'border-[#7BC496] bg-[#A8D8B9]/20 scale-105' : 'border-[#E8E8E8]/60 bg-[#fdfbf7]/50 hover:border-[#A8D8B9]/50'}`}
    >
      <span className="text-[#D0D0D0] text-xs select-none">空位</span>
    </div>
  )
}

export default SeatingCell
