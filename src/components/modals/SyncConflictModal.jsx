import { Monitor, Smartphone, AlertTriangle } from 'lucide-react'
import ModalShell from '../common/ModalShell'

export default function SyncConflictModal({ localDate, remoteDate, localStudentCount, remoteStudentCount, localLogCount, remoteLogCount, onUseLocal, onUseRemote }) {
  return (
    // 阻斷式視窗：必須二選一，所以沒有關閉鈕、Esc 也不關（WAI-ARIA alertdialog）
    <ModalShell
      size="S"
      height="auto"
      role="alertdialog"
      layer="blocking"
      accentClass="from-[#FFADAD] to-[#FFD6A5]"
      icon={
        <div className="w-12 h-12 rounded-2xl bg-[#FFF3E0] flex items-center justify-center">
          <AlertTriangle size={24} className="text-[#FF9800]" />
        </div>
      }
      title="資料版本不同"
      subtitle="本機與伺服器的資料不一致"
      showClose={false}
      closeOnEsc={false}
    >
      <div className="px-6 pb-6 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-4 rounded-xl border border-[#E8E8E8] space-y-2">
              <div className="flex items-center gap-2 text-sm font-bold text-[#5D5D5D]">
                <Monitor size={14} />
                本機資料
              </div>
              <div className="text-xs text-[#8B8B8B] space-y-1">
                <p>{localStudentCount} 位學生</p>
                <p>{localLogCount} 筆日誌</p>
                <p className="text-[10px]">更新於 {formatTimestamp(localDate)}</p>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-[#E8E8E8] space-y-2">
              <div className="flex items-center gap-2 text-sm font-bold text-[#5D5D5D]">
                <Smartphone size={14} />
                伺服器資料
              </div>
              <div className="text-xs text-[#8B8B8B] space-y-1">
                <p>{remoteStudentCount} 位學生</p>
                <p>{remoteLogCount} 筆日誌</p>
                <p className="text-[10px]">更新於 {formatTimestamp(remoteDate)}</p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <button
              onClick={onUseRemote}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-[#A8D8B9] to-[#7BC496] text-white font-bold text-sm shadow-md hover:shadow-lg transition-all"
            >
              使用伺服器資料（較新）
            </button>
            <button
              onClick={onUseLocal}
              className="w-full py-3 rounded-xl border border-[#E8E8E8] text-[#5D5D5D] font-bold text-sm hover:bg-[#F5F5F5] transition-colors"
            >
              保留本機資料
            </button>
          </div>

          <p className="text-[10px] text-[#ABABAB] text-center">
            選擇後，未被選取的版本將被覆蓋。載入後尚未儲存的修改也會受影響。
          </p>
      </div>
    </ModalShell>
  )
}

function formatTimestamp(ts) {
  if (!ts) return '未知'
  try {
    const d = new Date(ts)
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  } catch {
    return '未知'
  }
}
