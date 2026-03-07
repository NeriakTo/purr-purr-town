import { useMemo } from 'react'
import { Trophy, Download, X } from 'lucide-react'
import { resolveCurrency, formatCurrency, ensureStudentBank } from '../../utils/helpers'
import { exportWealthLeaderboardToExcel } from '../../utils/exportUtils'
import AvatarEmoji from '../common/AvatarEmoji'

const RANK_BADGES = [
  null, // index 0 unused
  { icon: '\uD83E\uDD47', label: '1st', gradient: 'from-yellow-100 to-amber-50', border: 'border-amber-300', text: 'text-amber-700', glow: 'shadow-amber-200/50' },
  { icon: '\uD83E\uDD48', label: '2nd', gradient: 'from-orange-50 to-amber-50', border: 'border-orange-300', text: 'text-orange-700', glow: 'shadow-orange-200/50' },
  { icon: '\uD83E\uDD49', label: '3rd', gradient: 'from-gray-100 to-slate-50', border: 'border-gray-300', text: 'text-gray-600', glow: 'shadow-gray-200/50' },
  { icon: '\uD83D\uDCAB', label: '4th', gradient: 'from-violet-50 to-purple-50', border: 'border-violet-200', text: 'text-violet-600', glow: '' },
  { icon: '\u2B50', label: '5th', gradient: 'from-sky-50 to-blue-50', border: 'border-sky-200', text: 'text-sky-600', glow: '' },
]

function getRankBadge(rank) {
  if (rank >= 1 && rank <= 5) return RANK_BADGES[rank]
  return null
}

function WealthLeaderboardModal({ students, settings, className, onClose }) {
  const currency = useMemo(() => resolveCurrency(settings), [settings])

  const leaderboard = useMemo(() => {
    const entries = students.map(s => {
      const student = ensureStudentBank(s)
      return {
        id: student.id,
        number: student.number,
        name: student.name,
        avatarSeed: student.uuid || student.id,
        totalEarned: student.bank.totalEarned || 0,
        balance: student.bank.balance || 0,
      }
    })

    // 依 totalEarned 降冪 → 同分依座號升冪
    entries.sort((a, b) => b.totalEarned - a.totalEarned || (a.number || 0) - (b.number || 0))

    // 計算名次（同分同名次）
    let currentRank = 1
    return entries.map((entry, idx) => {
      if (idx > 0 && entry.totalEarned < entries[idx - 1].totalEarned) {
        currentRank = idx + 1
      }
      return { ...entry, rank: currentRank }
    })
  }, [students])

  const totalVillageWealth = useMemo(
    () => leaderboard.reduce((sum, e) => sum + e.totalEarned, 0),
    [leaderboard]
  )

  const handleExport = () => {
    exportWealthLeaderboardToExcel(leaderboard, className, currency)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xl max-h-[85vh] bg-white rounded-3xl shadow-2xl border border-white/50 flex flex-col overflow-hidden animate-slide-up">

        {/* Header */}
        <div className="shrink-0 bg-gradient-to-r from-[#7BC496] to-[#A8D8B9] px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center">
                <Trophy size={22} className="text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">呼嚕嚕財富榜</h2>
                <p className="text-xs text-white/80">
                  {students.length} 位村民 · 村莊總財富 {formatCurrency(totalVillageWealth, currency).display}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl bg-white/20 hover:bg-white/30 transition-colors">
              <X size={18} className="text-white" />
            </button>
          </div>
        </div>

        {/* Leaderboard List */}
        <div className="flex-1 overflow-y-auto px-4 py-3" style={{ scrollbarWidth: 'thin' }}>
          {leaderboard.length === 0 ? (
            <div className="text-center py-12 text-[#8B8B8B]">目前沒有村民資料</div>
          ) : (
            <div className="space-y-2">
              {leaderboard.map((entry) => {
                const badge = getRankBadge(entry.rank)
                const currencyDisplay = formatCurrency(entry.totalEarned, currency)
                const isTopThree = entry.rank <= 3
                const isTopFive = entry.rank <= 5

                return (
                  <div
                    key={entry.id}
                    className={`
                      flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all
                      ${badge
                        ? `bg-gradient-to-r ${badge.gradient} ${badge.border} ${badge.glow ? `shadow-md ${badge.glow}` : ''}`
                        : 'bg-[#fdfbf7] border-[#F0F0F0] hover:border-[#E0E0E0]'
                      }
                    `}
                  >
                    {/* Rank */}
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isTopFive ? 'text-xl' : 'bg-[#F5F5F5] text-sm font-bold text-[#8B8B8B]'}`}>
                      {badge ? badge.icon : entry.rank}
                    </div>

                    {/* Avatar + Info */}
                    <div className="flex items-center gap-2.5 flex-1 min-w-0">
                      <AvatarEmoji seed={entry.avatarSeed} className="w-9 h-9 rounded-xl text-lg shrink-0" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-xs ${isTopThree ? badge.text : 'text-[#8B8B8B]'}`}>
                            {entry.number}號
                          </span>
                          <span className={`font-bold truncate ${isTopThree ? 'text-[#4A4A4A]' : 'text-[#5D5D5D]'} ${isTopThree ? 'text-base' : 'text-sm'}`}>
                            {entry.name}
                          </span>
                        </div>
                        <p className="text-xs text-[#AAAAAA] truncate">
                          餘額 {formatCurrency(entry.balance, currency).display}
                        </p>
                      </div>
                    </div>

                    {/* Total Earned */}
                    <div className="text-right shrink-0">
                      <div className={`font-bold ${isTopThree ? 'text-lg' : 'text-base'} ${isTopThree ? badge.text : 'text-[#5D5D5D]'}`}>
                        {entry.totalEarned.toLocaleString()}
                      </div>
                      <div className="text-xs text-[#AAAAAA]">
                        {currency.base.icon} {currency.base.name}
                      </div>
                      {(currencyDisplay.tier2 > 0 || currencyDisplay.tier1 > 0) && (
                        <div className="text-xs text-[#BBBBBB] mt-0.5">
                          {currencyDisplay.tier2 > 0 && `${currencyDisplay.tier2}${currency.tier2.icon}`}
                          {currencyDisplay.tier2 > 0 && currencyDisplay.tier1 > 0 && ' '}
                          {currencyDisplay.tier1 > 0 && `${currencyDisplay.tier1}${currency.tier1.icon}`}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer: Export */}
        <div className="shrink-0 px-4 py-3 border-t border-[#F0F0F0] bg-[#fdfbf7]/80">
          <button
            onClick={handleExport}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-[#7BC496] to-[#A8D8B9] text-white font-bold text-sm hover:opacity-90 transition-opacity shadow-md"
          >
            <Download size={16} />
            匯出 Excel
          </button>
        </div>
      </div>
    </div>
  )
}

export default WealthLeaderboardModal
