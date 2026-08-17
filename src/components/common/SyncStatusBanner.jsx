import { useEffect, useState } from 'react'
import { AlertTriangle, WifiOff } from 'lucide-react'
import { subscribeSyncStatus } from '../../utils/syncStatus'

// 全域同步狀態橫幅：釘在畫面最上方。
// 只有需要老師注意的兩種狀態才顯示——已過期（紅，阻斷式提醒重新登入）、
// 暫時離線（黃，資料待上傳）。connected / disconnected 不顯示，避免干擾。
export default function SyncStatusBanner() {
  const [state, setState] = useState({ status: 'disconnected', conflicts: [] })

  useEffect(() => subscribeSyncStatus(setState), [])

  const hasConflict = state.conflicts.length > 0

  if (state.status === 'expired') {
    return (
      <div
        role="alert"
        className="fixed top-0 inset-x-0 z-[100] bg-[#D64545] text-white px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-2 shadow-md"
      >
        <AlertTriangle size={16} className="shrink-0" />
        <span>雲端登入已過期，資料目前只存在這台裝置。請到「設定 → 雲端同步」重新登入並上傳。</span>
      </div>
    )
  }

  if (state.status === 'offline') {
    return (
      <div
        role="status"
        className="fixed top-0 inset-x-0 z-[100] bg-[#F0A020] text-white px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-2 shadow-md"
      >
        <WifiOff size={16} className="shrink-0" />
        <span>暫時連不上雲端，資料已安全存在本機，待恢復後自動上傳。</span>
      </div>
    )
  }

  if (hasConflict) {
    return (
      <div
        role="alert"
        className="fixed top-0 inset-x-0 z-[100] bg-[#E08A00] text-white px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-2 shadow-md"
      >
        <AlertTriangle size={16} className="shrink-0" />
        <span>其他裝置已更新這個班級的資料。請重新整理頁面，選擇要保留本機或伺服器的版本。</span>
      </div>
    )
  }

  return null
}
