import { useState } from 'react'
import { PawPrint, LogOut, Menu, ListTodo, ScrollText, Sparkles, Flag, Settings } from 'lucide-react'
import { formatDateDisplay } from '../../utils/helpers'

function Header({ todayStr, completionRate, className, classAlias, onLogout, onOpenSettings, onOpenTeamManagement, onOpenTaskOverview, onOpenGadgets, onOpenHistory }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const displayName = classAlias || className

  const iconBtnClass = 'p-3 rounded-2xl bg-[#fdfbf7] hover:bg-[#A8D8B9]/20 transition-colors'
  const menuItems = [
    { onClick: onOpenTaskOverview, icon: ListTodo, label: '任務總覽' },
    { onClick: onOpenHistory, icon: ScrollText, label: '村莊歷史' },
    { onClick: onOpenGadgets, icon: Sparkles, label: '課堂法寶' },
    { onClick: onOpenTeamManagement, icon: Flag, label: '小隊管理' },
    { onClick: onOpenSettings, icon: Settings, label: '村莊設定' },
  ]

  return (
    <header className="bg-white/80 backdrop-blur-md rounded-3xl p-3 md:p-4 mb-4 2xl:mb-2 shadow-lg border border-white/50 shrink-0">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#A8D8B9] to-[#7BC496] flex items-center justify-center shadow-md">
            <PawPrint size={28} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-[#5D5D5D] flex items-center gap-2">{displayName || '呼嚕嚕小鎮'}</h1>
            <p className="text-xs md:text-sm text-[#8B8B8B]">{formatDateDisplay(todayStr)}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-4">
          {/* 達成率 - 保留在 Navbar */}
          <div className="flex items-center gap-2 md:gap-3 bg-[#fdfbf7] px-3 md:px-4 py-1.5 md:py-2 rounded-2xl">
            <div className="hidden sm:block">
              <span className="text-xs text-[#8B8B8B]">達成率</span>
              <div className="text-base md:text-lg font-bold text-[#5D5D5D]">{Math.round(completionRate * 100)}%</div>
            </div>
            <div className="w-16 sm:w-24 md:w-32 h-2.5 md:h-3 bg-[#E8E8E8] rounded-full overflow-hidden shrink-0">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${completionRate * 100}%`, background: completionRate >= 0.8 ? '#7BC496' : '#FFBF69' }}
              />
            </div>
          </div>

          {/* md 以上：顯示全部按鈕 */}
          <div className="hidden md:flex items-center gap-2">
            {menuItems.map(({ onClick, icon: Icon, label }) => (
              <button key={label} onClick={onClick} className={iconBtnClass} title={label}>
                <Icon size={22} className="text-[#5D5D5D]" />
              </button>
            ))}
            <button onClick={onLogout} className="p-3 rounded-2xl bg-[#fdfbf7] hover:bg-[#FFADAD]/20 transition-colors" title="返回村莊列表">
              <LogOut size={22} className="text-[#5D5D5D]" />
            </button>
          </div>

          {/* md 以下：漢堡選單 + 返回列表 */}
          <div className="flex md:hidden items-center gap-1">
            <button onClick={onLogout} className={iconBtnClass} title="返回村莊列表">
              <LogOut size={20} className="text-[#5D5D5D]" />
            </button>
            <div className="relative">
              <button
                onClick={() => setMenuOpen(v => !v)}
                className={`${iconBtnClass} ${menuOpen ? 'bg-[#A8D8B9]/20' : ''}`}
                title="功能選單"
                aria-expanded={menuOpen}
              >
                <Menu size={22} className="text-[#5D5D5D]" />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden="true" />
                  <div className="absolute right-0 top-full mt-1 py-2 rounded-2xl bg-white shadow-xl border border-[#E8E8E8] z-50 min-w-[160px] animate-slide-up">
                    {menuItems.map(({ onClick, icon: Icon, label }) => (
                      <button
                        key={label}
                        onClick={() => { onClick(); setMenuOpen(false) }}
                        className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-[#fdfbf7] text-left text-[#5D5D5D] font-medium"
                      >
                        <Icon size={20} />
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}

// ============================================
// 村莊儀表板 (Dashboard View)
// ============================================

export default Header
