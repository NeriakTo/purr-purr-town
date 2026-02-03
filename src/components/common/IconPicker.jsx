import { useState, useRef, useEffect } from 'react'
import {
  Crown, Star, Megaphone, Flag, Gavel,
  Brush, Trash2, Utensils, Soup, Sparkles, Truck,
  Lightbulb, Fan, DoorOpen, Monitor, Wifi,
  BookOpen, PenTool, Palette, Music, Calculator,
  HeartHandshake, Trophy, CalendarCheck, Coins,
  AlertTriangle, Clock, FileWarning, Ban
} from 'lucide-react'

export const ICON_CATEGORIES = [
  { label: '管理', icons: { Crown, Star, Megaphone, Flag, Gavel } },
  { label: '服務', icons: { Brush, Trash2, Utensils, Soup, Sparkles, Truck } },
  { label: '設施', icons: { Lightbulb, Fan, DoorOpen, Monitor, Wifi } },
  { label: '學藝', icons: { BookOpen, PenTool, Palette, Music, Calculator } },
  { label: '行為', icons: { HeartHandshake, Trophy, CalendarCheck, Coins } },
  { label: '負面', icons: { AlertTriangle, Clock, FileWarning, Ban } },
]

export const ICON_MAP = {}
ICON_CATEGORIES.forEach(cat => {
  Object.entries(cat.icons).forEach(([name, comp]) => {
    ICON_MAP[name] = comp
  })
})

export function RenderIcon({ name, size = 16, className = '' }) {
  if (!name) return null
  const IconComp = ICON_MAP[name]
  if (IconComp) return <IconComp size={size} className={className} />
  return <span className={className} style={{ fontSize: size * 0.875, lineHeight: 1 }}>{name}</span>
}

function IconPicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [customEmoji, setCustomEmoji] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-10 h-10 flex items-center justify-center rounded-lg border border-[#E8E8E8] hover:border-[#A8D8B9] bg-white transition-colors"
        title="選擇圖示"
      >
        <RenderIcon name={value} size={20} />
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 w-64 bg-white rounded-xl shadow-xl border border-[#E8E8E8] p-3 space-y-2 max-h-80 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
          {ICON_CATEGORIES.map(cat => (
            <div key={cat.label}>
              <div className="text-[10px] font-bold text-[#8B8B8B] uppercase tracking-wider mb-1">{cat.label}</div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(cat.icons).map(([name, Icon]) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => { onChange(name); setOpen(false) }}
                    className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                      value === name ? 'bg-[#A8D8B9] text-white' : 'hover:bg-[#F0F0F0] text-[#5D5D5D]'
                    }`}
                    title={name}
                  >
                    <Icon size={16} />
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="border-t border-[#E8E8E8] pt-2 mt-2">
            <div className="text-[10px] font-bold text-[#8B8B8B] mb-1">自訂 Emoji</div>
            <div className="flex gap-1">
              <input
                type="text"
                value={customEmoji}
                onChange={e => setCustomEmoji(e.target.value)}
                className="flex-1 px-2 py-1 rounded-lg border border-[#E8E8E8] text-center text-lg outline-none focus:border-[#A8D8B9]"
                maxLength={2}
                placeholder="😀"
              />
              <button
                type="button"
                onClick={() => { if (customEmoji) { onChange(customEmoji); setCustomEmoji(''); setOpen(false) } }}
                className="px-3 py-1 rounded-lg bg-[#A8D8B9] text-white text-xs font-bold"
              >
                確定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default IconPicker
