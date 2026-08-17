import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, Save, Pin } from 'lucide-react'
import ModalShell from '../common/ModalShell'

const NOTE_COLORS = ['#FFF4B8', '#FFE0E0', '#DFF5E1', '#E0ECFF', '#F5E1FF', '#FFECC7']

function getRandomColor() {
  return NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)]
}

function getRandomRotate() {
  return Math.floor(Math.random() * 7) - 3
}

function AnnouncementModal({ announcements = [], onClose, onSave }) {
  const [items, setItems] = useState(announcements)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    setItems(announcements || [])
  }, [announcements])

  const canAdd = useMemo(() => draft.trim().length > 0, [draft])

  const handleAdd = () => {
    if (!draft.trim()) return
    const newItem = {
      id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      text: draft.trim(),
      color: getRandomColor(),
      rotate: getRandomRotate()
    }
    setItems(prev => [...prev, newItem])
    setDraft('')
  }

  const handleUpdate = (id, value) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, text: value } : item))
  }

  const handleDelete = (id) => {
    setItems(prev => prev.filter(item => item.id !== id))
  }

  const handleSave = () => {
    if (onSave) onSave(items)
    onClose()
  }

  return (
    <ModalShell
      size="M"
      scroll="caller"
      accentClass="from-[#A8D8B9] to-[#FFD6A5]"
      icon={
        <div className="w-12 h-12 rounded-2xl bg-[#FFD6A5] flex items-center justify-center text-white shadow-md">
          <Pin size={22} />
        </div>
      }
      title="公佈欄管理"
      subtitle="新增、編輯或刪除公告"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="px-5 py-2.5 rounded-xl bg-[#E8E8E8] text-[#5D5D5D] font-medium">
            取消
          </button>
          <button onClick={handleSave} className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#A8D8B9] to-[#7BC496] text-white font-medium flex items-center gap-2">
            <Save size={16} />
            儲存
          </button>
        </>
      }
    >
        <div className="h-full flex flex-col px-6 pb-6">
          <div className="mb-4 space-y-3 shrink-0">
            <label className="text-sm font-medium text-[#5D5D5D]">新增公告</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="輸入公告內容..."
                className="flex-1 px-4 py-2.5 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none"
              />
              <button
                onClick={handleAdd}
                disabled={!canAdd}
                className="px-4 py-2.5 rounded-xl bg-[#A8D8B9] text-white font-medium disabled:opacity-50"
              >
                <Plus size={18} />
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 space-y-3 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
            {items.length === 0 ? (
              <div className="text-center py-10 text-sm text-[#8B8B8B]">目前沒有公告</div>
            ) : (
              items.map(item => (
                <div key={item.id} className="bg-white rounded-2xl p-4 shadow-sm border border-[#F0F0F0]">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl shrink-0" style={{ backgroundColor: item.color }} />
                    <textarea
                      value={item.text}
                      onChange={(e) => handleUpdate(item.id, e.target.value)}
                      rows={2}
                      className="flex-1 resize-none px-3 py-2 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-sm"
                    />
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="p-2 rounded-xl hover:bg-[#FFADAD]/20"
                      title="刪除公告"
                    >
                      <Trash2 size={16} className="text-[#D64545]" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
    </ModalShell>
  )
}

export default AnnouncementModal
