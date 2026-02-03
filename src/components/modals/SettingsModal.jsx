import { useEffect, useRef, useState } from 'react'
import { X, Save, Link, Download, Plus, Trash2, Settings, ClipboardList, Briefcase, Scale, Coins, Banknote, ChevronDown } from 'lucide-react'
import { DEFAULT_SETTINGS, JOB_CYCLES, DEFAULT_RULE_CATEGORIES } from '../../utils/constants'
import { saveClassCache, generateId } from '../../utils/helpers'
import IconPicker, { RenderIcon } from '../common/IconPicker'

function SettingsModal({ classId, className, settings, students, allLogs, onClose, onSave, onRestoreFromBackup, onClearLocalClass, onProcessPayroll }) {
  const [activeTab, setActiveTab] = useState('general')
  const [localSettings, setLocalSettings] = useState({
    taskTypes: settings?.taskTypes || DEFAULT_SETTINGS.taskTypes,
    groupAliases: settings?.groupAliases || {},
    announcements: settings?.announcements || [],
    jobs: settings?.jobs || DEFAULT_SETTINGS.jobs,
    behaviorRules: settings?.behaviorRules || DEFAULT_SETTINGS.behaviorRules,
    storeItems: settings?.storeItems || DEFAULT_SETTINGS.storeItems,
    currencyRates: settings?.currencyRates || DEFAULT_SETTINGS.currencyRates,
    ruleCategories: settings?.ruleCategories || DEFAULT_SETTINGS.ruleCategories,
    jobAssignments: settings?.jobAssignments || DEFAULT_SETTINGS.jobAssignments,
  })
  const [newTaskType, setNewTaskType] = useState('')
  const [backupUrl, setBackupUrl] = useState(() => localStorage.getItem('ppt_backup_url') || '')
  const [backupToken, setBackupToken] = useState(() => localStorage.getItem('ppt_backup_token') || 'meow1234')
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupMsg, setBackupMsg] = useState(null)
  const [backupMeta, setBackupMeta] = useState(null)
  const [fileMsg, setFileMsg] = useState(null)
  const [showPayroll, setShowPayroll] = useState(false)
  const [selectedPayrollCycles, setSelectedPayrollCycles] = useState([])
  const [newCategoryName, setNewCategoryName] = useState('')
  const [openStudentDropdown, setOpenStudentDropdown] = useState(null)
  const fileInputRef = useRef(null)
  const studentDropdownRef = useRef(null)

  useEffect(() => {
    if (!classId) return
    try {
      const raw = localStorage.getItem(`ppt_backup_meta_${classId}`)
      setBackupMeta(raw ? JSON.parse(raw) : null)
    } catch {
      setBackupMeta(null)
    }
  }, [classId])

  useEffect(() => {
    if (!openStudentDropdown) return
    function handleClick(e) {
      if (studentDropdownRef.current && !studentDropdownRef.current.contains(e.target)) {
        setOpenStudentDropdown(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [openStudentDropdown])

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
        announcements: restored.settings?.announcements || prev.announcements,
        jobs: restored.settings?.jobs || prev.jobs,
        behaviorRules: restored.settings?.behaviorRules || prev.behaviorRules,
        storeItems: restored.settings?.storeItems || prev.storeItems,
        currencyRates: restored.settings?.currencyRates || prev.currencyRates,
        ruleCategories: restored.settings?.ruleCategories || prev.ruleCategories,
        jobAssignments: restored.settings?.jobAssignments || prev.jobAssignments,
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
        setLocalSettings(prev => ({
          taskTypes: restored.settings?.taskTypes || prev.taskTypes,
          groupAliases: restored.settings?.groupAliases || prev.groupAliases,
          announcements: restored.settings?.announcements || prev.announcements,
          jobs: restored.settings?.jobs || prev.jobs,
          behaviorRules: restored.settings?.behaviorRules || prev.behaviorRules,
          storeItems: restored.settings?.storeItems || prev.storeItems,
          currencyRates: restored.settings?.currencyRates || prev.currencyRates,
          ruleCategories: restored.settings?.ruleCategories || prev.ruleCategories,
          jobAssignments: restored.settings?.jobAssignments || prev.jobAssignments,
        }))
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

  // --- Jobs CRUD ---
  const updateJob = (jobId, field, value) => {
    setLocalSettings(p => ({
      ...p,
      jobs: p.jobs.map(j => {
        if (j.id !== jobId) return j
        if (field === 'salary') return { ...j, salary: parseInt(value) || 0 }
        return { ...j, [field]: value }
      })
    }))
  }
  const addJob = () => {
    setLocalSettings(p => ({
      ...p,
      jobs: [...p.jobs, { id: generateId('job'), title: '', salary: 100, icon: '📋', cycle: 'weekly' }]
    }))
  }
  const removeJob = (jobId) => {
    setLocalSettings(p => ({
      ...p,
      jobs: p.jobs.filter(j => j.id !== jobId),
      jobAssignments: { ...p.jobAssignments, [jobId]: undefined },
    }))
  }

  // --- Job Assignments ---
  const addStudentToJob = (jobId, studentId) => {
    setLocalSettings(p => ({
      ...p,
      jobAssignments: {
        ...p.jobAssignments,
        [jobId]: [...(p.jobAssignments[jobId] || []), studentId],
      }
    }))
  }
  const removeStudentFromJob = (jobId, studentId) => {
    setLocalSettings(p => ({
      ...p,
      jobAssignments: {
        ...p.jobAssignments,
        [jobId]: (p.jobAssignments[jobId] || []).filter(id => id !== studentId),
      }
    }))
  }
  const selectAllStudentsForJob = (jobId) => {
    setLocalSettings(p => ({
      ...p,
      jobAssignments: {
        ...p.jobAssignments,
        [jobId]: students.map(s => s.id),
      }
    }))
  }
  const clearAllStudentsForJob = (jobId) => {
    setLocalSettings(p => ({
      ...p,
      jobAssignments: {
        ...p.jobAssignments,
        [jobId]: [],
      }
    }))
  }

  // --- Payroll ---
  const payrollPreview = () => {
    const entries = []
    localSettings.jobs.forEach(job => {
      if (!selectedPayrollCycles.includes(job.cycle)) return
      const assignedIds = localSettings.jobAssignments[job.id] || []
      assignedIds.forEach(sid => {
        const student = students.find(s => s.id === sid)
        if (!student) return
        entries.push({ studentId: sid, studentName: student.name, amount: job.salary, reason: `${job.title} 薪資 (${JOB_CYCLES[job.cycle] || job.cycle})` })
      })
    })
    return entries
  }

  const handleProcessPayroll = () => {
    const entries = payrollPreview()
    if (entries.length === 0) return
    if (onProcessPayroll) onProcessPayroll(entries)
    setShowPayroll(false)
    setSelectedPayrollCycles([])
  }

  // --- Behavior Standards CRUD ---
  const updateRule = (ruleId, field, value) => {
    setLocalSettings(p => ({
      ...p,
      behaviorRules: p.behaviorRules.map(r => {
        if (r.id !== ruleId) return r
        if (field === 'amount') {
          const num = parseInt(value) || 0
          return { ...r, amount: r.type === 'fine' ? -Math.abs(num) : Math.abs(num) }
        }
        return { ...r, [field]: value }
      })
    }))
  }
  const addRule = (type, category = '') => {
    const catMeta = (localSettings.ruleCategories || []).find(c => c.name === category)
    const amount = type === 'fine' ? -100 : 100
    setLocalSettings(p => ({
      ...p,
      behaviorRules: [...p.behaviorRules, {
        id: generateId('rule'),
        label: '',
        amount,
        type,
        icon: catMeta?.icon || (type === 'fine' ? '⚠️' : '⭐'),
        category: category || '未分類',
      }]
    }))
  }
  const removeRule = (ruleId) => {
    setLocalSettings(p => ({ ...p, behaviorRules: p.behaviorRules.filter(r => r.id !== ruleId) }))
  }

  // --- Rule Categories CRUD ---
  const addCategory = () => {
    if (!newCategoryName.trim()) return
    setLocalSettings(p => ({
      ...p,
      ruleCategories: [...(p.ruleCategories || []), { id: generateId('cat'), name: newCategoryName.trim(), icon: '📋' }]
    }))
    setNewCategoryName('')
  }
  const updateCategory = (catId, field, value) => {
    setLocalSettings(p => ({
      ...p,
      ruleCategories: (p.ruleCategories || []).map(c => c.id === catId ? { ...c, [field]: value } : c)
    }))
  }
  const removeCategory = (catId) => {
    const cat = (localSettings.ruleCategories || []).find(c => c.id === catId)
    if (!cat) return
    setLocalSettings(p => ({
      ...p,
      ruleCategories: (p.ruleCategories || []).filter(c => c.id !== catId),
      behaviorRules: p.behaviorRules.map(r => r.category === cat.name ? { ...r, category: '未分類' } : r)
    }))
  }

  // Group rules by category
  const rulesByCategory = (() => {
    const cats = (localSettings.ruleCategories || []).map(c => c.name)
    const groups = {}
    cats.forEach(name => { groups[name] = { bonus: [], fine: [] } })
    localSettings.behaviorRules.forEach(rule => {
      const cat = rule.category || '未分類'
      if (!groups[cat]) groups[cat] = { bonus: [], fine: [] }
      groups[cat][rule.type === 'fine' ? 'fine' : 'bonus'].push(rule)
    })
    return groups
  })()

  const tabs = [
    { key: 'general', label: '一般設定', icon: Settings },
    { key: 'jobs', label: '職務設定', icon: Briefcase },
    { key: 'behavior', label: '行為規範', icon: Scale },
    { key: 'currency', label: '貨幣設定', icon: Coins },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative bg-[#fdfbf7] rounded-3xl shadow-2xl max-w-3xl w-full overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="h-3 bg-gradient-to-r from-[#A8D8B9] to-[#FFD6A5] shrink-0" />

        {/* Header */}
        <div className="p-6 pb-0 flex items-center justify-between shrink-0">
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

        {/* Tab Navigation */}
        <div className="px-6 pt-4 flex gap-1 border-b border-[#E8E8E8] overflow-x-auto shrink-0">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 rounded-t-xl font-bold text-sm transition-all whitespace-nowrap flex items-center gap-2 ${
                activeTab === tab.key
                  ? 'bg-white text-[#5D5D5D] border border-[#E8E8E8] border-b-white -mb-px'
                  : 'text-[#8B8B8B] hover:text-[#5D5D5D] hover:bg-[#F9F9F9]'
              }`}
            >
              <tab.icon size={16} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* ===== 一般設定 ===== */}
          {activeTab === 'general' && (
            <div className="p-6 space-y-8">
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
                    onKeyDown={e => { if (e.key === 'Enter' && newTaskType.trim()) { setLocalSettings(p => ({...p, taskTypes: [...p.taskTypes, newTaskType.trim()]})); setNewTaskType('') } }}
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
            </div>
          )}

          {/* ===== 職務設定 ===== */}
          {activeTab === 'jobs' && (
            <div className="p-6 space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-[#5D5D5D] flex items-center gap-2">
                    <Briefcase size={16} className="text-[#FFD6A5]" />
                    班級職務
                  </h3>
                  <p className="text-xs text-[#8B8B8B]">設定班級職務、薪資與發放週期，並指派村民</p>
                </div>
                <button
                  onClick={() => { setSelectedPayrollCycles([]); setShowPayroll(true) }}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#FFD6A5] to-[#FFBF69] text-white font-bold text-sm shadow-md hover:shadow-lg transition-all flex items-center gap-1.5"
                >
                  <Banknote size={16} />
                  發放薪資
                </button>
              </div>

              <div className="space-y-3">
                {localSettings.jobs.map(job => (
                  <div key={job.id} className="p-3 bg-white rounded-xl border border-[#E8E8E8] hover:border-[#FFD6A5] transition-colors space-y-2">
                    <div className="flex items-center gap-3">
                      <IconPicker value={job.icon} onChange={v => updateJob(job.id, 'icon', v)} />
                      <input
                        type="text"
                        value={job.title}
                        onChange={e => updateJob(job.id, 'title', e.target.value)}
                        className="flex-1 px-3 py-2 rounded-lg border border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-sm font-medium"
                        placeholder="職務名稱"
                      />
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          value={job.salary}
                          onChange={e => updateJob(job.id, 'salary', e.target.value)}
                          className="w-20 px-2 py-2 rounded-lg border border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-sm text-center font-bold"
                        />
                        <span className="text-xs text-[#8B8B8B] whitespace-nowrap">pt</span>
                      </div>
                      <select
                        value={job.cycle || 'weekly'}
                        onChange={e => updateJob(job.id, 'cycle', e.target.value)}
                        className="px-2 py-2 rounded-lg border border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-xs font-medium"
                      >
                        {Object.entries(JOB_CYCLES).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => removeJob(job.id)}
                        className="p-1.5 rounded-lg hover:bg-[#FFADAD]/20 text-[#8B8B8B] hover:text-[#D64545] transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    {/* Student assignments */}
                    <div className="flex flex-wrap items-center gap-1.5 ml-12">
                      {(localSettings.jobAssignments[job.id] || []).map(sid => {
                        const s = students.find(x => x.id === sid)
                        if (!s) return null
                        return (
                          <span key={sid} className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#FFD6A5]/20 rounded-full text-xs font-medium text-[#8B6914]">
                            {s.number}號 {s.name}
                            <button onClick={() => removeStudentFromJob(job.id, sid)} className="hover:text-[#D64545]">
                              <X size={10} />
                            </button>
                          </span>
                        )
                      })}
                      <div className="relative" ref={openStudentDropdown === job.id ? studentDropdownRef : null}>
                        <button
                          type="button"
                          onClick={() => setOpenStudentDropdown(openStudentDropdown === job.id ? null : job.id)}
                          className="text-xs px-2 py-1 rounded-lg border border-dashed border-[#E8E8E8] text-[#8B8B8B] hover:border-[#FFD6A5] cursor-pointer bg-transparent flex items-center gap-1"
                        >
                          <Plus size={10} /> 指派村民
                          <ChevronDown size={10} className={`transition-transform ${openStudentDropdown === job.id ? 'rotate-180' : ''}`} />
                        </button>
                        {openStudentDropdown === job.id && (
                          <div className="absolute z-50 top-full left-0 mt-1 w-56 bg-white rounded-xl shadow-xl border border-[#E8E8E8] overflow-hidden">
                            <div className="sticky top-0 bg-[#F9F9F9] border-b border-[#E8E8E8] px-2 py-1.5 flex gap-2 z-10">
                              <button
                                type="button"
                                onClick={() => selectAllStudentsForJob(job.id)}
                                className="flex-1 py-1 rounded-lg bg-[#A8D8B9] text-white text-xs font-bold hover:bg-[#7BC496] transition-colors"
                              >
                                全選
                              </button>
                              <button
                                type="button"
                                onClick={() => clearAllStudentsForJob(job.id)}
                                className="flex-1 py-1 rounded-lg bg-[#E8E8E8] text-[#5D5D5D] text-xs font-bold hover:bg-[#D8D8D8] transition-colors"
                              >
                                清空
                              </button>
                            </div>
                            <div className="max-h-48 overflow-y-auto p-1.5 space-y-0.5" style={{ scrollbarWidth: 'thin' }}>
                              {students.map(s => {
                                const isAssigned = (localSettings.jobAssignments[job.id] || []).includes(s.id)
                                return (
                                  <label
                                    key={s.id}
                                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[#F9F9F9] cursor-pointer text-xs"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isAssigned}
                                      onChange={() => isAssigned ? removeStudentFromJob(job.id, s.id) : addStudentToJob(job.id, s.id)}
                                      className="accent-[#A8D8B9] shrink-0"
                                    />
                                    <span className={isAssigned ? 'font-bold text-[#5D5D5D]' : 'text-[#8B8B8B]'}>
                                      {s.number}號 {s.name}
                                    </span>
                                  </label>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={addJob}
                className="w-full py-3 rounded-xl border-2 border-dashed border-[#E8E8E8] text-[#8B8B8B] font-medium hover:border-[#FFD6A5] hover:text-[#8B6914] transition-colors flex items-center justify-center gap-2"
              >
                <Plus size={18} /> 新增職務
              </button>
            </div>
          )}

          {/* ===== 行為規範 ===== */}
          {activeTab === 'behavior' && (
            <div className="p-6 space-y-6">
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-[#5D5D5D] flex items-center gap-2">
                  <Scale size={16} className="text-[#FFADAD]" />
                  行為加扣分規範
                </h3>
                <p className="text-xs text-[#8B8B8B]">按類別管理快速加扣分按鈕，將顯示在村民護照的存摺頁中</p>
              </div>

              {/* Category Management */}
              <div className="p-4 bg-[#F9F9F9] rounded-xl border border-[#E8E8E8] space-y-3">
                <div className="text-xs font-bold text-[#5D5D5D]">類別管理</div>
                <div className="flex flex-wrap gap-2">
                  {(localSettings.ruleCategories || []).map(cat => (
                    <div key={cat.id} className="flex items-center gap-1.5 px-2 py-1 bg-white rounded-lg border border-[#E8E8E8]">
                      <input
                        type="text"
                        value={cat.icon}
                        onChange={e => updateCategory(cat.id, 'icon', e.target.value)}
                        className="w-7 text-center text-base bg-transparent outline-none"
                        maxLength={2}
                      />
                      <input
                        type="text"
                        value={cat.name}
                        onChange={e => updateCategory(cat.id, 'name', e.target.value)}
                        className="w-16 px-1 py-0.5 text-xs font-medium bg-transparent outline-none border-b border-transparent focus:border-[#A8D8B9]"
                      />
                      <button onClick={() => removeCategory(cat.id)} className="text-[#8B8B8B] hover:text-[#D64545]">
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newCategoryName}
                    onChange={e => setNewCategoryName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addCategory() }}
                    className="flex-1 px-3 py-1.5 rounded-lg border border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-xs"
                    placeholder="新類別名稱..."
                  />
                  <button onClick={addCategory} className="px-3 py-1.5 rounded-lg bg-[#A8D8B9] text-white text-xs font-bold">
                    <Plus size={14} />
                  </button>
                </div>
              </div>

              {/* Rules grouped by category */}
              {Object.entries(rulesByCategory).map(([catName, { bonus, fine }]) => {
                const catMeta = (localSettings.ruleCategories || []).find(c => c.name === catName)
                return (
                  <div key={catName} className="rounded-xl border border-[#E8E8E8] overflow-hidden">
                    <div className="px-4 py-2.5 bg-[#F9F9F9] flex items-center gap-2">
                      <span className="text-base">{catMeta?.icon || '📋'}</span>
                      <span className="text-sm font-bold text-[#5D5D5D]">{catName}</span>
                    </div>

                    <div className="p-4 space-y-4">
                      {/* Bonus rules */}
                      <div className="space-y-2">
                        <h4 className="text-xs font-bold text-[#4A7C59] flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-[#A8D8B9]" />
                          加分項目
                        </h4>
                        {bonus.map(rule => (
                          <div key={rule.id} className="flex items-center gap-3 p-2.5 bg-[#A8D8B9]/10 rounded-xl border border-[#A8D8B9]/30">
                            <IconPicker value={rule.icon} onChange={v => updateRule(rule.id, 'icon', v)} />
                            <input
                              type="text"
                              value={rule.label}
                              onChange={e => updateRule(rule.id, 'label', e.target.value)}
                              className="flex-1 px-2 py-1.5 rounded-lg border border-[#A8D8B9]/30 focus:border-[#A8D8B9] outline-none text-sm font-medium bg-white"
                              placeholder="規則名稱"
                            />
                            <div className="flex items-center gap-1">
                              <span className="text-[#4A7C59] font-bold text-sm">+</span>
                              <input
                                type="number"
                                value={Math.abs(rule.amount)}
                                onChange={e => updateRule(rule.id, 'amount', e.target.value)}
                                className="w-16 px-2 py-1.5 rounded-lg border border-[#A8D8B9]/30 focus:border-[#A8D8B9] outline-none text-sm text-center font-bold bg-white"
                                min="0"
                              />
                              <span className="text-[10px] text-[#8B8B8B]">pt</span>
                            </div>
                            <button
                              onClick={() => removeRule(rule.id)}
                              className="p-1 rounded-lg hover:bg-[#FFADAD]/20 text-[#8B8B8B] hover:text-[#D64545] transition-colors"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={() => addRule('bonus', catName)}
                          className="w-full py-2 rounded-xl border-2 border-dashed border-[#A8D8B9]/40 text-[#4A7C59]/60 font-medium hover:border-[#A8D8B9] hover:text-[#4A7C59] transition-colors flex items-center justify-center gap-1 text-xs"
                        >
                          <Plus size={14} /> 新增加分
                        </button>
                      </div>

                      {/* Fine rules */}
                      <div className="space-y-2">
                        <h4 className="text-xs font-bold text-[#D64545] flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-[#FFADAD]" />
                          扣分項目
                        </h4>
                        {fine.map(rule => (
                          <div key={rule.id} className="flex items-center gap-3 p-2.5 bg-[#FFADAD]/10 rounded-xl border border-[#FFADAD]/30">
                            <IconPicker value={rule.icon} onChange={v => updateRule(rule.id, 'icon', v)} />
                            <input
                              type="text"
                              value={rule.label}
                              onChange={e => updateRule(rule.id, 'label', e.target.value)}
                              className="flex-1 px-2 py-1.5 rounded-lg border border-[#FFADAD]/30 focus:border-[#FFADAD] outline-none text-sm font-medium bg-white"
                              placeholder="規則名稱"
                            />
                            <div className="flex items-center gap-1">
                              <span className="text-[#D64545] font-bold text-sm">-</span>
                              <input
                                type="number"
                                value={Math.abs(rule.amount)}
                                onChange={e => updateRule(rule.id, 'amount', e.target.value)}
                                className="w-16 px-2 py-1.5 rounded-lg border border-[#FFADAD]/30 focus:border-[#FFADAD] outline-none text-sm text-center font-bold bg-white"
                                min="0"
                              />
                              <span className="text-[10px] text-[#8B8B8B]">pt</span>
                            </div>
                            <button
                              onClick={() => removeRule(rule.id)}
                              className="p-1 rounded-lg hover:bg-[#FFADAD]/20 text-[#8B8B8B] hover:text-[#D64545] transition-colors"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={() => addRule('fine', catName)}
                          className="w-full py-2 rounded-xl border-2 border-dashed border-[#FFADAD]/40 text-[#D64545]/60 font-medium hover:border-[#FFADAD] hover:text-[#D64545] transition-colors flex items-center justify-center gap-1 text-xs"
                        >
                          <Plus size={14} /> 新增扣分
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* ===== 貨幣設定 ===== */}
          {activeTab === 'currency' && (
            <div className="p-6 space-y-6">
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-[#5D5D5D] flex items-center gap-2">
                  <Coins size={16} className="text-[#FFD6A5]" />
                  貨幣匯率設定
                </h3>
                <p className="text-xs text-[#8B8B8B]">調整貨幣兌換比率（所有金額以積分為基底儲存）</p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-4 p-4 bg-white rounded-xl border border-[#E8E8E8]">
                  <span className="text-3xl">🐟</span>
                  <div className="flex-1">
                    <div className="text-sm font-bold text-[#5D5D5D]">小魚乾</div>
                    <div className="text-xs text-[#8B8B8B]">基本兌換單位</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-[#5D5D5D]">1 小魚乾 =</span>
                    <input
                      type="number"
                      value={localSettings.currencyRates.fish}
                      onChange={e => setLocalSettings(p => ({
                        ...p,
                        currencyRates: { ...p.currencyRates, fish: parseInt(e.target.value) || 100 }
                      }))}
                      className="w-24 px-3 py-2 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-center font-bold"
                      min="1"
                    />
                    <span className="text-sm text-[#8B8B8B]">積分</span>
                  </div>
                </div>

                <div className="flex items-center gap-4 p-4 bg-white rounded-xl border border-[#E8E8E8]">
                  <span className="text-3xl">🍪</span>
                  <div className="flex-1">
                    <div className="text-sm font-bold text-[#5D5D5D]">貓薄荷餅乾</div>
                    <div className="text-xs text-[#8B8B8B]">高級兌換單位</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-[#5D5D5D]">1 餅乾 =</span>
                    <input
                      type="number"
                      value={localSettings.currencyRates.cookie}
                      onChange={e => setLocalSettings(p => ({
                        ...p,
                        currencyRates: { ...p.currencyRates, cookie: parseInt(e.target.value) || 1000 }
                      }))}
                      className="w-24 px-3 py-2 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-center font-bold"
                      min="1"
                    />
                    <span className="text-sm text-[#8B8B8B]">積分</span>
                  </div>
                </div>
              </div>

              {/* Preview */}
              <div className="p-4 bg-[#FFD6A5]/10 rounded-xl border border-[#FFD6A5]/30">
                <div className="text-xs font-bold text-[#8B6914] mb-2">換算預覽</div>
                <div className="text-sm text-[#5D5D5D] space-y-1">
                  <div>6500 積分 = {Math.floor(6500 / localSettings.currencyRates.cookie)} 🍪 {Math.floor((6500 % localSettings.currencyRates.cookie) / localSettings.currencyRates.fish)} 🐟 {6500 % localSettings.currencyRates.cookie % localSettings.currencyRates.fish > 0 ? `${6500 % localSettings.currencyRates.cookie % localSettings.currencyRates.fish} pt` : ''}</div>
                  <div>1 🍪 = {localSettings.currencyRates.cookie / localSettings.currencyRates.fish} 🐟</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer - always visible */}
        <div className="p-4 border-t border-[#E8E8E8] flex gap-3 shrink-0">
          <button onClick={handleSave} className="flex-1 py-3 rounded-xl bg-gradient-to-r from-[#A8D8B9] to-[#7BC496] text-white font-bold shadow-md hover:shadow-lg transition-all">
            儲存設定
          </button>
          <button onClick={onClose} className="px-6 py-3 rounded-xl bg-[#E8E8E8] text-[#5D5D5D] font-medium hover:bg-[#D8D8D8] transition-colors">
            取消
          </button>
        </div>

        {/* Payroll Sub-Modal */}
        {showPayroll && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center z-20">
            <div className="bg-white rounded-2xl p-6 max-w-lg w-full mx-4 shadow-2xl max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between mb-4 shrink-0">
                <h3 className="text-lg font-bold text-[#5D5D5D] flex items-center gap-2">
                  <Banknote size={20} className="text-[#FFD6A5]" />
                  發放薪資
                </h3>
                <button onClick={() => setShowPayroll(false)} className="p-1.5 rounded-full hover:bg-[#E8E8E8]">
                  <X size={18} className="text-[#5D5D5D]" />
                </button>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto space-y-4" style={{ scrollbarWidth: 'thin' }}>
                <p className="text-xs text-[#8B8B8B]">勾選要發放的薪資週期，系統會自動計算並批次入帳</p>

                {/* Cycle checkboxes */}
                <div className="space-y-2">
                  {Object.entries(JOB_CYCLES).map(([cycleKey, cycleLabel]) => {
                    const jobsInCycle = localSettings.jobs.filter(j => j.cycle === cycleKey)
                    if (jobsInCycle.length === 0) return null
                    const checked = selectedPayrollCycles.includes(cycleKey)
                    return (
                      <label key={cycleKey} className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${checked ? 'border-[#FFD6A5] bg-[#FFD6A5]/10' : 'border-[#E8E8E8] hover:border-[#FFD6A5]/50'}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setSelectedPayrollCycles(prev =>
                              prev.includes(cycleKey) ? prev.filter(c => c !== cycleKey) : [...prev, cycleKey]
                            )
                          }}
                          className="mt-0.5 accent-[#FFD6A5]"
                        />
                        <div className="flex-1">
                          <div className="text-sm font-bold text-[#5D5D5D]">{cycleLabel}</div>
                          <div className="mt-1 space-y-1">
                            {jobsInCycle.map(job => {
                              const assigned = (localSettings.jobAssignments[job.id] || [])
                                .map(sid => students.find(s => s.id === sid))
                                .filter(Boolean)
                              return (
                                <div key={job.id} className="text-xs text-[#8B8B8B] flex items-center gap-2">
                                  <RenderIcon name={job.icon} size={14} />
                                  <span className="font-medium text-[#5D5D5D]">{job.title}</span>
                                  <span>({job.salary} pt)</span>
                                  <span className="text-[10px]">
                                    {assigned.length > 0 ? assigned.map(s => s.name).join(', ') : '(未指派)'}
                                  </span>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      </label>
                    )
                  })}
                </div>

                {/* Preview */}
                {selectedPayrollCycles.length > 0 && (() => {
                  const entries = payrollPreview()
                  if (entries.length === 0) return (
                    <div className="p-3 rounded-xl bg-[#F9F9F9] text-center text-xs text-[#8B8B8B]">
                      選中的週期沒有已指派村民的職務
                    </div>
                  )
                  const total = entries.reduce((sum, e) => sum + e.amount, 0)
                  return (
                    <div className="p-4 rounded-xl bg-[#E8F5E9] border border-[#A8D8B9]/30 space-y-2">
                      <div className="text-xs font-bold text-[#4A7C59]">發放預覽</div>
                      {entries.map((entry, idx) => (
                        <div key={idx} className="flex items-center justify-between text-xs">
                          <span className="text-[#5D5D5D]">{entry.studentName}</span>
                          <span className="font-bold text-[#4A7C59]">+{entry.amount} pt</span>
                        </div>
                      ))}
                      <div className="border-t border-[#A8D8B9]/30 pt-2 flex items-center justify-between text-sm">
                        <span className="font-bold text-[#5D5D5D]">總計</span>
                        <span className="font-bold text-[#4A7C59]">+{total} pt</span>
                      </div>
                    </div>
                  )
                })()}
              </div>

              <div className="flex gap-3 mt-4 shrink-0">
                <button
                  onClick={() => setShowPayroll(false)}
                  className="flex-1 py-2.5 rounded-xl bg-[#E8E8E8] text-[#5D5D5D] font-medium hover:bg-[#D8D8D8] transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleProcessPayroll}
                  disabled={payrollPreview().length === 0}
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-[#FFD6A5] to-[#FFBF69] text-white font-bold shadow-md hover:shadow-lg transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  <Banknote size={16} />
                  確認發放
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default SettingsModal
