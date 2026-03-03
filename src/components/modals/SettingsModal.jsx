import { useEffect, useRef, useState } from 'react'
import { X, Save, Link, Download, Plus, Trash2, Settings, ClipboardList, Briefcase, Scale, Coins, Banknote, ChevronDown, ShoppingBag, Zap, Home } from 'lucide-react'
import { DEFAULT_SETTINGS, JOB_CYCLES, DEFAULT_RULE_CATEGORIES, DEFAULT_SHOP, DEFAULT_AUTOMATION, DEFAULT_SEATING_CHART } from '../../utils/constants'
import { saveClassCache, generateId, resolveCurrency, formatCurrency } from '../../utils/helpers'
import IconPicker, { RenderIcon } from '../common/IconPicker'
import JobSettingsTab from './settings/JobSettingsTab'

function SettingsModal({ classId, className, classEntry, settings, students, allLogs, onClose, onSave, onUpdateClassInfo, onRestoreFromBackup, onClearLocalClass, onProcessPayroll }) {
  const [activeTab, setActiveTab] = useState('general')
  const [localSettings, setLocalSettings] = useState({
    taskTypes: [...(settings?.taskTypes || DEFAULT_SETTINGS.taskTypes)],
    groupAliases: settings?.groupAliases || {},
    announcements: settings?.announcements || [],
    jobs: settings?.jobs || DEFAULT_SETTINGS.jobs,
    behaviorRules: settings?.behaviorRules || DEFAULT_SETTINGS.behaviorRules,

    shop: settings?.shop || (settings?.storeItems ? { ...DEFAULT_SHOP, products: settings.storeItems } : DEFAULT_SHOP),
    currency: resolveCurrency(settings),
    ruleCategories: settings?.ruleCategories || DEFAULT_SETTINGS.ruleCategories,
    jobAssignments: settings?.jobAssignments || DEFAULT_SETTINGS.jobAssignments,
    automation: settings?.automation || DEFAULT_AUTOMATION,
    seatingChart: settings?.seatingChart || DEFAULT_SEATING_CHART,
  })
  const currency = resolveCurrency(localSettings)
  const currencyPreview = formatCurrency(6500, currency)
  const [newTaskType, setNewTaskType] = useState('')
  const [backupUrl, setBackupUrl] = useState(() => localStorage.getItem('ppt_backup_url') || '')
  const [backupToken, setBackupToken] = useState(() => localStorage.getItem('ppt_backup_token') || '')
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupMsg, setBackupMsg] = useState(null)
  const [backupMeta, setBackupMeta] = useState(null)
  const [fileMsg, setFileMsg] = useState(null)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryIcon, setNewCategoryIcon] = useState('🏷️')
  const fileInputRef = useRef(null)

  // v3.7.3: 村莊基本資訊編輯
  const [villageName, setVillageName] = useState(classEntry?.name || '')
  const [villageAlias, setVillageAlias] = useState(classEntry?.alias || '')
  const [villageTeacher, setVillageTeacher] = useState(classEntry?.teacher || '')

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
    if (onUpdateClassInfo) {
      onUpdateClassInfo({
        name: villageName.trim() || className,
        alias: villageAlias.trim(),
        teacher: villageTeacher.trim(),
      })
    }
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
        token: backupToken.trim(),
        classId,
        className,
        data: {
          classId,
          className,
          teacher: classEntry?.teacher || '',
          students,
          logs: allLogs,
          settings,
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
      localStorage.setItem('ppt_backup_token', backupToken.trim())
      const meta = { updatedAt: payload.data.updatedAt, className: className || '', classId }
      localStorage.setItem(`ppt_backup_meta_${classId}`, JSON.stringify(meta))
      setBackupMeta(meta)
      setBackupMsg('☁️ 備份已送出（因跨域限制無法確認結果，建議執行一次雲端下載驗證）')
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
      const token = backupToken.trim()
      const url = `${backupUrl.trim()}?action=backup_download&classId=${classId}&token=${encodeURIComponent(token)}`
      const response = await fetch(url)
      if (!response.ok) throw new Error('Download failed')
      const data = await response.json()
      if (!data?.data) throw new Error('Invalid data')
      const restored = data.data
      if (!Array.isArray(restored.students) || !Array.isArray(restored.logs)) {
        throw new Error('備份資料結構不完整（缺少 students 或 logs）')
      }
      saveClassCache(classId, {
        classId,
        students: restored.students,
        logs: restored.logs,
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
        shop: restored.settings?.shop || (restored.settings?.storeItems ? { ...DEFAULT_SHOP, products: restored.settings.storeItems } : prev.shop),
        currency: resolveCurrency(restored.settings || prev),
        ruleCategories: restored.settings?.ruleCategories || prev.ruleCategories,
        jobAssignments: restored.settings?.jobAssignments || prev.jobAssignments,
        automation: restored.settings?.automation || prev.automation,
        seatingChart: restored.settings?.seatingChart || prev.seatingChart,
      }))
      localStorage.setItem('ppt_backup_url', backupUrl.trim())
      localStorage.setItem('ppt_backup_token', backupToken.trim())
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
          className,
          teacher: classEntry?.teacher || '',
          students,
          logs: allLogs,
          settings,
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
    if (file.size > 10 * 1024 * 1024) {
      setFileMsg('❌ 檔案過大（上限 10 MB）')
      event.target.value = ''
      return
    }
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
          shop: restored.settings?.shop || (restored.settings?.storeItems ? { ...DEFAULT_SHOP, products: restored.settings.storeItems } : prev.shop),
          currency: resolveCurrency(restored.settings || prev),
          ruleCategories: restored.settings?.ruleCategories || prev.ruleCategories,
          jobAssignments: restored.settings?.jobAssignments || prev.jobAssignments,
          automation: restored.settings?.automation || DEFAULT_AUTOMATION,
          seatingChart: restored.settings?.seatingChart || prev.seatingChart,
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
    const amount = type === 'fine' ? -100 : 100
    setLocalSettings(p => ({
      ...p,
      behaviorRules: [...p.behaviorRules, {
        id: generateId('rule'),
        label: '',
        amount,
        type,
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
      ruleCategories: [...(p.ruleCategories || []), { id: generateId('cat'), name: newCategoryName.trim(), icon: newCategoryIcon || '🏷️' }]
    }))
    setNewCategoryName('')
    setNewCategoryIcon('🏷️')
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

  // --- Shop Product CRUD ---
  const addProduct = () => {
    setLocalSettings(p => ({
      ...p,
      shop: { ...p.shop, products: [...(p.shop?.products || []), { id: generateId('prod'), name: '', icon: '🎁', price: 1, priceUnit: 'cookie', stock: 10 }] }
    }))
  }
  const updateProduct = (prodId, field, value) => {
    setLocalSettings(p => ({
      ...p,
      shop: {
        ...p.shop,
        products: (p.shop?.products || []).map(item => {
          if (item.id !== prodId) return item
          if (field === 'price') return { ...item, price: parseInt(value) || 0 }
          if (field === 'stock') return { ...item, stock: parseInt(value) || 0 }
          return { ...item, [field]: value }
        })
      }
    }))
  }
  const removeProduct = (prodId) => {
    setLocalSettings(p => ({
      ...p,
      shop: { ...p.shop, products: (p.shop?.products || []).filter(item => item.id !== prodId) }
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

    { key: 'shop', label: '商店設定', icon: ShoppingBag },
    { key: 'currency', label: '貨幣設定', icon: Coins },
    { key: 'automation', label: '自動化設定', icon: Zap },
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
              className={`px-4 py-2.5 rounded-t-xl font-bold text-sm transition-colors whitespace-nowrap flex items-center gap-2 border -mb-px ${activeTab === tab.key
                ? 'bg-white text-[#5D5D5D] border-[#E8E8E8] border-b-white'
                : 'text-[#8B8B8B] hover:text-[#5D5D5D] hover:bg-[#F9F9F9] border-transparent'
                }`}
            >
              <tab.icon size={16} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* ===== 自動化設定 ===== */}
          {activeTab === 'automation' && (
            <div className="p-6 space-y-6">
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-[#5D5D5D] flex items-center gap-2">
                  <Zap size={16} className="text-[#FFBF69]" />
                  自動化獎懲與扣分
                </h3>
                <p className="text-xs text-[#8B8B8B]">設定系統自動執行的獎勵與扣分規則</p>
              </div>

              <div className="space-y-4">
                {/* Daily Quest */}
                <div className="p-4 bg-white rounded-xl border border-[#E8E8E8] space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-[#A8D8B9]/20 flex items-center justify-center text-lg">⚔️</div>
                    <div>
                      <h4 className="font-bold text-[#5D5D5D] text-sm">每日任務完成獎勵</h4>
                      <p className="text-xs text-[#8B8B8B]">當日所有任務皆「準時」時自動發放</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pl-10">
                    <span className="text-xs font-bold text-[#4A7C59]">+</span>
                    <input
                      type="number"
                      value={localSettings.automation.dailyQuestBonus}
                      onChange={e => setLocalSettings(p => ({
                        ...p,
                        automation: { ...p.automation, dailyQuestBonus: parseInt(e.target.value) || 0 }
                      }))}
                      className="w-20 px-3 py-2 rounded-lg border border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-sm font-bold text-[#5D5D5D]"
                    />
                    <span className="text-xs text-[#8B8B8B]">pt</span>
                  </div>
                </div>

                {/* Late Penalty */}
                <div className="p-4 bg-white rounded-xl border border-[#E8E8E8] space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-[#FFD6A5]/20 flex items-center justify-center text-lg">🐢</div>
                    <div>
                      <h4 className="font-bold text-[#5D5D5D] text-sm">遲交扣分</h4>
                      <p className="text-xs text-[#8B8B8B]">標記為「遲交」時自動扣除</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pl-10">
                    <span className="text-xs font-bold text-[#8B6914]">-</span>
                    <input
                      type="number"
                      value={Math.abs(localSettings.automation.latePenalty)}
                      onChange={e => setLocalSettings(p => ({
                        ...p,
                        automation: { ...p.automation, latePenalty: -Math.abs(parseInt(e.target.value) || 0) }
                      }))}
                      className="w-20 px-3 py-2 rounded-lg border border-[#E8E8E8] focus:border-[#FFD6A5] outline-none text-sm font-bold text-[#5D5D5D]"
                    />
                    <span className="text-xs text-[#8B8B8B]">pt</span>
                  </div>
                </div>

                {/* Missing Penalty */}
                <div className="p-4 bg-white rounded-xl border border-[#E8E8E8] space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-[#FFADAD]/20 flex items-center justify-center text-lg">⚠️</div>
                    <div>
                      <h4 className="font-bold text-[#5D5D5D] text-sm">缺交扣分</h4>
                      <p className="text-xs text-[#8B8B8B]">標記為「未交」時自動扣除</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pl-10">
                    <span className="text-xs font-bold text-[#D64545]">-</span>
                    <input
                      type="number"
                      value={Math.abs(localSettings.automation.missingPenalty)}
                      onChange={e => setLocalSettings(p => ({
                        ...p,
                        automation: { ...p.automation, missingPenalty: -Math.abs(parseInt(e.target.value) || 0) }
                      }))}
                      className="w-20 px-3 py-2 rounded-lg border border-[#E8E8E8] focus:border-[#FFADAD] outline-none text-sm font-bold text-[#5D5D5D]"
                    />
                    <span className="text-xs text-[#8B8B8B]">pt</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ===== 一般設定 ===== */}
          {activeTab === 'general' && (
            <div className="p-6 space-y-8">
              {/* 村莊基本資訊 */}
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-[#5D5D5D] flex items-center gap-2">
                  <Home size={16} className="text-[#FFD6A5]" />
                  村莊基本資訊
                </h3>
                <div className="grid gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-[#5D5D5D] ml-1">村莊名稱</label>
                    <input
                      type="text"
                      value={villageName}
                      onChange={e => setVillageName(e.target.value)}
                      className="w-full px-4 py-2 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-sm"
                      placeholder="例如：3年級忠班"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-[#5D5D5D] ml-1">村莊別名<span className="text-[#8B8B8B] font-normal ml-1">（選填，若填寫將取代村莊名稱顯示）</span></label>
                    <input
                      type="text"
                      value={villageAlias}
                      onChange={e => setVillageAlias(e.target.value)}
                      className="w-full px-4 py-2 rounded-xl border-2 border-[#E8E8E8] focus:border-[#FFD6A5] outline-none text-sm"
                      placeholder="例如：貓咪班"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-[#5D5D5D] ml-1">村長姓名</label>
                    <input
                      type="text"
                      value={villageTeacher}
                      onChange={e => setVillageTeacher(e.target.value)}
                      className="w-full px-4 py-2 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-sm"
                      placeholder="例如：王老師"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2 p-2 rounded-lg bg-[#F5F5F5] border border-[#E8E8E8]">
                  <span className="text-xs text-[#8B8B8B]">班級代號：</span>
                  <code className="text-xs font-mono text-[#5D5D5D] font-bold select-all">{classId}</code>
                </div>
              </div>

              {/* 任務類型設定 */}
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-[#5D5D5D] flex items-center gap-2">
                  <ClipboardList size={16} className="text-[#A8D8B9]" />
                  任務類型設定
                </h3>
                <div className="flex flex-wrap gap-2">
                  {localSettings.taskTypes.map((type, idx) => (
                    <div key={`taskType-${idx}`} className="flex items-center gap-2 px-3 py-1.5 rounded-xl border-2 bg-gray-100 text-gray-700 border-gray-300">
                      <span className="text-sm font-medium">{type}</span>
                      <button onClick={() => setLocalSettings(p => ({ ...p, taskTypes: p.taskTypes.filter((_, i) => i !== idx) }))}>
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
                    onKeyDown={e => { if (e.key === 'Enter' && newTaskType.trim() && !localSettings.taskTypes.includes(newTaskType.trim())) { setLocalSettings(p => ({ ...p, taskTypes: [...p.taskTypes, newTaskType.trim()] })); setNewTaskType('') } }}
                    className="flex-1 px-4 py-2 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none"
                    placeholder="輸入新任務類型..."
                  />
                  <button
                    onClick={() => { if (newTaskType.trim() && !localSettings.taskTypes.includes(newTaskType.trim())) { setLocalSettings(p => ({ ...p, taskTypes: [...p.taskTypes, newTaskType.trim()] })); setNewTaskType('') } }}
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
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-[#F5F5F5] border border-[#E8E8E8]">
                    <span className="text-xs text-[#8B8B8B]">班級代號：</span>
                    <code className="text-xs font-mono text-[#5D5D5D] font-bold select-all">{classId}</code>
                    <span className="text-[10px] text-[#B8B8B8]">（跨裝置還原時需要此代號）</span>
                  </div>
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
                        type="password"
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

          {/* ===== 職務設定 (v3.7.0: 抽取為獨立元件) ===== */}
          {activeTab === 'jobs' && (
            <JobSettingsTab
              localSettings={localSettings}
              setLocalSettings={setLocalSettings}
              students={students}
              className={className}
              onProcessPayroll={onProcessPayroll}
            />
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
                    <div key={cat.id} className="flex items-center gap-1.5 pl-1 pr-2 py-1 bg-white rounded-lg border border-[#E8E8E8] hover:border-[#A8D8B9] transition-colors">
                      <IconPicker value={cat.icon} onChange={v => updateCategory(cat.id, 'icon', v)} />
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
                <div className="flex gap-2 items-center">
                  <IconPicker value={newCategoryIcon} onChange={setNewCategoryIcon} />
                  <input
                    type="text"
                    value={newCategoryName}
                    onChange={e => setNewCategoryName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addCategory() }}
                    className="flex-1 px-3 py-1.5 rounded-lg border border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-xs"
                    placeholder="新類別名稱..."
                  />
                  <button onClick={addCategory} className="px-3 py-1.5 rounded-lg bg-[#A8D8B9] text-white text-xs font-bold flex items-center gap-1">
                    <Plus size={14} /> 新增
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
                          <div key={rule.id} className="flex items-center gap-2 p-2.5 bg-[#A8D8B9]/10 rounded-xl border border-[#A8D8B9]/30">
                            <span className="text-base shrink-0" title={catName}>{catMeta?.icon || '📋'}</span>
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
                                onFocus={e => e.target.select()}
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
                          <div key={rule.id} className="flex items-center gap-2 p-2.5 bg-[#FFADAD]/10 rounded-xl border border-[#FFADAD]/30">
                            <span className="text-base shrink-0" title={catName}>{catMeta?.icon || '📋'}</span>
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
                                onFocus={e => e.target.select()}
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

          {/* ===== 商店設定 ===== */}
          {activeTab === 'shop' && (
            <div className="p-6 space-y-6">
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-[#5D5D5D] flex items-center gap-2">
                  <ShoppingBag size={16} className="text-[#FF8A8A]" />
                  商店設定
                </h3>
                <p className="text-xs text-[#8B8B8B]">管理商店名稱、圖示與商品上架</p>
              </div>

              {/* Shop Name & Icon */}
              <div className="p-4 bg-[#F9F9F9] rounded-xl border border-[#E8E8E8] space-y-3">
                <div className="text-xs font-bold text-[#5D5D5D]">商店資訊</div>
                <div className="flex items-center gap-3">
                  <IconPicker value={localSettings.shop?.icon || '🐱'} onChange={v => setLocalSettings(p => ({ ...p, shop: { ...p.shop, icon: v } }))} />
                  <input
                    type="text"
                    value={localSettings.shop?.name || ''}
                    onChange={e => setLocalSettings(p => ({ ...p, shop: { ...p.shop, name: e.target.value } }))}
                    className="flex-1 px-3 py-2 rounded-lg border border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-sm font-medium"
                    placeholder="商店名稱"
                  />
                </div>
              </div>

              {/* Product List */}
              <div className="space-y-3">
                <div className="text-xs font-bold text-[#5D5D5D]">商品列表</div>
                {(localSettings.shop?.products || []).length === 0 && (
                  <div className="text-center py-8 text-[#8B8B8B] bg-[#F9F9F9] rounded-xl">
                    <div className="text-4xl mb-2">📦</div>
                    <p className="text-sm">尚無商品，點擊下方按鈕新增</p>
                  </div>
                )}
                {(localSettings.shop?.products || []).map(item => (
                  <div key={item.id} className="flex flex-col gap-1.5 p-3 bg-white rounded-xl border border-[#E8E8E8] hover:border-[#FFD6A5] transition-colors">
                    {/* Row 1: Icon, Name, Stock, Price, Actions */}
                    <div className="flex items-center gap-2">
                      <IconPicker value={item.icon} onChange={v => updateProduct(item.id, 'icon', v)} />

                      <input
                        type="text"
                        value={item.name}
                        onChange={e => updateProduct(item.id, 'name', e.target.value)}
                        className="flex-1 px-2 py-1.5 rounded-lg border border-[#E8E8E8] focus:border-[#FFD6A5] outline-none text-sm font-medium min-w-0"
                        placeholder="商品名稱"
                      />

                      <div className="flex items-center gap-1 shrink-0 bg-[#F9F9F9] rounded-lg p-0.5 border border-[#E8E8E8]">
                        <input
                          type="number"
                          value={item.stock}
                          onChange={e => updateProduct(item.id, 'stock', e.target.value)}
                          onFocus={e => e.target.select()}
                          className="w-12 px-1.5 py-1 rounded-md bg-white border border-transparent focus:border-[#FFD6A5] outline-none text-sm text-center font-bold"
                          min="0"
                          title="庫存數量"
                          placeholder="庫存"
                        />
                        <span className="text-[10px] text-[#B0B0B0] select-none pr-1">個</span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0 bg-[#F9F9F9] rounded-lg p-0.5 border border-[#E8E8E8]">
                        <input
                          type="number"
                          value={item.price}
                          onChange={e => updateProduct(item.id, 'price', e.target.value)}
                          onFocus={e => e.target.select()}
                          className="w-12 px-1.5 py-1 rounded-md bg-white border border-transparent focus:border-[#FFD6A5] outline-none text-sm text-center font-bold"
                          min="0"
                          title="商品價格"
                          placeholder="價格"
                        />
                        <select
                          value={item.priceUnit}
                          onChange={e => updateProduct(item.id, 'priceUnit', e.target.value)}
                          className="w-28 px-1 py-1 rounded-md bg-transparent border-none outline-none text-xs font-medium text-[#5D5D5D] cursor-pointer"
                          title="幣別"
                        >
                          <option value="point">{currency.base.icon} {currency.base.name}</option>
                          <option value="fish">{currency.tier1.icon} {currency.tier1.name}</option>
                          <option value="cookie">{currency.tier2.icon} {currency.tier2.name}</option>
                        </select>
                      </div>

                      <button
                        onClick={() => removeProduct(item.id)}
                        className="p-1.5 rounded-lg hover:bg-[#FFADAD]/20 text-[#8B8B8B] hover:text-[#D64545] transition-colors shrink-0"
                        title="刪除商品"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>

                    {/* Row 2: Description */}
                    <div className="pl-10">
                      <input
                        type="text"
                        value={item.description || ''}
                        onChange={e => updateProduct(item.id, 'description', e.target.value)}
                        className="w-full px-2 py-1 rounded-lg border border-[#E8E8E8]/60 focus:border-[#FFD6A5] outline-none text-xs text-[#8B8B8B] bg-[#FDFDFD]"
                        placeholder="商品描述 (選填，例如：僅限午休時間使用)"
                      />
                    </div>
                  </div>
                ))}

                <button
                  onClick={addProduct}
                  className="w-full py-3 rounded-xl border-2 border-dashed border-[#FFD6A5]/40 text-[#8B6914]/60 font-medium hover:border-[#FFD6A5] hover:text-[#8B6914] transition-colors flex items-center justify-center gap-2"
                >
                  <Plus size={18} /> 新增商品
                </button>
              </div>
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
                <div className="p-4 bg-white rounded-xl border border-[#E8E8E8] space-y-3">
                  <div className="text-xs font-bold text-[#5D5D5D]">基礎單位 (積分)</div>
                  <div className="flex items-center gap-3">
                    <IconPicker
                      value={localSettings.currency.base.icon}
                      onChange={icon => setLocalSettings(p => ({
                        ...p,
                        currency: { ...p.currency, base: { ...p.currency.base, icon } }
                      }))}
                    />
                    <input
                      type="text"
                      value={localSettings.currency.base.name}
                      onChange={e => setLocalSettings(p => ({
                        ...p,
                        currency: { ...p.currency, base: { ...p.currency.base, name: e.target.value } }
                      }))}
                      className="flex-1 px-3 py-2 rounded-lg border border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-sm font-medium"
                      placeholder="請輸入貨幣名稱 (如: 積分)"
                      onFocus={e => e.target.select()}
                    />
                  </div>
                </div>

                <div className="p-4 bg-white rounded-xl border border-[#E8E8E8] space-y-3">
                  <div className="text-xs font-bold text-[#5D5D5D]">第一層貨幣</div>
                  <div className="flex flex-wrap items-center gap-3">
                    <IconPicker
                      value={localSettings.currency.tier1.icon}
                      onChange={icon => setLocalSettings(p => ({
                        ...p,
                        currency: { ...p.currency, tier1: { ...p.currency.tier1, icon } }
                      }))}
                    />
                    <input
                      type="text"
                      value={localSettings.currency.tier1.name}
                      onChange={e => setLocalSettings(p => ({
                        ...p,
                        currency: { ...p.currency, tier1: { ...p.currency.tier1, name: e.target.value } }
                      }))}
                      className="flex-1 min-w-[160px] px-3 py-2 rounded-lg border border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-sm font-medium"
                      placeholder="請輸入貨幣名稱 (如: 小魚乾)"
                      onFocus={e => e.target.select()}
                    />
                    <div className="flex items-center gap-2 text-sm text-[#5D5D5D]">
                      <span>1 {currency.tier1.icon} {currency.tier1.name} =</span>
                      <input
                        type="number"
                        value={localSettings.currency.tier1.rate}
                        onChange={e => setLocalSettings(p => ({
                          ...p,
                          currency: {
                            ...p.currency,
                            tier1: {
                              ...p.currency.tier1,
                              rate: Math.max(1, parseInt(e.target.value, 10) || p.currency.tier1.rate || 1)
                            }
                          }
                        }))}
                        onFocus={e => e.target.select()}
                        className="w-24 px-3 py-2 rounded-lg border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-center font-bold"
                        min="1"
                      />
                      <span>{currency.base.icon} {currency.base.name}</span>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-white rounded-xl border border-[#E8E8E8] space-y-3">
                  <div className="text-xs font-bold text-[#5D5D5D]">第二層貨幣</div>
                  <div className="flex flex-wrap items-center gap-3">
                    <IconPicker
                      value={localSettings.currency.tier2.icon}
                      onChange={icon => setLocalSettings(p => ({
                        ...p,
                        currency: { ...p.currency, tier2: { ...p.currency.tier2, icon } }
                      }))}
                    />
                    <input
                      type="text"
                      value={localSettings.currency.tier2.name}
                      onChange={e => setLocalSettings(p => ({
                        ...p,
                        currency: { ...p.currency, tier2: { ...p.currency.tier2, name: e.target.value } }
                      }))}
                      className="flex-1 min-w-[160px] px-3 py-2 rounded-lg border border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-sm font-medium"
                      placeholder="請輸入貨幣名稱 (如: 貓餅乾)"
                      onFocus={e => e.target.select()}
                    />
                    <div className="flex items-center gap-2 text-sm text-[#5D5D5D]">
                      <span>1 {currency.tier2.icon} {currency.tier2.name} =</span>
                      <input
                        type="number"
                        value={localSettings.currency.tier2.rate}
                        onChange={e => setLocalSettings(p => ({
                          ...p,
                          currency: {
                            ...p.currency,
                            tier2: {
                              ...p.currency.tier2,
                              rate: Math.max(1, parseInt(e.target.value, 10) || p.currency.tier2.rate || 1)
                            }
                          }
                        }))}
                        onFocus={e => e.target.select()}
                        className="w-24 px-3 py-2 rounded-lg border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-center font-bold"
                        min="1"
                      />
                      <span>{currency.base.icon} {currency.base.name}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-[#FFD6A5]/10 rounded-xl border border-[#FFD6A5]/30">
                <div className="text-xs font-bold text-[#8B6914] mb-2">換算預覽</div>
                <div className="text-sm text-[#5D5D5D] space-y-1">
                  <div>
                    6500 {currency.base.icon} {currency.base.name} =
                    {currencyPreview.tier2 > 0 && ` ${currencyPreview.tier2} ${currency.tier2.icon} ${currency.tier2.name}`}
                    {currencyPreview.tier1 > 0 && ` ${currencyPreview.tier1} ${currency.tier1.icon} ${currency.tier1.name}`}
                    {currencyPreview.raw > 0 && ` ${currencyPreview.raw} ${currency.base.icon} ${currency.base.name}`}
                  </div>
                  <div>
                    1 {currency.tier2.icon} {currency.tier2.name} = {Math.round(currency.tier2.rate / currency.tier1.rate)} {currency.tier1.icon} {currency.tier1.name}
                  </div>
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

      </div>
    </div>
  )
}

export default SettingsModal
