import { useEffect, useRef, useState } from 'react'
import { X, Save, Link, Download, Eye, AlertTriangle, ChevronDown, ChevronUp, Plus, Trash2, Flag, Users } from 'lucide-react'
import { DEFAULT_SETTINGS } from '../../utils/constants'
import { formatDateDisplay, getStatusLabel, makeTaskId } from '../../utils/helpers'

function SettingsModal({ classId, className, settings, students, allLogs, onClose, onSave, onRestoreFromBackup, onClearLocalClass }) {
  const [localSettings, setLocalSettings] = useState({
    taskTypes: settings?.taskTypes || DEFAULT_SETTINGS.taskTypes,
    groupAliases: settings?.groupAliases || {},
    announcements: settings?.announcements || []
  })
  const [newTaskType, setNewTaskType] = useState('')
  const [backupUrl, setBackupUrl] = useState(() => localStorage.getItem('ppt_backup_url') || '')
  const [backupToken, setBackupToken] = useState(() => localStorage.getItem('ppt_backup_token') || 'meow1234')
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupMsg, setBackupMsg] = useState(null)
  const [backupMeta, setBackupMeta] = useState(null)
  const [fileMsg, setFileMsg] = useState(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (!classId) return
    try {
      const raw = localStorage.getItem(`ppt_backup_meta_${classId}`)
      setBackupMeta(raw ? JSON.parse(raw) : null)
    } catch {
      setBackupMeta(null)
    }
  }, [classId])

  const handleSave = () => {
    if (onSave) onSave(localSettings)
    onClose()
  }

  const handleBackupUpload = async () => {
    if (!backupUrl.trim()) {
      setBackupMsg('請輸入 GAS 部署網址')
      return
    }
    try {
      setBackupBusy(true)
      setBackupMsg(null)
      const payload = {
        action: 'backup_upload',
        token: backupToken.trim() || 'meow1234',
        classId,
        className,
        data: {
          classId,
          students,
          logs: allLogs,
          settings: localSettings,
          updatedAt: new Date().toISOString()
        }
      }
      await fetch(backupUrl.trim(), {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(payload)
      })
      localStorage.setItem('ppt_backup_url', backupUrl.trim())
      localStorage.setItem('ppt_backup_token', backupToken.trim() || 'meow1234')
      const meta = { updatedAt: payload.data.updatedAt, className: className || '', classId }
      localStorage.setItem(`ppt_backup_meta_${classId}`, JSON.stringify(meta))
      setBackupMeta(meta)
      setBackupMsg('☁️ 備份成功！')
    } catch (err) {
      console.error('備份失敗:', err)
      setBackupMsg('❌ 備份失敗，請檢查網址')
    } finally {
      setBackupBusy(false)
    }
  }

  const handleBackupDownload = async () => {
    if (!backupUrl.trim()) {
      setBackupMsg('請輸入 GAS 部署網址')
      return
    }
    try {
      setBackupBusy(true)
      setBackupMsg(null)
      const token = backupToken.trim() || 'meow1234'
      const url = `${backupUrl.trim()}?action=backup_download&classId=${classId}&token=${encodeURIComponent(token)}`
      const response = await fetch(url)
      if (!response.ok) throw new Error('Download failed')
      const data = await response.json()
      if (!data?.data) throw new Error('Invalid data')
      const restored = data.data
      saveClassCache(classId, {
        classId,
        students: restored.students || [],
        logs: restored.logs || [],
        settings: restored.settings || localSettings,
        updatedAt: restored.updatedAt || new Date().toISOString()
      })
      if (onRestoreFromBackup) {
        onRestoreFromBackup(restored)
      }
      setLocalSettings(prev => ({
        taskTypes: restored.settings?.taskTypes || prev.taskTypes,
        groupAliases: restored.settings?.groupAliases || prev.groupAliases,
        announcements: restored.settings?.announcements || prev.announcements
      }))
      localStorage.setItem('ppt_backup_url', backupUrl.trim())
      localStorage.setItem('ppt_backup_token', backupToken.trim() || 'meow1234')
      const meta = { updatedAt: restored.updatedAt || new Date().toISOString(), className: className || '', classId }
      localStorage.setItem(`ppt_backup_meta_${classId}`, JSON.stringify(meta))
      setBackupMeta(meta)
      setBackupMsg('✅ 還原成功！')
    } catch (err) {
      console.error('還原失敗:', err)
      setBackupMsg('❌ 還原失敗，找不到備份')
    } finally {
      setBackupBusy(false)
    }
  }

  const makeBackupFileName = () => {
    const safeName = (className || classId || 'class')
      .toString()
      .trim()
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    return `ppt_backup_${safeName}_${dateStr}.json`
  }

  const handleExportBackup = () => {
    try {
      const payload = {
        classId,
        className,
        data: {
          classId,
          students,
          logs: allLogs,
          settings: localSettings,
          updatedAt: new Date().toISOString()
        }
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = makeBackupFileName()
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      setFileMsg('📥 匯出成功！')
    } catch (err) {
      console.error('匯出失敗:', err)
      setFileMsg('❌ 匯出失敗')
    }
  }

  const handleImportBackup = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!window.confirm('確定要從檔案還原嗎？這將覆蓋現有的班級資料！')) {
      event.target.value = ''
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const raw = typeof reader.result === 'string' ? reader.result : ''
        const payload = JSON.parse(raw)
        const restored = payload?.data || payload
        if (!restored || !restored.students || !restored.logs || !restored.settings) {
          throw new Error('Invalid backup file')
        }
        saveClassCache(classId, {
          classId,
          students: restored.students || [],
          logs: restored.logs || [],
          settings: restored.settings || localSettings,
          updatedAt: restored.updatedAt || new Date().toISOString()
        })
        if (onRestoreFromBackup) {
          onRestoreFromBackup(restored)
        }
        setLocalSettings({
          taskTypes: restored.settings?.taskTypes || localSettings.taskTypes,
          groupAliases: restored.settings?.groupAliases || localSettings.groupAliases,
          announcements: restored.settings?.announcements || localSettings.announcements
        })
        setFileMsg('✅ 還原成功！')
      } catch (err) {
        console.error('還原失敗:', err)
        setFileMsg('❌ 還原失敗：檔案格式錯誤')
      } finally {
        event.target.value = ''
      }
    }
    reader.onerror = () => {
      setFileMsg('❌ 讀取檔案失敗')
      event.target.value = ''
    }
    reader.readAsText(file)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative bg-[#fdfbf7] rounded-3xl shadow-2xl max-w-3xl w-full overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="h-3 bg-gradient-to-r from-[#A8D8B9] to-[#FFD6A5]" />

        {/* Header */}
        <div className="p-6 border-b border-[#E8E8E8] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#A8D8B9] to-[#FFD6A5] flex items-center justify-center">
              <Settings size={24} className="text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-[#5D5D5D]">村莊設定</h2>
              <p className="text-sm text-[#8B8B8B]">管理村莊的各項設定與備份</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-[#E8E8E8] transition-colors">
            <X size={24} className="text-[#5D5D5D]" />
          </button>
        </div>

        <div className="p-6 max-h-[75vh] overflow-y-auto space-y-8">
          {/* 任務類型設定 */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-[#5D5D5D] flex items-center gap-2">
              <ClipboardList size={16} className="text-[#A8D8B9]" />
              任務類型設定
            </h3>
            <div className="flex flex-wrap gap-2">
              {localSettings.taskTypes.map(type => (
                <div key={type} className="flex items-center gap-2 px-3 py-1.5 rounded-xl border-2 bg-gray-100 text-gray-700 border-gray-300">
                  <span className="text-sm font-medium">{type}</span>
                  <button onClick={() => setLocalSettings(p => ({...p, taskTypes: p.taskTypes.filter(t => t !== type)}))}>
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={newTaskType}
                onChange={e => setNewTaskType(e.target.value)}
                className="flex-1 px-4 py-2 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none"
                placeholder="輸入新任務類型..."
              />
              <button
                onClick={() => { if(newTaskType.trim()) { setLocalSettings(p => ({...p, taskTypes: [...p.taskTypes, newTaskType.trim()]})); setNewTaskType('') } }}
                className="px-4 py-2 rounded-xl bg-[#A8D8B9] text-white font-bold flex items-center gap-1"
              >
                <Plus size={20} /> 新增
              </button>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* 雲端備份中心 */}
            <div className="border border-[#E8E8E8] rounded-2xl p-5 bg-white/60 space-y-4">
              <h3 className="text-sm font-bold text-[#5D5D5D] flex items-center gap-2">
                <Download size={16} className="text-[#A8D8B9]" />
                雲端備份中心
              </h3>
              <p className="text-xs text-[#8B8B8B]">
                連結 Google Apps Script (GAS) 將資料備份到雲端試算表。
              </p>
              {backupMeta?.updatedAt && (
                <p className="text-xs text-[#7BC496]">
                  ☁️ 上次備份時間：{new Date(backupMeta.updatedAt).toLocaleString()}
                </p>
              )}
              <div className="grid gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-[#5D5D5D] ml-1">GAS 部署網址</label>
                  <input
                    type="url"
                    value={backupUrl}
                    onChange={(e) => setBackupUrl(e.target.value)}
                    placeholder="https://script.google.com/macros/s/.../exec"
                    className="w-full px-3 py-2 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-[#5D5D5D] ml-1">驗證 Token</label>
                  <input
                    type="text"
                    value={backupToken}
                    onChange={(e) => setBackupToken(e.target.value)}
                    placeholder="預設為 meow1234"
                    className="w-full px-3 py-2 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-sm"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleBackupUpload}
                  disabled={backupBusy}
                  className="px-4 py-2 rounded-xl bg-[#A8D8B9] text-white font-bold hover:bg-[#7BC496] transition-all disabled:opacity-50 text-sm flex-1"
                >
                  ☁️ 雲端上傳
                </button>
                <button
                  onClick={handleBackupDownload}
                  disabled={backupBusy}
                  className="px-4 py-2 rounded-xl bg-[#FFD6A5] text-white font-bold hover:bg-[#FFBF69] transition-all disabled:opacity-50 text-sm flex-1"
                >
                  ☁️ 雲端下載
                </button>
              </div>
              {backupMsg && (
                <div className={`text-xs border rounded-xl px-3 py-2 ${backupMsg.includes('失敗') || backupMsg.includes('請輸入') ? 'bg-[#FFADAD]/20 border-[#FFADAD] text-[#D64545]' : 'bg-[#E8F5E9] border-[#A8D8B9] text-[#4A7C59]'}`}>
                  {backupMsg}
                </div>
              )}
            </div>

            {/* 檔案備份與還原 */}
            <div className="border border-[#E8E8E8] rounded-2xl p-5 bg-white/60 space-y-4">
              <h3 className="text-sm font-bold text-[#5D5D5D] flex items-center gap-2">
                <Save size={16} className="text-[#FFD6A5]" />
                檔案備份與還原
              </h3>
              <p className="text-xs text-[#8B8B8B]">
                將村莊資料匯出為 JSON 檔案，或從檔案還原。
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleImportBackup}
              />
              <div className="flex flex-col gap-2">
                <button
                  onClick={handleExportBackup}
                  className="w-full px-4 py-2.5 rounded-xl bg-[#A0C4FF] text-white font-bold hover:bg-[#7EB0FF] transition-all text-sm flex items-center justify-center gap-2"
                >
                  <Download size={16} />
                  📥 匯出備份檔案
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full px-4 py-2.5 rounded-xl bg-[#BDB2FF] text-white font-bold hover:bg-[#9B8FFF] transition-all text-sm flex items-center justify-center gap-2"
                >
                  <Link size={16} />
                  📤 匯入備份檔案
                </button>
              </div>
              {fileMsg && (
                <div className={`text-xs border rounded-xl px-3 py-2 ${fileMsg.includes('失敗') ? 'bg-[#FFADAD]/20 border-[#FFADAD] text-[#D64545]' : 'bg-[#E8F5E9] border-[#A8D8B9] text-[#4A7C59]'}`}>
                  {fileMsg}
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-[#E8E8E8] pt-6">
            <button
              onClick={() => {
                if (window.confirm('確定要清除此班級的所有本地資料嗎？此動作無法復原！')) {
                  onClearLocalClass?.(classId)
                  onClose()
                }
              }}
              className="w-full py-2.5 rounded-xl bg-[#FFADAD]/20 text-[#D64545] font-bold hover:bg-[#FFADAD]/30 transition-colors text-sm flex items-center justify-center gap-2"
            >
              <Trash2 size={16} />
              清除此班級本地資料
            </button>
          </div>

          <div className="mt-6 flex gap-3">
            <button onClick={handleSave} className="flex-1 py-3 rounded-xl bg-gradient-to-r from-[#A8D8B9] to-[#7BC496] text-white font-bold shadow-md hover:shadow-lg transition-all">
              儲存設定
            </button>
            <button onClick={onClose} className="px-6 py-3 rounded-xl bg-[#E8E8E8] text-[#5D5D5D] font-medium hover:bg-[#D8D8D8] transition-colors">
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
// ============================================
// Header
// ============================================

export default SettingsModal
