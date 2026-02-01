import { Settings, Pin } from 'lucide-react'

function BulletinBoard({ announcements = [], onOpenAnnouncements }) {
  return (
    <div className="rounded-2xl p-4 shadow-md border border-[#C8A070] cork-texture">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-[#5D5D5D] flex items-center gap-2">
          <Pin size={16} className="text-[#D97706]" />???
        </h3>
        <button
          onClick={onOpenAnnouncements}
          className="p-2 rounded-xl bg-white/70 hover:bg-white transition-colors"
          title="????"
        >
          <Settings size={16} className="text-[#5D5D5D]" />
        </button>
      </div>

      {announcements.length === 0 ? (
        <div className="text-xs text-[#5D5D5D]/70 bg-white/60 rounded-xl p-3 text-center">
          ????????????????
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {announcements.map((item) => (
            <div
              key={item.id}
              className="relative polaroid-card rounded-xl text-[#5D5D5D]"
              style={{ backgroundColor: item.color, '--rotation': `${item.rotate}deg` }}
            >
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <Pin size={14} className="text-[#D97706]" />
              </div>
              <div className="text-sm whitespace-pre-wrap leading-relaxed">
                {item.text}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default BulletinBoard
