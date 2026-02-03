import { useState, useRef, useEffect } from 'react'
import { AVATAR_EMOJIS } from '../../utils/constants'

// v3.4.6: Expanded Emoji icon library
const AVATAR_CATEGORY = {
  label: '????',
  icons: AVATAR_EMOJIS.reduce((acc, emoji) => {
    acc[emoji] = '????'
    return acc
  }, {})
}

export const ICON_CATEGORIES = [
  AVATAR_CATEGORY,
  { label: '管理', icons: { '👑': '班長', '📢': '風紀', '🚩': '路隊', '📋': '點名', '💂': '值日', '⚖️': '公平', '🗣️': '司儀', '🕵️': '督察', '👮': '糾察', '🔔': '鐘聲' } },
  { label: '服務', icons: { '🧹': '衛生', '🚮': '回收', '🍱': '午餐', '🥣': '餐具', '🧼': '洗手', '🧽': '擦拭', '🪣': '拖地', '🤝': '服務', '🚚': '搬運', '🪴': '園藝' } },
  { label: '設施', icons: { '💡': '電燈', '🌬️': '電扇', '🚪': '門窗', '💻': '資訊', '🖱️': '滑鼠', '🔌': '插座', '🔋': '電池', '📺': '螢幕', '📶': '網路', '🌡️': '溫度' } },
  { label: '學藝', icons: { '📖': '學藝', '✍️': '寫作', '🎨': '美工', '🎵': '音樂', '📐': '數學', '🔬': '科學', '🎒': '書包', '💯': '滿分', '📝': '筆記', '✂️': '剪貼' } },
  { label: '生活', icons: { '🦷': '潔牙', '💊': '保健', '🛌': '午休', '👕': '服裝', '💧': '飲水', '👟': '球鞋', '☂️': '雨傘', '🧢': '帽子', '🍱': '便當', '🕰️': '時間' } },
  { label: '獎懲', icons: { '🏆': '獎盃', '🥇': '冠軍', '🌟': '優良', '🎁': '獎品', '🎉': '慶祝', '⚠️': '警告', '🐢': '遲到', '🚫': '禁止', '🤐': '安靜', '❌': '錯誤', '🛑': '停止', '💣': '嚴重' } },
]

// v3.4.5: Migration map from old Lucide icon names to Emoji
export const LUCIDE_TO_EMOJI = {
  Crown: '👑',
  Star: '⭐',
  Megaphone: '📢',
  Flag: '🚩',
  Gavel: '⚖️',
  Brush: '🧹',
  Trash2: '🚮',
  Utensils: '🍱',
  Soup: '🍲',
  Sparkles: '✨',
  Truck: '🚚',
  Lightbulb: '💡',
  Fan: '🌬️',
  DoorOpen: '🚪',
  Monitor: '💻',
  Wifi: '📡',
  BookOpen: '📖',
  PenTool: '✍️',
  Palette: '🎨',
  Music: '🎵',
  Calculator: '🔢',
  HeartHandshake: '🤝',
  Trophy: '🏆',
  CalendarCheck: '🗓️',
  Coins: '🪙',
  AlertTriangle: '⚠️',
  Clock: '🐢',
  FileWarning: '⚠️',
  Ban: '🚫',
}

// Resolve an icon value: if it's an old Lucide name, convert to emoji
export function resolveIcon(name) {
  if (!name) return null
  if (LUCIDE_TO_EMOJI[name]) return LUCIDE_TO_EMOJI[name]
  return name
}

export function RenderIcon({ name, size = 16, className = '' }) {
  const resolved = resolveIcon(name)
  if (!resolved) return null
  return <span className={className} style={{ fontSize: size, lineHeight: 1 }}>{resolved}</span>
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

  const displayValue = resolveIcon(value)

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-10 h-10 flex items-center justify-center rounded-lg border border-[#E8E8E8] hover:border-[#A8D8B9] bg-white transition-colors text-xl"
        title="選擇圖示"
      >
        {displayValue || '📋'}
      </button>
      {open && (
        <div className="absolute z-[120] top-full left-0 mt-1 w-64 bg-white rounded-xl shadow-xl border border-[#E8E8E8] p-3 space-y-2 max-h-80 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
          {ICON_CATEGORIES.map(cat => (
            <div key={cat.label}>
              <div className="text-[10px] font-bold text-[#8B8B8B] uppercase tracking-wider mb-1">{cat.label}</div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(cat.icons).map(([emoji, label]) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => { onChange(emoji); setOpen(false) }}
                    className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors text-lg ${
                      value === emoji ? 'bg-[#A8D8B9] ring-2 ring-[#7BC496]' : 'hover:bg-[#F0F0F0]'
                    }`}
                    title={label}
                  >
                    {emoji}
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
