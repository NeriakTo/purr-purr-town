import { useEffect, useMemo, useState } from 'react'
import { X, Plus, Trash2, Save, Pin } from 'lucide-react'

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative bg-[#fdfbf7] rounded-3xl shadow-2xl max-w-2xl w-full overflow-hidden">
        <div className="h-3 bg-gradient-to-r from-[#A8D8B9] to-[#FFD6A5]" />
        <button onClick={onClose} className="absolute top-5 right-5 p-2 rounded-full bg-white/80 hover:bg-white shadow-md">
          <X size={20} className="text-[#5D5D5D]" />
        </button>

        <div className="p-6 md:p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-[#FFD6A5] flex items-center justify-center text-white shadow-md">
              <Pin size={22} />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-[#5D5D5D]">?????</h2>
              <p className="text-sm text-[#8B8B8B]">??????????</p>
            </div>
          </div>

          <div className="mb-4 space-y-3">
            <label className="text-sm font-medium text-[#5D5D5D]">????</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="??????..."
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

          <div className="space-y-3 max-h-[45vh] overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
            {items.length === 0 ? (
              <div className="text-center py-10 text-sm text-[#8B8B8B]">??????</div>
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
                      title="????"
                    >
                      <Trash2 size={16} className="text-[#D64545]" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <button onClick={onClose} className="px-5 py-2.5 rounded-xl bg-[#E8E8E8] text-[#5D5D5D] font-medium">
              ??
            </button>
            <button onClick={handleSave} className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#A8D8B9] to-[#7BC496] text-white font-medium flex items-center gap-2">
              <Save size={16} />
              ??
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AnnouncementModal
