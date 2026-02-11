// v3.7.0: 座位表左側欄 — 學生/物件雙分頁
import { useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { Search, Plus, Trash2 } from 'lucide-react'
import AvatarEmoji from '../common/AvatarEmoji'
import IconPicker from '../common/IconPicker'
import { SEATING_OBJECTS, OBJECT_COLORS } from '../../utils/constants'

function DraggableStudent({ student }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `waitlist-${student.id}`,
    data: { type: 'waitlist-student', studentId: student.id },
  })

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-[#E8E8E8] cursor-grab active:cursor-grabbing hover:border-[#A8D8B9] hover:shadow-sm transition-all
        ${isDragging ? 'opacity-30 scale-95' : ''}`}
    >
      <AvatarEmoji seed={student.id} className="w-7 h-7 rounded-full shrink-0" emojiClassName="text-sm" />
      <div className="min-w-0">
        <span className="text-xs font-bold text-[#5D5D5D]">{student.number}號</span>
        <span className="text-xs text-[#8B8B8B] ml-1 truncate">{student.name}</span>
      </div>
    </div>
  )
}

function DraggableObject({ obj }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `object-${obj.id}`,
    data: { type: 'object', objectType: obj.id, icon: obj.icon, label: obj.label },
  })

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white border-2 border-dashed cursor-grab active:cursor-grabbing hover:shadow-sm transition-all
        ${isDragging ? 'opacity-30 scale-95' : ''}`}
      style={{ borderColor: obj.color }}
    >
      <span className="text-xl shrink-0">{obj.icon}</span>
      <span className="text-xs font-bold text-[#5D5D5D] truncate">{obj.label}</span>
    </div>
  )
}

function SeatingWaitingList({ students, customObjects, onAddCustomObject, onRemoveCustomObject, className = '' }) {
  const [activePanel, setActivePanel] = useState('students')
  const [filter, setFilter] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [newObjIcon, setNewObjIcon] = useState('📦')
  const [newObjLabel, setNewObjLabel] = useState('')

  const filtered = students.filter(s =>
    filter === '' ||
    String(s.number).includes(filter) ||
    s.name.includes(filter)
  )

  const handleAddObject = () => {
    const label = newObjLabel.trim()
    if (!label) return
    const colorIndex = (customObjects || []).length % OBJECT_COLORS.length
    onAddCustomObject({
      id: `obj_${Date.now()}`,
      label,
      icon: newObjIcon,
      color: OBJECT_COLORS[colorIndex],
    })
    setNewObjLabel('')
    setNewObjIcon('📦')
    setShowAddForm(false)
  }

  return (
    <div className={`flex flex-col bg-white/80 backdrop-blur-sm border-r border-[#E8E8E8] ${className}`}>
      {/* 分頁切換 */}
      <div className="flex border-b border-[#E8E8E8] shrink-0">
        <button
          onClick={() => setActivePanel('students')}
          className={`flex-1 py-2.5 text-xs font-bold transition-colors ${activePanel === 'students'
            ? 'text-[#5D5D5D] border-b-2 border-[#7BC496] bg-white'
            : 'text-[#8B8B8B] hover:text-[#5D5D5D] hover:bg-[#F9F9F9]'}`}
        >
          👤 學生
          <span className="ml-1 px-1.5 py-0.5 bg-[#FFD6A5] rounded-full text-[10px] font-bold text-[#5D5D5D]">
            {students.length}
          </span>
        </button>
        <button
          onClick={() => setActivePanel('objects')}
          className={`flex-1 py-2.5 text-xs font-bold transition-colors ${activePanel === 'objects'
            ? 'text-[#5D5D5D] border-b-2 border-[#7BC496] bg-white'
            : 'text-[#8B8B8B] hover:text-[#5D5D5D] hover:bg-[#F9F9F9]'}`}
        >
          🧩 物件
        </button>
      </div>

      {/* ===== 學生面板 ===== */}
      {activePanel === 'students' && (
        <>
          <div className="px-3 py-2 border-b border-[#E8E8E8]/50">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#ABABAB]" />
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="搜尋..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-[#E8E8E8] focus:border-[#A8D8B9] focus:outline-none transition-colors bg-[#fdfbf7]"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
            {filtered.length === 0 ? (
              <div className="text-center text-xs text-[#ABABAB] py-8">
                {students.length === 0 ? '全部已入座 🎉' : '無符合結果'}
              </div>
            ) : (
              filtered.map(s => <DraggableStudent key={s.id} student={s} />)
            )}
          </div>
        </>
      )}

      {/* ===== 物件面板 ===== */}
      {activePanel === 'objects' && (
        <>
          {/* 可滾動物件列表 */}
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
            <div className="text-[10px] text-[#8B8B8B] font-medium mb-1">拖曳物件至空格</div>

            {/* 預設物件 */}
            {SEATING_OBJECTS.map(obj => (
              <DraggableObject key={obj.id} obj={obj} />
            ))}

            {/* 自訂物件 */}
            {(customObjects || []).length > 0 && (
              <>
                <div className="text-[10px] text-[#8B8B8B] font-medium mt-3 mb-1 flex items-center gap-1">
                  <span className="flex-1 border-t border-[#E8E8E8]" />
                  <span>自訂</span>
                  <span className="flex-1 border-t border-[#E8E8E8]" />
                </div>
                {customObjects.map(obj => (
                  <div key={obj.id} className="flex items-center gap-1">
                    <div className="flex-1 min-w-0">
                      <DraggableObject obj={obj} />
                    </div>
                    <button
                      onClick={() => onRemoveCustomObject(obj.id)}
                      className="p-1 rounded-lg text-[#ABABAB] hover:text-[#D64545] hover:bg-[#FFADAD]/10 transition-colors shrink-0"
                      title="移除物件"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* 新增物件 — 固定在底部 (不受滾動裁切) */}
          <div className="shrink-0 px-3 py-2 border-t border-[#E8E8E8]/50">
            {showAddForm ? (
              <div className="p-2.5 rounded-xl border border-[#E8E8E8] bg-[#fdfbf7] space-y-2">
                <div className="flex items-center gap-2">
                  <IconPicker value={newObjIcon} onChange={setNewObjIcon} dropUp />
                  <input
                    type="text"
                    value={newObjLabel}
                    onChange={(e) => setNewObjLabel(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddObject() }}
                    placeholder="物件名稱"
                    className="flex-1 min-w-0 px-2 py-1.5 text-xs rounded-lg border border-[#E8E8E8] focus:border-[#A8D8B9] focus:outline-none"
                    autoFocus
                  />
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={handleAddObject}
                    className="flex-1 py-1.5 rounded-lg bg-[#A8D8B9] text-white text-xs font-bold hover:bg-[#7BC496] transition-colors"
                  >
                    新增
                  </button>
                  <button
                    onClick={() => { setShowAddForm(false); setNewObjLabel(''); setNewObjIcon('📦') }}
                    className="px-3 py-1.5 rounded-lg bg-[#E8E8E8] text-[#5D5D5D] text-xs hover:bg-[#D8D8D8] transition-colors"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowAddForm(true)}
                className="w-full py-2 rounded-xl border-2 border-dashed border-[#E8E8E8] text-xs text-[#8B8B8B] font-medium hover:border-[#A8D8B9] hover:text-[#5D5D5D] transition-colors flex items-center justify-center gap-1"
              >
                <Plus size={14} />
                新增物件
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default SeatingWaitingList
