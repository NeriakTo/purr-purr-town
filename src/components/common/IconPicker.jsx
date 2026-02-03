import { useState, useRef, useEffect } from 'react'
import { EMOJI_LIBRARY } from '../../utils/constants'

// v3.5.1: Emoji-only implementation.
// Legacy Lucide support is removed. Previous icon values (strings) will just be rendered as text if not in emoji format.

export function RenderIcon({ name, size = 16, className = '' }) {
  if (!name) return null
  return <span className={className} style={{ fontSize: size, lineHeight: 1 }}>{name}</span>
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
        className="w-10 h-10 flex items-center justify-center rounded-lg border border-[#E8E8E8] hover:border-[#A8D8B9] bg-white transition-colors text-xl"
        title="選擇圖示"
      >
        {value || '📋'}
      </button>
      {open && (
        <div className="absolute z-[120] top-full left-0 mt-1 w-64 bg-white rounded-xl shadow-xl border border-[#E8E8E8] p-3 space-y-2 max-h-80 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
          {EMOJI_LIBRARY.map(cat => (
            <div key={cat.label}>
              <div className="text-[10px] font-bold text-[#8B8B8B] uppercase tracking-wider mb-1">{cat.label}</div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(cat.icons).map(([emoji, label]) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => { onChange(emoji); setOpen(false) }}
                    className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors text-lg ${value === emoji ? 'bg-[#A8D8B9] ring-2 ring-[#7BC496]' : 'hover:bg-[#F0F0F0]'
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
