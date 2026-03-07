// v3.7.2: 跨裝置還原 Modal（雲端 + 檔案匯入）
import { useEffect, useRef, useState } from 'react'
import { X, Cloud, FileUp, Download, Loader2, AlertTriangle, CheckCircle, Key, Link, Hash } from 'lucide-react'

function RestoreClassModal({ onClose, onRestoreClass, existingClassIds }) {
  const [activeTab, setActiveTab] = useState('cloud')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  // 雲端還原
  const [backupUrl, setBackupUrl] = useState(() => localStorage.getItem('ppt_backup_url') || '')
  const [backupToken, setBackupToken] = useState(() => localStorage.getItem('ppt_backup_token') || '')
  const [classIdInput, setClassIdInput] = useState('')

  // 檔案匯入
  const [fileSummary, setFileSummary] = useState(null)
  const [filePayload, setFilePayload] = useState(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const handleCloudRestore = async () => {
    if (!backupUrl.trim()) { setMsg('請輸入 GAS 部署網址'); return }
    if (!classIdInput.trim()) { setMsg('請輸入班級代號'); return }

    try {
      setBusy(true)
      setMsg(null)
      const token = backupToken.trim()
      const cid = classIdInput.trim()
      const url = `${backupUrl.trim()}?action=backup_download&classId=${cid}&token=${encodeURIComponent(token)}`
      const response = await fetch(url)
      if (!response.ok) throw new Error('Download failed')
      const result = await response.json()
      if (!result?.success) throw new Error(result?.message || 'Server returned error')
      if (!result?.data) throw new Error('Invalid data')

      const restored = result.data
      const classId = restored.classId || cid

      // 檢查是否已存在
      if (existingClassIds.includes(classId)) {
        if (!window.confirm(`班級「${classId}」已存在於本機，確定要覆蓋嗎？`)) {
          setBusy(false)
          return
        }
      }

      localStorage.setItem('ppt_backup_url', backupUrl.trim())
      localStorage.setItem('ppt_backup_token', backupToken.trim())

      onRestoreClass({
        classId,
        className: result.className || restored.className || '',
        data: restored
      })
    } catch (err) {
      console.error('雲端還原失敗:', err)
      setMsg('❌ 還原失敗，請檢查網址與班級代號')
      setBusy(false)
    }
  }

  const handleFileSelect = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      setMsg('❌ 檔案過大（上限 10 MB）')
      event.target.value = ''
      return
    }
    setMsg(null)

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const raw = typeof reader.result === 'string' ? reader.result : ''
        const payload = JSON.parse(raw)
        const data = payload?.data || payload

        if (!data?.students || !data?.logs) {
          throw new Error('Invalid backup file')
        }

        const classId = data.classId || payload.classId || ''
        const className = payload.className || data.className || ''
        const studentCount = (data.students || []).length
        const updatedAt = data.updatedAt || ''

        setFileSummary({ classId, className, studentCount, updatedAt })
        setFilePayload({ classId, className, data })
      } catch (err) {
        console.error('解析檔案失敗:', err)
        setMsg('❌ 檔案格式錯誤，請選擇有效的備份檔案')
        setFileSummary(null)
        setFilePayload(null)
      }
    }
    reader.onerror = () => {
      setMsg('❌ 讀取檔案失敗')
    }
    reader.readAsText(file)
    event.target.value = ''
  }

  const handleFileRestore = () => {
    if (!filePayload) return

    const classId = filePayload.classId
    if (!classId) {
      setMsg('❌ 備份檔案缺少班級代號，無法還原')
      return
    }

    if (existingClassIds.includes(classId)) {
      if (!window.confirm(`班級「${classId}」已存在於本機，確定要覆蓋嗎？`)) return
    }

    onRestoreClass(filePayload)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative bg-[#fdfbf7] rounded-3xl shadow-2xl max-w-md w-full overflow-hidden">
        <div className="h-3" style={{ background: 'repeating-linear-gradient(90deg, #A0C4FF, #A0C4FF 20px, #FFD6A5 20px, #FFD6A5 40px)' }} />
        <button onClick={onClose} disabled={busy} className="absolute top-6 right-4 p-2 rounded-full bg-white/80 hover:bg-white shadow-md transition-all z-10">
          <X size={20} className="text-[#5D5D5D]" />
        </button>

        <div className="p-6">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4" style={{ background: 'linear-gradient(135deg, #A0C4FF 0%, #7EB0FF 100%)' }}>
              <Download size={32} className="text-white" />
            </div>
            <h2 className="text-2xl font-bold text-[#5D5D5D]">還原村莊</h2>
            <p className="text-sm text-[#8B8B8B] mt-1">從其他裝置的備份還原班級資料</p>
          </div>

          {/* 分頁 */}
          <div className="flex gap-2 mb-5">
            <button
              onClick={() => { setActiveTab('cloud'); setMsg(null) }}
              className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
                activeTab === 'cloud' ? 'bg-[#A0C4FF] text-white shadow-md' : 'bg-[#E8E8E8] text-[#5D5D5D]'
              }`}
            >
              <Cloud size={16} /> 雲端還原
            </button>
            <button
              onClick={() => { setActiveTab('file'); setMsg(null) }}
              className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
                activeTab === 'file' ? 'bg-[#FFD6A5] text-white shadow-md' : 'bg-[#E8E8E8] text-[#5D5D5D]'
              }`}
            >
              <FileUp size={16} /> 檔案匯入
            </button>
          </div>

          {msg && (
            <div className={`mb-4 p-3 rounded-xl text-sm text-center ${msg.includes('❌') ? 'bg-[#FFADAD]/20 text-[#D64545]' : 'bg-[#A8D8B9]/20 text-[#4A7C59]'}`}>
              {msg}
            </div>
          )}

          {/* 雲端還原 */}
          {activeTab === 'cloud' && (
            <div className="space-y-4">
              <div>
                <label className="flex items-center gap-2 text-xs font-bold text-[#5D5D5D] mb-1">
                  <Link size={14} className="text-[#A0C4FF]" /> GAS 部署網址
                </label>
                <input
                  type="url"
                  value={backupUrl}
                  onChange={e => setBackupUrl(e.target.value)}
                  placeholder="https://script.google.com/..."
                  disabled={busy}
                  className="w-full px-4 py-2.5 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A0C4FF] outline-none text-sm"
                />
              </div>
              <div>
                <label className="flex items-center gap-2 text-xs font-bold text-[#5D5D5D] mb-1">
                  <Key size={14} className="text-[#FFD6A5]" /> 驗證 Token
                </label>
                <input
                  type="password"
                  value={backupToken}
                  onChange={e => setBackupToken(e.target.value)}
                  placeholder="meow1234"
                  disabled={busy}
                  className="w-full px-4 py-2.5 rounded-xl border-2 border-[#E8E8E8] focus:border-[#FFD6A5] outline-none text-sm"
                />
              </div>
              <div>
                <label className="flex items-center gap-2 text-xs font-bold text-[#5D5D5D] mb-1">
                  <Hash size={14} className="text-[#FFADAD]" /> 班級代號
                </label>
                <input
                  type="text"
                  value={classIdInput}
                  onChange={e => setClassIdInput(e.target.value)}
                  placeholder="例如：114_532（可從原裝置的設定頁面取得）"
                  disabled={busy}
                  className="w-full px-4 py-2.5 rounded-xl border-2 border-[#E8E8E8] focus:border-[#FFADAD] outline-none text-sm"
                />
                <p className="text-xs text-[#B8B8B8] mt-1">請從原裝置的「設定 → 雲端備份」區域取得班級代號</p>
              </div>
              <button
                onClick={handleCloudRestore}
                disabled={busy || !backupUrl.trim() || !classIdInput.trim()}
                className="w-full py-3 rounded-2xl bg-gradient-to-r from-[#A0C4FF] to-[#7EB0FF] text-white font-bold text-sm shadow-lg hover:shadow-xl active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {busy ? <><Loader2 size={18} className="animate-spin" />還原中...</> : <><Cloud size={18} />從雲端還原</>}
              </button>
            </div>
          )}

          {/* 檔案匯入 */}
          {activeTab === 'file' && (
            <div className="space-y-4">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-8 rounded-2xl border-2 border-dashed border-[#D8D8D8] hover:border-[#FFD6A5] hover:bg-[#FFD6A5]/5 transition-all flex flex-col items-center gap-3"
              >
                <FileUp size={32} className="text-[#B8B8B8]" />
                <span className="text-sm text-[#8B8B8B] font-medium">點擊選擇備份檔案 (.json)</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileSelect}
                className="hidden"
              />

              {fileSummary && (
                <div className="p-4 rounded-xl bg-white border border-[#E8E8E8] space-y-2">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle size={16} className="text-[#7BC496]" />
                    <span className="text-sm font-bold text-[#5D5D5D]">檔案解析成功</span>
                  </div>
                  <div className="text-xs text-[#8B8B8B] space-y-1">
                    {fileSummary.className && <div>班級名稱：<span className="text-[#5D5D5D] font-medium">{fileSummary.className}</span></div>}
                    <div>班級代號：<span className="text-[#5D5D5D] font-medium">{fileSummary.classId || '(無)'}</span></div>
                    <div>學生人數：<span className="text-[#5D5D5D] font-medium">{fileSummary.studentCount} 人</span></div>
                    {fileSummary.updatedAt && <div>備份時間：<span className="text-[#5D5D5D] font-medium">{new Date(fileSummary.updatedAt).toLocaleString('zh-TW')}</span></div>}
                  </div>
                  {existingClassIds.includes(fileSummary.classId) && (
                    <div className="flex items-center gap-2 mt-2 p-2 rounded-lg bg-[#FFD6A5]/15 text-xs text-[#8B6914]">
                      <AlertTriangle size={14} />
                      <span>此班級已存在於本機，還原將覆蓋現有資料</span>
                    </div>
                  )}
                </div>
              )}

              {fileSummary && (
                <button
                  onClick={handleFileRestore}
                  disabled={!filePayload}
                  className="w-full py-3 rounded-2xl bg-gradient-to-r from-[#FFD6A5] to-[#FFBF69] text-white font-bold text-sm shadow-lg hover:shadow-xl active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Download size={18} /> 確認還原
                </button>
              )}
            </div>
          )}
        </div>
        <div className="h-3" style={{ background: 'repeating-linear-gradient(90deg, #FFD6A5, #FFD6A5 20px, #A0C4FF 20px, #A0C4FF 40px)' }} />
      </div>
    </div>
  )
}

export default RestoreClassModal
