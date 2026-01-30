import { useState, useEffect, useCallback, useMemo } from 'react'
import Calendar from 'react-calendar'
import 'react-calendar/dist/Calendar.css'
import { format } from 'date-fns'
import {
  PawPrint,
  BookOpen,
  AlertTriangle,
  AlertCircle,
  CheckCircle,
  X,
  Sparkles,
  Bell,
  WifiOff,
  Loader2,
  ClipboardList,
  Palette,
  ScrollText,
  Heart,
  Star,
  LogOut,
  Users,
  School,
  ChevronRight,
  ChevronLeft,
  Plus,
  Home,
  User,
  Calendar as CalendarIcon,
  Pencil,
  Save,
  XCircle,
  Flag,
  Settings,
  Trash2,
  Trophy,
  Link,
  Download,
  Unplug,
  Eye,
  UserPlus,
  GripVertical,
  Check,
  Clock,
  ListTodo,
  ChevronDown,
  ChevronUp,
  Search,
  Filter,
  Projector
} from 'lucide-react'

// ============================================
// 常數與工具函數
// ============================================

function getTodayStr() {
  return format(new Date(), 'yyyy-MM-dd')
}

function formatDateDisplay(dateStr) {
  return dateStr.replace(/-/g, '/')
}

function parseDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function formatDate(date) {
  return format(date, 'yyyy-MM-dd')
}

const DEFAULT_SETTINGS = { taskTypes: ['作業', '訂正', '攜帶物品', '考試', '通知單', '回條'], groupAliases: {} }

function getClassCacheKey(classId) {
  return `ppt_cache_class_${classId}`
}

function loadClassCache(classId) {
  if (!classId) return null
  try {
    const raw = localStorage.getItem(getClassCacheKey(classId))
    return raw ? JSON.parse(raw) : null
  } catch (err) {
    console.error('讀取本地快取失敗:', err)
    return null
  }
}

function saveClassCache(classId, payload) {
  if (!classId || !payload) return
  try {
    localStorage.setItem(getClassCacheKey(classId), JSON.stringify(payload))
  } catch (err) {
    console.error('寫入本地快取失敗:', err)
  }
}

function getLocalClassesKey() {
  return 'ppt_local_classes'
}

function loadLocalClasses() {
  try {
    const raw = localStorage.getItem(getLocalClassesKey())
    return raw ? JSON.parse(raw) : []
  } catch (err) {
    console.error('讀取本地班級清單失敗:', err)
    return []
  }
}

function saveLocalClasses(classes) {
  try {
    localStorage.setItem(getLocalClassesKey(), JSON.stringify(classes))
  } catch (err) {
    console.error('寫入本地班級清單失敗:', err)
  }
}

function isDoneStatus(value) {
  return value === true || value === 'leave' || value === 'exempt'
}

function getStatusLabel(value) {
  if (value === 'leave') return '請假'
  if (value === 'exempt') return '免交'
  return ''
}

function getTaskIcon(title) {
  const lower = title?.toLowerCase() || ''
  if (lower.includes('習') || lower.includes('作業') || lower.includes('國') || lower.includes('數') || lower.includes('英')) {
    return BookOpen
  }
  if (lower.includes('訂正') || lower.includes('補')) {
    return AlertTriangle
  }
  if (lower.includes('水彩') || lower.includes('美') || lower.includes('畫')) {
    return Palette
  }
  return ScrollText
}

// v2.0 改用 lorelei 風格 - 更可愛的手繪風格頭像
const AVATAR_EMOJIS = ['🐻', '🐱', '🐶', '🐰', '🦊', '🐼', '🐨', '🐯', '🦁', '🐷']
const AVATAR_COLORS = ['#FCE3E3', '#FDEBC8', '#E7F3D7', '#DDF1F8', '#E7E3FA', '#F8E6D8', '#FDE2F3', '#E2F0FF', '#E9F7F1', '#FFF1CC']

function hashSeed(seed) {
  const str = String(seed ?? '')
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0
  }
  return h
}

function makeTaskId(dateStr, task, index) {
  const base = `${dateStr}-${task?.title || ''}-${task?.type || ''}-${index}`
  return `task_${hashSeed(base).toString(36)}`
}

function getAvatarMeta(seed) {
  const hash = hashSeed(seed)
  return {
    emoji: AVATAR_EMOJIS[hash % AVATAR_EMOJIS.length],
    bg: AVATAR_COLORS[hash % AVATAR_COLORS.length]
  }
}

function AvatarEmoji({ seed, className = '', emojiClassName = '' }) {
  const meta = getAvatarMeta(seed)
  return (
    <div
      className={`flex items-center justify-center ${className}`}
      style={{ backgroundColor: meta.bg }}
      aria-hidden="true"
    >
      <span className={emojiClassName}>{meta.emoji}</span>
    </div>
  )
}

function isDefaultName(name, number) {
  if (!name || !number) return false
  try {
    const defaultPattern = new RegExp(`^${number}號村民$`)
    return defaultPattern.test(name) || name === `${number}號村民`
  } catch (err) {
    return false
  }
}

// ============================================
// Loading 畫面元件
// ============================================

function LoadingScreen({ message = '正在前往呼嚕嚕小鎮...' }) {
  return (
    <div className="fixed inset-0 bg-[#fdfbf7] flex flex-col items-center justify-center z-50">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="absolute text-4xl opacity-20"
            style={{
              left: `${15 + i * 15}%`,
              top: `${20 + (i % 3) * 25}%`,
              animation: `float 3s ease-in-out infinite ${i * 0.3}s`
            }}
          >
            🐾
          </div>
        ))}
      </div>

      <div className="relative">
        <div 
          className="text-8xl mb-6"
          style={{ animation: 'catWalk 1s ease-in-out infinite' }}
        >
          🐱
        </div>
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-16 h-3 bg-black/10 rounded-full blur-sm" />
      </div>

      <div className="mt-8 text-center">
        <h2 className="text-2xl font-bold text-[#5D5D5D] mb-2">{message}</h2>
        <p className="text-[#8B8B8B] flex items-center justify-center gap-2">
          <Loader2 size={16} className="animate-spin" />
          載入中
        </p>
      </div>

      <div className="absolute bottom-8 flex items-center gap-2 text-[#A8D8B9]">
        <PawPrint size={20} />
        <span className="text-sm font-medium">Purr Purr Town v2.0.6</span>
        <PawPrint size={20} />
      </div>

    </div>
  )
}

// ============================================
// 歡迎連結頁面 (WelcomeView)
// ============================================

function WelcomeView({ onLocalMode }) {
  return (
    <div className="min-h-screen bg-[#fdfbf7] flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl overflow-hidden border-2 border-white/50">
        <div className="h-3 bg-gradient-to-r from-[#A8D8B9] to-[#FFD6A5]" />
        
        <div className="p-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-[#A8D8B9] mb-4 shadow-lg rotate-3">
              <PawPrint size={40} className="text-white" />
            </div>
            <h1 className="text-3xl font-bold text-[#5D5D5D] mb-2">歡迎來到<br/>呼嚕嚕小鎮</h1>
            <p className="text-[#8B8B8B] text-sm">
              這裡是一個安全、去中心化的班級管理工具。<br/>
              資料以本機為主，雲端備份可選擇性連結。
            </p>
          </div>

          <button
            onClick={onLocalMode}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#A8D8B9] to-[#7BC496] text-white font-bold shadow-md hover:shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2"
          >
            <Sparkles size={20} />
            開始使用（本地模式）
          </button>

          <div className="mt-8 pt-6 border-t border-[#E8E8E8]">
            <h3 className="text-xs font-bold text-[#8B8B8B] mb-3 uppercase tracking-wider text-center">
              關於雲端備份
            </h3>
            <div className="space-y-3">
              <div className="flex items-start gap-3 text-sm text-[#5D5D5D]">
                <div className="w-6 h-6 rounded-full bg-[#FFD6A5] text-white flex items-center justify-center shrink-0 font-bold text-xs">1</div>
                <p>建立一個空的 Google Sheet</p>
              </div>
              <div className="flex items-start gap-3 text-sm text-[#5D5D5D]">
                <div className="w-6 h-6 rounded-full bg-[#FFD6A5] text-white flex items-center justify-center shrink-0 font-bold text-xs">2</div>
                <p>在擴充功能中貼上 Apps Script 並部署</p>
              </div>
              <div className="flex items-start gap-3 text-sm text-[#5D5D5D]">
                <div className="w-6 h-6 rounded-full bg-[#FFD6A5] text-white flex items-center justify-center shrink-0 font-bold text-xs">3</div>
                <p>到「設定 → 備份中心」貼上 GAS 連結</p>
              </div>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-6 text-[#B8B8B8] text-xs">Purr Purr Town v2.0.6 • BYOB Architecture</p>
    </div>
  )
}

// ============================================
// 建立班級 Modal
// ============================================

function CreateClassModal({ onClose, onSuccess, apiUrl, isLocal, onCreateLocalClass }) {
  const [formData, setFormData] = useState({
    year: '',
    className: '',
    teacher: '',
    alias: '',
    studentCount: '30'
  })
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const validateForm = () => {
    const newErrors = {}
    if (!formData.year.trim()) newErrors.year = '請輸入學年度'
    else if (!/^\d+$/.test(formData.year.trim())) newErrors.year = '學年度請輸入數字'
    
    if (!formData.className.trim()) newErrors.className = '請輸入班級名稱'
    if (!formData.teacher.trim()) newErrors.teacher = '請輸入村長姓名'
    
    if (!formData.studentCount.trim()) newErrors.studentCount = '請輸入村民人數'
    else if (!/^\d+$/.test(formData.studentCount.trim())) newErrors.studentCount = '請輸入數字'
    else if (parseInt(formData.studentCount.trim(), 10) < 1 || parseInt(formData.studentCount.trim(), 10) > 50) newErrors.studentCount = '人數需在 1-50 之間'
    
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: null }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validateForm()) return

    try {
      setSubmitting(true)
      setSubmitError(null)

      if (isLocal && onCreateLocalClass) {
        onCreateLocalClass({
          year: formData.year.trim(),
          className: formData.className.trim(),
          teacher: formData.teacher.trim(),
          alias: formData.alias.trim(),
          studentCount: parseInt(formData.studentCount.trim(), 10)
        })
        onSuccess()
        return
      }

      const payload = {
        action: 'create_class',
        year: formData.year.trim(),
        className: formData.className.trim(),
        teacher: formData.teacher.trim(),
        studentCount: parseInt(formData.studentCount.trim(), 10)
      }
      if (formData.alias.trim()) payload.alias = formData.alias.trim()
      
      await fetch(apiUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(payload)
      })

      onSuccess()
    } catch (err) {
      console.error('建立班級失敗:', err)
      setSubmitError('建立失敗，請稍後再試')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative bg-[#fdfbf7] rounded-3xl shadow-2xl max-w-md w-full overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-3" style={{ background: 'repeating-linear-gradient(90deg, #A8D8B9, #A8D8B9 20px, #FFD6A5 20px, #FFD6A5 40px)' }} />
        <button onClick={onClose} disabled={submitting} className="absolute top-6 right-4 p-2 rounded-full bg-white/80 hover:bg-white shadow-md transition-all z-10">
          <X size={20} className="text-[#5D5D5D]" />
        </button>

        <div className="p-6">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4" style={{ background: 'linear-gradient(135deg, #FFD6A5 0%, #FFBF69 100%)' }}>
              <Home size={32} className="text-white" />
            </div>
            <h2 className="text-2xl font-bold text-[#5D5D5D]">建立新村莊</h2>
          </div>

          {submitError && (
            <div className="mb-4 p-3 rounded-xl bg-[#FFADAD]/20 text-[#D64545] text-sm text-center">{submitError}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-[#5D5D5D] mb-2">
                <CalendarIcon size={16} className="text-[#A8D8B9]" />學年度
              </label>
              <input
                type="text"
                value={formData.year}
                onChange={(e) => handleChange('year', e.target.value)}
                placeholder="例如：114"
                disabled={submitting}
                className={`w-full px-4 py-3 rounded-2xl border-2 transition-all outline-none ${errors.year ? 'border-[#FFADAD] bg-[#FFADAD]/5' : 'border-[#E8E8E8] focus:border-[#A8D8B9] bg-white'}`}
              />
              {errors.year && <p className="mt-1 text-xs text-[#D64545]">{errors.year}</p>}
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-[#5D5D5D] mb-2">
                <School size={16} className="text-[#FFD6A5]" />班級名稱
              </label>
              <input
                type="text"
                value={formData.className}
                onChange={(e) => handleChange('className', e.target.value)}
                placeholder="例如：407班"
                disabled={submitting}
                className={`w-full px-4 py-3 rounded-2xl border-2 transition-all outline-none ${errors.className ? 'border-[#FFADAD] bg-[#FFADAD]/5' : 'border-[#E8E8E8] focus:border-[#A8D8B9] bg-white'}`}
              />
              {errors.className && <p className="mt-1 text-xs text-[#D64545]">{errors.className}</p>}
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-[#5D5D5D] mb-2">
                <User size={16} className="text-[#FFADAD]" />村長姓名
              </label>
              <input
                type="text"
                value={formData.teacher}
                onChange={(e) => handleChange('teacher', e.target.value)}
                placeholder="例如：王老師"
                disabled={submitting}
                className={`w-full px-4 py-3 rounded-2xl border-2 transition-all outline-none ${errors.teacher ? 'border-[#FFADAD] bg-[#FFADAD]/5' : 'border-[#E8E8E8] focus:border-[#A8D8B9] bg-white'}`}
              />
              {errors.teacher && <p className="mt-1 text-xs text-[#D64545]">{errors.teacher}</p>}
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-[#5D5D5D] mb-2">
                <Sparkles size={16} className="text-[#FFD6A5]" />村莊別名 <span className="text-xs text-[#8B8B8B] font-normal">(選填)</span>
              </label>
              <input
                type="text"
                value={formData.alias}
                onChange={(e) => handleChange('alias', e.target.value)}
                placeholder="例如：跳跳虎村"
                disabled={submitting}
                className="w-full px-4 py-3 rounded-2xl border-2 transition-all outline-none border-[#E8E8E8] focus:border-[#A8D8B9] bg-white"
              />
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-[#5D5D5D] mb-2">
                <Users size={16} className="text-[#A8D8B9]" />預設村民人數
              </label>
              <input
                type="text"
                value={formData.studentCount}
                onChange={(e) => handleChange('studentCount', e.target.value.replace(/[^\d]/g, ''))}
                placeholder="例如：30"
                disabled={submitting}
                className={`w-full px-4 py-3 rounded-2xl border-2 transition-all outline-none ${errors.studentCount ? 'border-[#FFADAD] bg-[#FFADAD]/5' : 'border-[#E8E8E8] focus:border-[#A8D8B9] bg-white'}`}
              />
              {errors.studentCount && <p className="mt-1 text-xs text-[#D64545]">{errors.studentCount}</p>}
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full mt-6 py-4 rounded-2xl bg-gradient-to-r from-[#A8D8B9] to-[#7BC496] text-white font-bold text-lg shadow-lg hover:shadow-xl active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {submitting ? <><Loader2 size={22} className="animate-spin" />建立中...</> : <><Plus size={22} />建立村莊</>}
            </button>
          </form>
        </div>
        <div className="h-3" style={{ background: 'repeating-linear-gradient(90deg, #FFD6A5, #FFD6A5 20px, #A8D8B9 20px, #A8D8B9 40px)' }} />
      </div>
    </div>
  )
}

// ============================================
// 村莊入口 (Login View)
// ============================================

function LoginView({ onSelectClass, loading, error, apiUrl, onDisconnect, localMode, localClasses, onCreateLocalClass }) {
  const [classes, setClasses] = useState([])
  const [loadingClasses, setLoadingClasses] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)

  const fetchClasses = useCallback(async () => {
    if (!apiUrl) {
      setLoadingClasses(false)
      return
    }

    try {
      setLoadingClasses(true)
      const response = await fetch(`${apiUrl}?action=get_classes`)
      if (!response.ok) throw new Error('Failed to fetch classes')
      const data = await response.json()
      setClasses(data.classes || [])
    } catch (err) {
      console.error('載入班級列表失敗:', err)
    } finally {
      setLoadingClasses(false)
    }
  }, [apiUrl])

  useEffect(() => {
    if (localMode) {
      setClasses(localClasses || [])
      setLoadingClasses(false)
    } else {
      fetchClasses()
    }
  }, [fetchClasses, localMode, localClasses])

  const handleCreateSuccess = () => {
    setShowCreateModal(false)
    if (localMode) {
      setClasses(loadLocalClasses())
    } else {
      fetchClasses()
    }
  }

  if (loadingClasses) {
    return <LoadingScreen message="正在載入村莊列表..." />
  }

  return (
    <div className="min-h-screen bg-[#fdfbf7] flex flex-col">
      {/* Decorative background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -right-32 w-96 h-96 bg-[#A8D8B9]/8 rounded-full" />
        <div className="absolute -bottom-24 -left-24 w-80 h-80 bg-[#FFD6A5]/8 rounded-full" />
        <div className="absolute top-1/3 right-1/4 w-48 h-48 bg-[#FFADAD]/5 rounded-full" />
      </div>

      <div className="flex-1 p-6 md:p-10 relative z-10">
        <div className="max-w-4xl mx-auto">
          {apiUrl && (
            <div className="flex justify-end mb-4">
              <button
                onClick={onDisconnect}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/50 text-[#8B8B8B] hover:bg-[#FFADAD]/20 hover:text-[#D64545] transition-colors text-sm font-medium"
              >
                <Unplug size={16} />
                斷開資料庫連結
              </button>
            </div>
          )}

          {/* Hero */}
          <div className="text-center pt-6 md:pt-10 mb-10">
            <div className="flex items-center justify-center gap-3 mb-3">
              <div className="w-12 h-12 md:w-14 md:h-14 rounded-xl shadow-lg bg-gradient-to-br from-[#A8D8B9] to-[#7BC496] flex items-center justify-center">
                <PawPrint size={28} className="text-white" />
              </div>
              <h1 className="text-3xl md:text-4xl font-bold text-[#5D5D5D]">呼嚕嚕小鎮</h1>
            </div>
            <p className="text-[#8B8B8B]">選擇您要進入的村莊</p>
          </div>

          {error && (
            <div className="mb-6 p-4 rounded-2xl bg-[#FFADAD]/20 text-[#D64545] flex items-center gap-3 justify-center">
              <WifiOff size={20} /><span>{error}</span>
            </div>
          )}

          {classes.length === 0 ? (
            <div className="max-w-sm mx-auto text-center py-16">
              <div className="w-20 h-20 mx-auto rounded-2xl bg-[#FFD6A5]/15 flex items-center justify-center mb-6">
                <Home size={36} className="text-[#FFBF69]" />
              </div>
              <h3 className="text-xl font-bold text-[#5D5D5D] mb-2">還沒有村莊</h3>
              <p className="text-[#8B8B8B] text-sm mb-8">建立你的第一個村莊，開始班級管理之旅吧！</p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-[#A8D8B9] to-[#7BC496] text-white font-bold shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all"
              >
                <Plus size={20} />
                建立新村莊
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {classes.map((cls, index) => {
                const displayName = cls.alias || cls.name || `班級 ${cls.id}`
                const fullClassName = cls.year && cls.name ? `${cls.year}學年 ${cls.name}` : cls.name || ''
                const gradients = ['#A8D8B9, #7BC496', '#FFD6A5, #FFBF69', '#FFADAD, #FF8A8A', '#A0C4FF, #7EB0FF', '#BDB2FF, #9B8FFF']

                return (
                  <button
                    key={cls.id}
                    onClick={() => onSelectClass(cls.id, displayName, cls.alias)}
                    disabled={loading}
                    className="group bg-white rounded-2xl p-5 shadow-md border border-[#F0F0F0] hover:shadow-xl hover:border-[#A8D8B9] transition-all hover:-translate-y-1 disabled:opacity-50 text-left"
                  >
                    <div className="flex items-start gap-4 mb-4">
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform" style={{ background: `linear-gradient(135deg, ${gradients[index % gradients.length]})` }}>
                        <School size={24} className="text-white" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-lg font-bold text-[#5D5D5D] truncate">{displayName}</h3>
                        {cls.alias && fullClassName && <p className="text-[#A8D8B9] text-xs font-medium">{fullClassName}</p>}
                      </div>
                    </div>
                    <p className="text-[#8B8B8B] text-sm mb-4">
                      {cls.teacher && <span>村長：{cls.teacher}</span>}
                      {cls.teacher && cls.studentCount !== undefined && <span> · </span>}
                      {cls.studentCount !== undefined && <span>{cls.studentCount} 位村民</span>}
                    </p>
                    <div className="flex items-center gap-1 text-sm text-[#A8D8B9] font-medium group-hover:gap-2 transition-all">
                      <span>進入村莊</span><ChevronRight size={16} />
                    </div>
                  </button>
                )
              })}

              {/* Add village card */}
              <button
                onClick={() => setShowCreateModal(true)}
                className="group border-2 border-dashed border-[#D8D8D8] rounded-2xl p-5 hover:border-[#A8D8B9] hover:bg-[#A8D8B9]/5 transition-all flex flex-col items-center justify-center min-h-[180px] gap-3"
              >
                <div className="w-12 h-12 rounded-xl bg-[#F0F0F0] group-hover:bg-[#A8D8B9]/20 flex items-center justify-center transition-colors">
                  <Plus size={24} className="text-[#B8B8B8] group-hover:text-[#7BC496] transition-colors" />
                </div>
                <span className="text-sm text-[#8B8B8B] font-medium group-hover:text-[#5D5D5D] transition-colors">建立新村莊</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="text-center py-6 relative z-10">
        <p className="flex items-center justify-center gap-2 text-[#B8B8B8] text-xs">
          <PawPrint size={12} />
          Purr Purr Town v2.0.6
          <PawPrint size={12} />
        </p>
      </footer>

      {showCreateModal && (
        <CreateClassModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={handleCreateSuccess}
          apiUrl={apiUrl}
          isLocal={localMode}
          onCreateLocalClass={onCreateLocalClass}
        />
      )}
    </div>
  )
}

// ============================================
// 小隊管理 Modal (v2.0 - 以小隊為中心的操作邏輯)
// ============================================

function TeamManagementModal({ students, settings, classId, onClose, onSave, apiUrl, onSettingsUpdate }) {
  const defaultGroups = ['A', 'B', 'C', 'D', 'E', 'F']
  
  // 鎖定背景捲軸
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])
  
  // 小隊分配狀態
  const [assignments, setAssignments] = useState(() => {
    const initial = {}
    students.forEach(s => {
      initial[s.id] = s.group || 'A'
    })
    return initial
  })
  
  // 小隊名稱狀態 (本地編輯用)
  const [groupNames, setGroupNames] = useState(() => ({
    ...settings?.groupAliases
  }))
  
  // 當前選中編輯的小隊
  const [editingGroup, setEditingGroup] = useState(null)
  
  // 搜尋詞 (用於添加成員時)
  const [searchTerm, setSearchTerm] = useState('')
  
  // 儲存狀態
  const [saving, setSaving] = useState(false)

  // 依小隊分組的學生
  const groupedStudents = useMemo(() => {
    const groups = {}
    defaultGroups.forEach(g => groups[g] = [])
    students.forEach(s => {
      const g = assignments[s.id] || 'A'
      if (groups[g]) groups[g].push(s)
    })
    // 按座號排序
    Object.keys(groups).forEach(g => {
      groups[g].sort((a, b) => (a.number || 0) - (b.number || 0))
    })
    return groups
  }, [students, assignments])

  // 不在當前編輯小隊的學生 (可添加的成員)
  const availableStudents = useMemo(() => {
    if (!editingGroup) return []
    return students
      .filter(s => assignments[s.id] !== editingGroup)
      .filter(s => {
        if (!searchTerm) return true
        return s.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
               String(s.number).includes(searchTerm)
      })
      .sort((a, b) => (a.number || 0) - (b.number || 0))
  }, [students, assignments, editingGroup, searchTerm])

  // 獲取小隊顯示名稱
  const getGroupDisplayName = (group) => {
    return groupNames[group] || settings?.groupAliases?.[group] || `${group} 小隊`
  }

  // 將學生加入當前編輯的小隊
  const handleAddToGroup = (studentId) => {
    if (!editingGroup) return
    setAssignments(prev => ({ ...prev, [studentId]: editingGroup }))
  }

  // 將學生從當前小隊移除 (移到 A 隊作為預設)
  const handleRemoveFromGroup = (studentId) => {
    // 移到下一個小隊，如果是最後一個則移到第一個
    const currentGroup = assignments[studentId]
    const currentIdx = defaultGroups.indexOf(currentGroup)
    const nextGroup = defaultGroups[(currentIdx + 1) % defaultGroups.length]
    setAssignments(prev => ({ ...prev, [studentId]: nextGroup }))
  }

  // 更新小隊名稱
  const handleGroupNameChange = (group, name) => {
    setGroupNames(prev => ({ ...prev, [group]: name }))
  }

  // 儲存所有變更
  const handleSave = async () => {
    try {
      setSaving(true)
      
      // 1. 逐一更新學生小隊（後端未支援 batch_update_groups）
      if (apiUrl) {
        const updateRequests = students.map(s => {
          const uuid = s.uuid || s.id
          return fetch(apiUrl, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
              action: 'update_student',
              classId,
              uuid,
              name: s.name,
              group: assignments[s.id],
              gender: s.gender || 'neutral'
            })
          })
        })
        await Promise.all(updateRequests)
      }

      // 2. 更新小隊名稱設定
      const newSettings = {
        ...settings,
        groupAliases: { ...settings?.groupAliases, ...groupNames }
      }
      
      if (apiUrl) {
        await fetch(apiUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ 
            action: 'save_settings', 
            classId, 
            settings: newSettings 
          })
        })
      }

      // 回傳更新
      onSave(assignments)
      if (onSettingsUpdate) {
        onSettingsUpdate(newSettings)
      }
      onClose()
    } catch (err) {
      console.error('儲存小隊失敗:', err)
    } finally {
      setSaving(false)
    }
  }

  // 小隊卡片顏色
  const groupColors = {
    A: { bg: 'from-[#A8D8B9] to-[#7BC496]', light: 'bg-[#A8D8B9]/20', border: 'border-[#A8D8B9]' },
    B: { bg: 'from-[#FFD6A5] to-[#FFBF69]', light: 'bg-[#FFD6A5]/20', border: 'border-[#FFD6A5]' },
    C: { bg: 'from-[#FFADAD] to-[#FF8A8A]', light: 'bg-[#FFADAD]/20', border: 'border-[#FFADAD]' },
    D: { bg: 'from-[#A0C4FF] to-[#7EB0FF]', light: 'bg-[#A0C4FF]/20', border: 'border-[#A0C4FF]' },
    E: { bg: 'from-[#BDB2FF] to-[#9B8FFF]', light: 'bg-[#BDB2FF]/20', border: 'border-[#BDB2FF]' },
    F: { bg: 'from-[#FDFFB6] to-[#E8EB9C]', light: 'bg-[#FDFFB6]/20', border: 'border-[#FDFFB6]' },
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#fdfbf7] rounded-3xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="h-3 bg-gradient-to-r from-[#FFD6A5] to-[#FF8A8A]" />
        
        {/* Header */}
        <div className="p-6 border-b border-[#E8E8E8] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#FFD6A5] to-[#FF8A8A] flex items-center justify-center">
              <Flag size={24} className="text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-[#5D5D5D]">小隊管理</h2>
              <p className="text-sm text-[#8B8B8B]">
                {editingGroup 
                  ? `正在編輯：${getGroupDisplayName(editingGroup)}` 
                  : '點選小隊卡片進行編輯'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {editingGroup && (
              <button 
                onClick={() => { setEditingGroup(null); setSearchTerm('') }}
                className="px-4 py-2 rounded-xl bg-[#E8E8E8] text-[#5D5D5D] font-medium hover:bg-[#D8D8D8] transition-colors flex items-center gap-2"
              >
                <ChevronLeft size={18} />
                返回列表
              </button>
            )}
            <button onClick={onClose} className="p-2 rounded-full hover:bg-[#E8E8E8] transition-colors">
              <X size={24} className="text-[#5D5D5D]" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 flex flex-col">
          {!editingGroup ? (
            /* 小隊列表視圖 */
            <div className="p-6 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {defaultGroups.map(group => {
                  const colors = groupColors[group]
                  const members = groupedStudents[group] || []
                  
                  return (
                    <div
                      key={group}
                      onClick={() => setEditingGroup(group)}
                      className={`bg-white rounded-2xl p-5 shadow-md border-2 border-transparent hover:border-[#FFD6A5] cursor-pointer transition-all hover:shadow-lg hover:-translate-y-1 group`}
                    >
                      {/* 小隊標題 */}
                      <div className="flex items-center gap-3 mb-4">
                        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${colors.bg} flex items-center justify-center shadow-md group-hover:scale-110 transition-transform`}>
                          <span className="text-white font-bold text-xl">{group}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-bold text-[#5D5D5D] truncate">
                            {getGroupDisplayName(group)}
                          </h3>
                          <p className="text-sm text-[#8B8B8B]">{members.length} 位成員</p>
                        </div>
                        <ChevronRight size={20} className="text-[#B8B8B8] group-hover:text-[#FFD6A5] transition-colors" />
                      </div>
                      
                      {/* 成員預覽 */}
                      <div className="flex flex-wrap gap-1.5">
                        {members.slice(0, 8).map(s => (
                          <div
                            key={s.id}
                            className="w-8 h-8 rounded-full overflow-hidden border-2 border-white shadow-sm"
                            title={`${s.number}. ${s.name}`}
                          >
                            <AvatarEmoji seed={s.uuid || s.id} className="w-full h-full rounded-full text-sm" />
                          </div>
                        ))}
                        {members.length > 8 && (
                          <div className="w-8 h-8 rounded-full bg-[#E8E8E8] flex items-center justify-center text-xs font-medium text-[#5D5D5D]">
                            +{members.length - 8}
                          </div>
                        )}
                        {members.length === 0 && (
                          <span className="text-sm text-[#B8B8B8] italic">尚無成員</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            /* 小隊編輯視圖 */
            <div className="flex flex-1 min-h-0">
              {/* 左側：當前小隊成員 */}
              <div className="w-1/2 border-r border-[#E8E8E8] p-5 flex flex-col min-h-0">
                {/* 小隊名稱編輯 */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-[#5D5D5D] mb-2">
                    小隊名稱
                  </label>
                  <div className="flex gap-2">
                    <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${groupColors[editingGroup].bg} flex items-center justify-center shadow-md shrink-0`}>
                      <span className="text-white font-bold text-xl">{editingGroup}</span>
                    </div>
                    <input
                      type="text"
                      value={groupNames[editingGroup] || ''}
                      onChange={(e) => handleGroupNameChange(editingGroup, e.target.value)}
                      placeholder={`${editingGroup} 小隊`}
                      className="flex-1 px-4 py-2 rounded-xl border-2 border-[#E8E8E8] focus:border-[#FFD6A5] outline-none text-lg font-medium"
                    />
                  </div>
                </div>

                {/* 當前成員列表 */}
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-[#5D5D5D] flex items-center gap-2">
                    <Users size={18} className="text-[#A8D8B9]" />
                    目前成員
                  </h3>
                  <span className="text-sm px-3 py-1 rounded-full bg-[#E8E8E8] text-[#5D5D5D]">
                    {groupedStudents[editingGroup]?.length || 0} 人
                  </span>
                </div>
                
                <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1" style={{ scrollbarWidth: 'thin', overscrollBehavior: 'contain' }}>
                  {groupedStudents[editingGroup]?.length === 0 ? (
                    <div className="text-center py-8 bg-[#F9F9F9] rounded-xl">
                      <div className="text-4xl mb-2">🏠</div>
                      <p className="text-[#8B8B8B]">這個小隊還沒有成員</p>
                      <p className="text-sm text-[#B8B8B8]">從右側添加村民</p>
                    </div>
                  ) : (
                    groupedStudents[editingGroup]?.map(student => (
                      <div
                        key={student.id}
                        className={`flex items-center gap-3 p-3 rounded-xl bg-white border-2 ${groupColors[editingGroup].border} shadow-sm group`}
                      >
                        <div className="w-10 h-10 rounded-xl overflow-hidden shadow-sm">
                          <AvatarEmoji seed={student.uuid || student.id} className="w-full h-full rounded-xl text-lg" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-[#5D5D5D]">{student.number}. {student.name}</div>
                        </div>
                        <button
                          onClick={() => handleRemoveFromGroup(student.id)}
                          className="p-2 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-[#FFADAD]/20 transition-all"
                          title="移出小隊"
                        >
                          <X size={18} className="text-[#D64545]" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* 右側：可添加的成員 */}
              <div className="w-1/2 p-5 flex flex-col bg-[#F9F9F9] min-h-0">
                <div className="mb-4">
                  <label className="block text-sm font-medium text-[#5D5D5D] mb-2">
                    添加成員
                  </label>
                  <div className="relative">
                    <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#B8B8B8]" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="搜尋村民姓名或座號..."
                      className="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none bg-white"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-[#5D5D5D] flex items-center gap-2">
                    <UserPlus size={18} className="text-[#FFD6A5]" />
                    從其他小隊移入
                  </h3>
                  <span className="text-xs text-[#8B8B8B]">
                    點擊移入 {getGroupDisplayName(editingGroup)}
                  </span>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1" style={{ scrollbarWidth: 'thin', overscrollBehavior: 'contain' }}>
                  {availableStudents.length === 0 ? (
                    <div className="text-center py-8">
                      <div className="text-4xl mb-2">🎉</div>
                      <p className="text-[#8B8B8B]">
                        {searchTerm ? '找不到符合的村民' : '所有村民都已在此小隊中'}
                      </p>
                    </div>
                  ) : (
                    availableStudents.map(student => {
                      const currentGroup = assignments[student.id]
                      const currentColors = groupColors[currentGroup]
                      
                      return (
                        <div
                          key={student.id}
                          onClick={() => handleAddToGroup(student.id)}
                          className="flex items-center gap-3 p-3 rounded-xl bg-white border-2 border-transparent hover:border-[#A8D8B9] cursor-pointer transition-all hover:shadow-md group"
                        >
                          <div className="w-10 h-10 rounded-xl overflow-hidden shadow-sm">
                            <AvatarEmoji seed={student.uuid || student.id} className="w-full h-full rounded-xl text-lg" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-[#5D5D5D]">{student.number}. {student.name}</div>
                            <div className="flex items-center gap-1 text-xs text-[#8B8B8B]">
                              <span>目前在</span>
                              <span className={`px-1.5 py-0.5 rounded ${currentColors.light} font-medium`}>
                                {getGroupDisplayName(currentGroup)}
                              </span>
                            </div>
                          </div>
                          <div className="p-2 rounded-lg bg-[#A8D8B9]/0 group-hover:bg-[#A8D8B9]/20 transition-all">
                            <Plus size={18} className="text-[#7BC496]" />
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#E8E8E8] flex justify-between items-center">
          <div className="text-sm text-[#8B8B8B]">
            {editingGroup 
              ? '修改完成後請點擊「儲存變更」' 
              : '選擇要編輯的小隊，或直接儲存當前設定'}
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-6 py-2.5 rounded-xl bg-[#E8E8E8] text-[#5D5D5D] font-medium hover:bg-[#D8D8D8] transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#FFD6A5] to-[#FF8A8A] text-white font-medium shadow-md hover:shadow-lg transition-all flex items-center gap-2"
            >
              {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
              儲存變更
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================
// 任務總覽 Modal (新功能)
// ============================================

function TaskOverviewModal({ allLogs, students, classId, onClose, onNavigateToDate, settings, onToggleStatus }) {
  const [expandedTask, setExpandedTask] = useState(null)
  const [filterType, setFilterType] = useState('all')
  const [batchTaskKey, setBatchTaskKey] = useState(null)
  const [batchSelected, setBatchSelected] = useState({})
  
  // 整理所有任務資料
  const allTasks = useMemo(() => {
    const tasks = []
    allLogs.forEach(log => {
      const logTasks = log.tasks || []
      const logStatus = log.status || {}
      
      logTasks.forEach(task => {
        const completedStudents = students.filter(s => isDoneStatus(logStatus[s.id]?.[task.id]))
        const incompleteStudents = students.filter(s => !isDoneStatus(logStatus[s.id]?.[task.id]))
        
        tasks.push({
          ...task,
          date: log.date,
          completedCount: completedStudents.length,
          incompleteCount: incompleteStudents.length,
          totalCount: students.length,
          completedStudents,
          incompleteStudents,
          isComplete: incompleteStudents.length === 0
        })
      })
    })
    
    // 未完成排前面，再按日期排序（最新在前）
    return tasks.sort((a, b) => {
      if (a.isComplete !== b.isComplete) return a.isComplete ? 1 : -1
      return new Date(b.date) - new Date(a.date)
    })
  }, [allLogs, students])

  const filteredTasks = useMemo(() => {
    if (filterType === 'all') return allTasks
    if (filterType === 'incomplete') return allTasks.filter(t => !t.isComplete)
    if (filterType === 'complete') return allTasks.filter(t => t.isComplete)
    return allTasks.filter(t => t.type === filterType)
  }, [allTasks, filterType])

  const taskTypes = useMemo(() => {
    const types = new Set()
    allTasks.forEach(t => t.type && types.add(t.type))
    return Array.from(types)
  }, [allTasks])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#fdfbf7] rounded-3xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="h-3 bg-gradient-to-r from-[#A8D8B9] to-[#7BC496]" />
        
        {/* Header */}
        <div className="p-6 border-b border-[#E8E8E8] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#A8D8B9] to-[#7BC496] flex items-center justify-center">
              <ListTodo size={24} className="text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-[#5D5D5D]">任務總覽</h2>
              <p className="text-sm text-[#8B8B8B]">檢視所有任務的完成狀況</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-[#E8E8E8] transition-colors">
            <X size={24} className="text-[#5D5D5D]" />
          </button>
        </div>

        {/* Filter */}
        <div className="px-6 py-4 border-b border-[#E8E8E8] flex items-center gap-3 overflow-x-auto">
          <Filter size={18} className="text-[#8B8B8B] shrink-0" />
          <button
            onClick={() => setFilterType('all')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
              filterType === 'all' ? 'bg-[#A8D8B9] text-white' : 'bg-[#E8E8E8] text-[#5D5D5D]'
            }`}
          >
            全部 ({allTasks.length})
          </button>
          <button
            onClick={() => setFilterType('incomplete')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
              filterType === 'incomplete' ? 'bg-[#FFADAD] text-white' : 'bg-[#E8E8E8] text-[#5D5D5D]'
            }`}
          >
            未完成 ({allTasks.filter(t => !t.isComplete).length})
          </button>
          <button
            onClick={() => setFilterType('complete')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
              filterType === 'complete' ? 'bg-[#7BC496] text-white' : 'bg-[#E8E8E8] text-[#5D5D5D]'
            }`}
          >
            已完成 ({allTasks.filter(t => t.isComplete).length})
          </button>
          {taskTypes.map(type => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                filterType === type ? 'bg-[#FFD6A5] text-white' : 'bg-[#E8E8E8] text-[#5D5D5D]'
              }`}
            >
              {type}
            </button>
          ))}
        </div>

        {/* Task List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {filteredTasks.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-5xl mb-4">📭</div>
              <p className="text-[#8B8B8B]">沒有符合條件的任務</p>
            </div>
          ) : (
            filteredTasks.map((task, idx) => {
              const isExpanded = expandedTask === `${task.date}-${task.id}`
              const IconComponent = getTaskIcon(task.title)
              
              return (
                <div key={`${task.date}-${task.id}-${idx}`} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                  <div
                    className="p-4 cursor-pointer hover:bg-[#F9F9F9] transition-colors"
                    onClick={() => setExpandedTask(isExpanded ? null : `${task.date}-${task.id}`)}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                        task.isComplete ? 'bg-[#A8D8B9]' : 'bg-[#FFD6A5]'
                      }`}>
                        <IconComponent size={24} className="text-white" />
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-[#E8E8E8] text-[#5D5D5D]">
                            {formatDateDisplay(task.date)}
                          </span>
                          {task.type && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-[#FFD6A5]/30 text-[#8B6914]">
                              {task.type}
                            </span>
                          )}
                        </div>
                        <h4 className="font-bold text-[#5D5D5D] truncate">{task.title}</h4>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className={`text-lg font-bold ${task.isComplete ? 'text-[#7BC496]' : 'text-[#FF8A8A]'}`}>
                            {task.completedCount}/{task.totalCount}
                          </div>
                          <div className="text-xs text-[#8B8B8B]">
                            {task.isComplete ? '✅ 全員完成' : `⏳ 剩餘 ${task.incompleteCount} 人`}
                          </div>
                        </div>
                        <div className={`p-2 rounded-full transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                          <ChevronDown size={20} className="text-[#8B8B8B]" />
                        </div>
                      </div>
                    </div>
                    
                    {/* Progress Bar */}
                    <div className="mt-3 h-2 bg-[#E8E8E8] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${(task.completedCount / task.totalCount) * 100}%`,
                          background: task.isComplete
                            ? 'linear-gradient(90deg, #A8D8B9, #7BC496)'
                            : 'linear-gradient(90deg, #FFD6A5, #FFBF69)'
                        }}
                      />
                    </div>
                  </div>

                  {/* Expanded Detail */}
                  {isExpanded && (() => {
                    const taskKey = `${task.date}-${task.id}`
                    const isBatchMode = batchTaskKey === taskKey
                    return (
                    <div className="px-4 pb-4 border-t border-[#E8E8E8]">
                      {task.incompleteCount > 0 && (
                        <div className="mt-4">
                          <div className="flex items-center justify-between mb-2">
                            <h5 className="text-sm font-bold text-[#D64545] flex items-center gap-2">
                              <AlertCircle size={16} />
                              未完成 ({task.incompleteCount})
                            </h5>
                            {onToggleStatus && !isBatchMode && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setBatchTaskKey(taskKey); setBatchSelected({}) }}
                                className="px-3 py-1 rounded-lg bg-[#FFD6A5] text-white text-xs font-medium hover:bg-[#FFBF69] transition-colors flex items-center gap-1"
                              >
                                <CheckCircle size={14} />
                                批次完成
                              </button>
                            )}
                            {isBatchMode && (
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    const allSelected = task.incompleteStudents.every(s => batchSelected[s.id])
                                    const next = {}
                                    task.incompleteStudents.forEach(s => { next[s.id] = !allSelected })
                                    setBatchSelected(next)
                                  }}
                                  className="px-2 py-1 rounded-lg bg-[#E8E8E8] text-[#5D5D5D] text-xs font-medium hover:bg-[#D8D8D8] transition-colors"
                                >
                                  {task.incompleteStudents.every(s => batchSelected[s.id]) ? '取消全選' : '全選'}
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    const selected = Object.entries(batchSelected).filter(([, v]) => v).map(([id]) => id)
                                    selected.forEach(studentId => onToggleStatus(studentId, task.id, true, task.date))
                                    setBatchTaskKey(null)
                                    setBatchSelected({})
                                  }}
                                  disabled={!Object.values(batchSelected).some(v => v)}
                                  className="px-3 py-1 rounded-lg bg-[#7BC496] text-white text-xs font-medium hover:bg-[#5DAF7E] transition-colors disabled:opacity-40 flex items-center gap-1"
                                >
                                  <Check size={14} />
                                  確認完成
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setBatchTaskKey(null); setBatchSelected({}) }}
                                  className="px-2 py-1 rounded-lg bg-[#FFADAD] text-white text-xs font-medium hover:bg-[#FF8A8A] transition-colors"
                                >
                                  取消
                                </button>
                              </div>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {task.incompleteStudents.map(s => (
                              <div
                                key={s.id}
                                onClick={isBatchMode ? (e) => { e.stopPropagation(); setBatchSelected(prev => ({ ...prev, [s.id]: !prev[s.id] })) } : undefined}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border transition-all ${
                                  isBatchMode
                                    ? batchSelected[s.id]
                                      ? 'bg-[#7BC496]/20 border-[#7BC496] cursor-pointer'
                                      : 'bg-[#FFADAD]/20 border-[#FFADAD]/30 cursor-pointer hover:border-[#7BC496]/50'
                                    : 'bg-[#FFADAD]/20 border-[#FFADAD]/30'
                                }`}
                              >
                                {isBatchMode && (
                                  <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${
                                    batchSelected[s.id] ? 'bg-[#7BC496] border-[#7BC496]' : 'border-[#D8D8D8]'
                                  }`}>
                                    {batchSelected[s.id] && <Check size={10} className="text-white" />}
                                  </div>
                                )}
                                <div className="w-6 h-6 rounded-full overflow-hidden">
                                  <AvatarEmoji seed={s.uuid || s.id} className="w-full h-full rounded-full text-xs" />
                                </div>
                                <span className="text-[#D64545] font-medium">{s.number}. {s.name}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {task.completedCount > 0 && (
                        <div className="mt-4">
                          <h5 className="text-sm font-bold text-[#7BC496] mb-2 flex items-center gap-2">
                            <CheckCircle size={16} />
                            已完成 ({task.completedCount})
                          </h5>
                          <div className="flex flex-wrap gap-2">
                            {task.completedStudents.map(s => (
                              <div
                                key={s.id}
                                className="flex items-center gap-2 px-3 py-1.5 bg-[#A8D8B9]/20 rounded-lg text-sm border border-[#A8D8B9]/30"
                              >
                                <div className="w-6 h-6 rounded-full overflow-hidden">
                                  <AvatarEmoji seed={s.uuid || s.id} className="w-full h-full rounded-full text-xs" />
                                </div>
                                <span className="text-[#5D5D5D]">{s.number}. {s.name}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <button
                        onClick={() => { onNavigateToDate(parseDate(task.date)); onClose() }}
                        className="mt-4 w-full py-2 rounded-xl border-2 border-[#A8D8B9] text-[#A8D8B9] font-medium hover:bg-[#A8D8B9] hover:text-white transition-all flex items-center justify-center gap-2"
                      >
                        <CalendarIcon size={18} />
                        前往該日期
                      </button>
                    </div>
                    )
                  })()}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================
// 日曆導航
// ============================================

function CalendarNav({ currentDate, onDateChange }) {
  const todayStr = getTodayStr()
  const isToday = formatDate(currentDate) === todayStr

  return (
    <div className="react-calendar-container space-y-3">
      <Calendar
        onChange={onDateChange}
        value={currentDate}
        className="!border-0 !bg-transparent w-full"
        tileClassName={({ date, view }) => {
          if (view === 'month') {
            const dateStr = formatDate(date)
            if (dateStr === todayStr) return 'react-calendar__tile--today'
          }
          return ''
        }}
        formatDay={(locale, date) => format(date, 'd')}
        formatMonthYear={(locale, date) => format(date, 'yyyy年 M月')}
        navigationLabel={({ date }) => format(date, 'yyyy年 M月')}
        next2Label={null}
        prev2Label={null}
      />
      {!isToday && (
        <button
          onClick={() => onDateChange(new Date())}
          className="w-full py-2 rounded-xl border-2 border-[#A8D8B9] text-[#A8D8B9] font-medium text-sm hover:bg-[#A8D8B9] hover:text-white transition-all flex items-center justify-center gap-2"
        >
          📅 回到今天
        </button>
      )}
    </div>
  )
}

// ============================================
// 任務板
// ============================================

function TaskBoard({ tasks, students, studentStatus, classId, currentDateStr, onTasksUpdate, taskTypes, apiUrl, onOpenFocus }) {
  const [showAddTask, setShowAddTask] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskType, setNewTaskType] = useState(taskTypes?.[0] || '作業')

  const handleAddTask = async () => {
    if (!newTaskTitle.trim()) return
    const newTask = { id: `task_${Date.now()}`, title: newTaskTitle.trim(), type: newTaskType }
    const updatedTasks = [...tasks, newTask]
    
    if (onTasksUpdate) onTasksUpdate(updatedTasks)

    if (apiUrl) {
      fetch(apiUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'save_tasks', classId, date: currentDateStr, tasks: updatedTasks })
      }).catch(err => console.error('發布任務失敗:', err))
    }

    setNewTaskTitle('')
    setNewTaskType(taskTypes?.[0] || '作業')
    setShowAddTask(false)
  }

  const handleDeleteTask = (taskId) => {
    const updatedTasks = tasks.filter(t => t.id !== taskId)
    if (onTasksUpdate) onTasksUpdate(updatedTasks)
    
    if (apiUrl) {
      fetch(apiUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'save_tasks', classId, date: currentDateStr, tasks: updatedTasks })
      }).catch(err => console.error('刪除任務失敗:', err))
    }
  }

  const getTaskCompletion = (taskId) => {
    const completed = students.filter(s => isDoneStatus(studentStatus[s.id]?.[taskId])).length
    return { completed, total: students.length }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-[#5D5D5D] flex items-center gap-2">
          <ClipboardList size={20} className="text-[#A8D8B9]" />今日任務
        </h2>
        <button
          onClick={onOpenFocus}
          className="px-3 py-2 rounded-xl bg-[#1f3327] text-[#E8F5E9] text-sm font-bold shadow-md transition-all duration-200 flex items-center gap-2 hover:-translate-y-0.5 hover:scale-[1.02] hover:shadow-xl hover:bg-[#2a4634] active:scale-[0.99]"
          title="投影模式"
        >
          <Projector size={16} />
          投影模式
        </button>
      </div>
      
      <div className="rounded-2xl p-4 shadow-md relative overflow-hidden bg-[#F5E6D3] border-4 border-[#8B7355]">
        {!showAddTask && (
          <button
            onClick={() => setShowAddTask(true)}
            className="w-full mb-4 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#A8D8B9] text-white font-medium hover:bg-[#7BC496] transition-all shadow-md"
          >
            <Plus size={18} />發布新任務
          </button>
        )}

        {showAddTask && (
          <div className="mb-4 p-4 bg-white rounded-2xl shadow-md space-y-3">
            <input
              type="text"
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleAddTask()}
              placeholder="輸入任務名稱..."
              className="w-full px-4 py-2.5 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-[#5D5D5D]"
              autoFocus
            />
            <select
              value={newTaskType}
              onChange={(e) => setNewTaskType(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none bg-white text-[#5D5D5D]"
            >
              {taskTypes?.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
            <div className="flex gap-2">
              <button onClick={handleAddTask} className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#A8D8B9] to-[#7BC496] text-white font-medium">發布</button>
              <button onClick={() => setShowAddTask(false)} className="px-4 py-2.5 rounded-xl bg-[#E8E8E8] text-[#5D5D5D] font-medium">取消</button>
            </div>
          </div>
        )}

        {tasks.length === 0 ? (
          <div className="text-center py-8 bg-white/50 rounded-2xl">
            <div className="text-4xl mb-3">😸</div>
            <p className="text-[#6B5344] font-medium">今日暫無任務</p>
          </div>
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => {
              const IconComponent = getTaskIcon(task.title)
              const { completed, total } = getTaskCompletion(task.id)
              const isAllDone = completed === total && total > 0
              const percentage = total > 0 ? Math.round((completed / total) * 100) : 0

              return (
                <div key={task.id} className="bg-white rounded-xl p-3 shadow-sm group">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${isAllDone ? 'bg-[#A8D8B9]' : 'bg-[#FFD6A5]'}`}>
                      <IconComponent size={20} className="text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className={`font-medium text-[#5D5D5D] text-sm ${isAllDone ? 'line-through opacity-60' : ''}`}>{task.title}</h4>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 h-1.5 bg-[#E8E8E8] rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${percentage}%`,
                              backgroundColor: isAllDone ? '#A8D8B9' : '#FFD6A5'
                            }}
                          />
                        </div>
                        <span className="text-xs text-[#8B8B8B] whitespace-nowrap">{completed}/{total}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteTask(task.id)}
                      className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-[#FFADAD]/20 transition-all"
                    >
                      <Trash2 size={16} className="text-[#D64545]" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================
// 投影模式 (Focus View)
// ============================================

function FocusView({ tasks, currentDateStr, onClose }) {
  const [checked, setChecked] = useState({})

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const toggleTask = (taskId) => {
    setChecked(prev => ({ ...prev, [taskId]: !prev[taskId] }))
  }

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 focus-overlay" />
      <div className="absolute inset-0 px-6 md:px-12 py-8 md:py-12 flex flex-col">
        <div className="flex items-start justify-between gap-4">
          <div className="text-[#E8F5E9] font-chalk text-4xl md:text-6xl lg:text-7xl tracking-wide">
            {formatDateDisplay(currentDateStr)}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-[#E8F5E9] text-[#1f3327] font-bold text-lg shadow-lg hover:scale-105 transition-transform"
          >
            ❌ 關閉
          </button>
        </div>

        <div className="mt-8 flex-1 overflow-y-auto">
          {tasks.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-[#E8F5E9]">
              <div className="text-6xl md:text-8xl mb-6">🐾</div>
              <div className="font-chalk text-3xl md:text-5xl text-center">今日無作業，放學囉！</div>
            </div>
          ) : (
            <div className="space-y-4 md:space-y-6">
              {tasks.map(task => {
                const isChecked = !!checked[task.id]
                return (
                  <button
                    key={task.id}
                    onClick={() => toggleTask(task.id)}
                    className="w-full flex items-center gap-4 md:gap-6 text-left"
                  >
                    <span className={`focus-checkbox ${isChecked ? 'is-checked' : ''}`} />
                    <span className={`font-chalk text-3xl md:text-5xl lg:text-6xl text-[#E8F5E9] ${isChecked ? 'focus-strike' : ''}`}>
                      {task.title}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

    </div>
  )
}

// ============================================
// 課堂法寶 (Gadgets)
// ============================================

function GadgetsModal({ students, onClose }) {
  const [activeTab, setActiveTab] = useState('timer')
  const [duration, setDuration] = useState(180)
  const [remaining, setRemaining] = useState(0)
  const [running, setRunning] = useState(false)
  const [timeUp, setTimeUp] = useState(false)
  const [drawRunning, setDrawRunning] = useState(false)
  const [drawIndex, setDrawIndex] = useState(0)
  const [winner, setWinner] = useState(null)

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      setRemaining(prev => {
        if (prev <= 1) {
          clearInterval(id)
          setRunning(false)
          setTimeUp(true)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [running])

  useEffect(() => {
    if (!drawRunning) return
    const id = setInterval(() => {
      setDrawIndex(prev => (students.length ? (prev + 1) % students.length : 0))
    }, 80)
    const stopId = setTimeout(() => {
      clearInterval(id)
      setDrawRunning(false)
      if (students.length) {
        const finalIndex = Math.floor(Math.random() * students.length)
        setDrawIndex(finalIndex)
        setWinner(students[finalIndex])
      }
    }, 3000)
    return () => {
      clearInterval(id)
      clearTimeout(stopId)
    }
  }, [drawRunning, students])

  const startTimer = (seconds) => {
    setDuration(seconds)
    setRemaining(seconds)
    setTimeUp(false)
    setRunning(true)
  }

  const stopTimer = () => {
    setRunning(false)
  }

  const resetTimer = () => {
    setRunning(false)
    setRemaining(0)
    setTimeUp(false)
  }

  const startDraw = () => {
    setWinner(null)
    setDrawIndex(0)
    setDrawRunning(true)
  }

  const progress = duration > 0 ? (remaining / duration) : 0
  const circleStyle = {
    background: `conic-gradient(#A8D8B9 ${progress * 360}deg, rgba(255,255,255,0.12) 0deg)`
  }

  const currentStudent = students[drawIndex]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#fdfbf7] rounded-3xl shadow-2xl max-w-3xl w-full overflow-hidden">
        <div className="h-3 bg-gradient-to-r from-[#A8D8B9] to-[#FFD6A5]" />
        <button onClick={onClose} className="absolute top-5 right-5 p-2 rounded-full bg-white/80 hover:bg-white shadow-md">
          <X size={20} className="text-[#5D5D5D]" />
        </button>

        <div className="p-6 md:p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-[#A8D8B9] flex items-center justify-center text-white shadow-md">
              <Sparkles size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-[#5D5D5D]">課堂法寶</h2>
              <p className="text-sm text-[#8B8B8B]">上課小工具，讓課堂更順暢</p>
            </div>
          </div>

          <div className="flex gap-3 mb-6">
            <button
              onClick={() => setActiveTab('timer')}
              className={`px-4 py-2 rounded-xl font-bold text-sm transition-all ${activeTab === 'timer' ? 'bg-[#A8D8B9] text-white shadow-md' : 'bg-[#E8E8E8] text-[#5D5D5D]'}`}
            >
              ⏳ 專注計時
            </button>
            <button
              onClick={() => setActiveTab('draw')}
              className={`px-4 py-2 rounded-xl font-bold text-sm transition-all ${activeTab === 'draw' ? 'bg-[#FFD6A5] text-white shadow-md' : 'bg-[#E8E8E8] text-[#5D5D5D]'}`}
            >
              🎲 幸運抽籤
            </button>
          </div>

          {activeTab === 'timer' && (
            <div className="flex flex-col items-center justify-center gap-6">
              <div className="relative flex items-center justify-center">
                {running && (
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 text-4xl animate-cat-walk">
                    🐱
                  </div>
                )}
                <div className="timer-ring" style={{ ...circleStyle, width: 260, height: 260 }}>
                  <div className="timer-center">
                    <div className="text-4xl md:text-5xl font-bold text-[#5D5D5D]">
                      {String(Math.floor(remaining / 60)).padStart(2, '0')}:{String(remaining % 60).padStart(2, '0')}
                    </div>
                    <div className="text-sm text-[#8B8B8B] mt-2">
                      {running ? '專注中...' : remaining > 0 ? '暫停中' : '準備開始'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full max-w-md">
                {[60, 180, 300, 600].map(s => (
                  <button
                    key={s}
                    onClick={() => startTimer(s)}
                    className="px-4 py-2 rounded-xl bg-white border-2 border-[#A8D8B9] text-[#4A7C59] font-bold hover:bg-[#A8D8B9] hover:text-white transition-all"
                  >
                    {s / 60} 分鐘
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-center gap-3 w-full">
                <button
                  onClick={() => (running ? stopTimer() : startTimer(remaining || duration || 180))}
                  className="px-6 py-3 rounded-2xl bg-gradient-to-r from-[#A8D8B9] to-[#7BC496] text-white font-bold text-lg shadow-lg hover:shadow-xl active:scale-[0.98] transition-all"
                >
                  {running ? '暫停' : '開始'}
                </button>
                <button onClick={resetTimer} className="px-6 py-3 rounded-2xl bg-[#E8E8E8] text-[#5D5D5D] font-bold text-lg hover:bg-[#D8D8D8] transition-all">
                  重設
                </button>
              </div>
            </div>
          )}

          {activeTab === 'draw' && (
            <div className="flex flex-col items-center justify-center gap-6">
              <div className={`relative w-full max-w-md transition-all duration-500 ${winner ? 'scale-105' : ''}`}>
                <div className={`draw-reel transition-all duration-500 ${winner ? 'border-4 border-[#FFBF69] shadow-2xl' : ''}`}>
                  {winner && <div className="confetti-layer" />}
                  {currentStudent ? (
                    <div className="draw-avatar">
                      <AvatarEmoji seed={currentStudent.uuid || currentStudent.id} className="w-full h-full rounded-2xl text-5xl" />
                    </div>
                  ) : (
                    <div className="draw-avatar empty">🎁</div>
                  )}
                  <div className="text-lg font-bold text-[#5D5D5D] mt-3">
                    {drawRunning ? '抽籤中...' : currentStudent?.name || '等待抽籤'}
                  </div>
                  {winner && (
                    <div className="mt-2 text-xl font-bold text-[#7BC496]">🎉 幸運兒：{winner.name}</div>
                  )}
                </div>
              </div>
              <button
                onClick={startDraw}
                disabled={drawRunning || students.length === 0}
                className="px-6 py-3 rounded-2xl bg-gradient-to-r from-[#A8D8B9] to-[#7BC496] text-white font-bold text-lg shadow-lg hover:shadow-xl active:scale-[0.98] transition-all disabled:opacity-50"
              >
                {drawRunning ? '抽籤中...' : '開始抽籤'}
              </button>
              {students.length === 0 && (
                <div className="text-sm text-[#D64545]">目前沒有可抽籤的村民。</div>
              )}
            </div>
          )}
        </div>

        {timeUp && (
          <div className="gadget-alert">
            <div className="gadget-alert-card">
              <div className="text-4xl mb-3">⏰</div>
              <div className="text-2xl font-bold text-[#5D5D5D]">時間到！</div>
              <button onClick={() => setTimeUp(false)} className="mt-4 px-4 py-2 rounded-xl bg-[#A8D8B9] text-white font-bold">
                好的
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================
// 村民卡片 (v2.0 重新設計)
// ============================================

function VillagerCard({ student, tasks, studentStatus, onClick, hasOverdue }) {
  const status = studentStatus[student.id] || {}
  const hasTasks = tasks.length > 0
  
  const completedCount = tasks.filter(t => isDoneStatus(status[t.id])).length
  const totalTasks = tasks.length
  const allDone = hasTasks && completedCount === totalTasks
  const hasIncomplete = hasTasks && completedCount < totalTasks
  
  const studentNumber = student.number || student.seatNumber
  const hasDefaultName = isDefaultName(student.name, studentNumber)

  // 根據完成狀態決定背景色
  const getBgStyle = () => {
    if (!hasTasks) return 'from-[#F5F5F5] to-[#EBEBEB] border-[#E0E0E0]'
    if (allDone) return 'from-[#E8F5E9] to-[#C8E6C9] border-[#A8D8B9]'
    return 'from-[#FFF3E0] to-[#FFE0B2] border-[#FFD6A5]'
  }

  return (
    <div
      onClick={onClick}
      className={`relative bg-gradient-to-br ${getBgStyle()} rounded-2xl p-3 cursor-pointer group transition-all duration-300 ease-out hover:scale-105 hover:-translate-y-1 hover:shadow-lg border-2`}
    >
      {/* 座號標籤 */}
      <div className={`absolute -top-2 -left-2 w-7 h-7 rounded-full flex items-center justify-center text-white font-bold text-xs shadow-md z-10 ${
        allDone ? 'bg-[#7BC496]' : hasIncomplete ? 'bg-[#FFBF69]' : 'bg-[#B8B8B8]'
      }`}>
        {studentNumber || '?'}
      </div>

      {/* 欠交警示 */}
      {hasOverdue && (
        <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-[#D64545] flex items-center justify-center z-20 animate-pulse shadow-md">
          <AlertCircle size={14} className="text-white" />
        </div>
      )}

      {/* 頭像區 */}
      <div className="relative w-full aspect-square mb-2 rounded-xl overflow-hidden bg-white/50 shadow-inner">
        <AvatarEmoji
          seed={student.uuid || student.id}
          className="w-full h-full rounded-xl text-5xl transition-transform duration-300 group-hover:scale-110"
        />
        
        {/* 完成狀態指示器 */}
        {hasTasks && (
          <div className="absolute bottom-1 right-1 flex items-center gap-0.5">
            {allDone ? (
              <div className="bg-[#7BC496] text-white text-xs px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shadow-md">
                <Check size={12} />
                <span className="font-bold">完成</span>
              </div>
            ) : (
              <div className="bg-[#FFBF69] text-white text-xs px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shadow-md">
                <Clock size={12} />
                <span className="font-bold">{completedCount}/{totalTasks}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 名字 */}
      <div className="text-center">
        <h3 className={`text-sm font-bold truncate ${hasDefaultName ? 'text-[#B8B8B8] italic' : 'text-[#5D5D5D]'}`}>
          {student.name || '未命名'}
        </h3>
      </div>

      {/* 任務進度條（當有任務時顯示） */}
      {hasTasks && !allDone && (
        <div className="mt-2 h-1 bg-white/50 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-[#7BC496] transition-all duration-500"
            style={{ width: `${(completedCount / totalTasks) * 100}%` }}
          />
        </div>
      )}
    </div>
  )
}

// ============================================
// 村民護照 Modal
// ============================================

function PassportModal({ student, tasks, studentStatus, classId, onClose, onToggleStatus, onStudentUpdate, apiUrl, hasOverdue, settings, allLogs, currentDateStr }) {
  const [isEditMode, setIsEditMode] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [editData, setEditData] = useState({ name: student.name || '', gender: student.gender || 'male', group: student.group || 'A' })
  const status = studentStatus[student.id] || {}
  const hasTasks = tasks.length > 0
  const completedCount = tasks.filter(t => isDoneStatus(status[t.id])).length
  const isAllDone = hasTasks && completedCount === tasks.length

  const overdueItems = useMemo(() => {
    if (!allLogs || !currentDateStr) return []
    const today = parseDate(currentDateStr)
    const items = []
    allLogs.forEach(log => {
      const logDateStr = typeof log.date === 'string' ? log.date.split('T')[0] : formatDate(log.date)
      if (!logDateStr) return
      if (parseDate(logDateStr) >= today) return
      const logTasks = log.tasks || []
      const logStatus = log.status?.[student.id] || {}
      logTasks.forEach(task => {
        if (!isDoneStatus(logStatus[task.id])) {
          items.push({ date: logDateStr, task })
        }
      })
    })
    return items
  }, [allLogs, currentDateStr, student.id])

  const historyItems = useMemo(() => {
    if (!allLogs) return []
    const items = []
    allLogs.forEach(log => {
      const logDateStr = typeof log.date === 'string' ? log.date.split('T')[0] : formatDate(log.date)
      if (!logDateStr) return
      const logTasks = log.tasks || []
      const logStatus = log.status?.[student.id] || {}
      logTasks.forEach(task => {
        items.push({ date: logDateStr, task, completed: isDoneStatus(logStatus[task.id]) })
      })
    })
    return items.sort((a, b) => new Date(b.date) - new Date(a.date))
  }, [allLogs, student.id])

  const saveEdit = () => {
    if (!editData.name.trim()) return
    const updatedStudent = { ...student, id: student.id || student.uuid, name: editData.name.trim(), group: editData.group, gender: editData.gender }
    if (onStudentUpdate) onStudentUpdate(updatedStudent)
    setIsEditMode(false)
    if (apiUrl) {
      fetch(apiUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'update_student', classId, uuid: student.uuid || student.id, name: editData.name.trim(), group: editData.group, gender: editData.gender })
      }).catch(console.error)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative bg-[#fdfbf7] rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="h-3" style={{ background: 'repeating-linear-gradient(90deg, #A8D8B9, #A8D8B9 20px, #FFD6A5 20px, #FFD6A5 40px)' }} />
        <button onClick={onClose} className="absolute top-6 right-4 p-2 rounded-full bg-white/80 hover:bg-white shadow-md z-10">
          <X size={20} className="text-[#5D5D5D]" />
        </button>
        
        <div className="p-6">
          {/* 欠交警示 */}
          {hasOverdue && (
            <div className="mb-4 p-3 rounded-xl bg-[#FFADAD]/20 border-2 border-[#D64545] text-[#D64545] text-sm flex items-start gap-2">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              <span>⚠️ 尚有過去任務未完成，請檢查歷史日誌</span>
            </div>
          )}
          
          {/* 頭像和基本資料 */}
          <div className="flex items-start gap-6 mb-6">
            <div className={`w-28 h-28 rounded-3xl overflow-hidden shadow-lg shrink-0 ring-4 ${isAllDone ? 'ring-[#A8D8B9]' : hasTasks ? 'ring-[#FFD6A5]' : 'ring-[#E8E8E8]'}`}>
              <AvatarEmoji seed={student.uuid || student.id} className="w-full h-full rounded-3xl text-5xl" />
            </div>
            <div className="flex-1">
              {isEditMode ? (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={editData.name}
                    onChange={e => setEditData(p => ({...p, name: e.target.value}))}
                    className="w-full px-3 py-2 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none"
                    placeholder="村民姓名"
                  />
                  <select
                    value={editData.group}
                    onChange={e => setEditData(p => ({...p, group: e.target.value}))}
                    className="w-full px-3 py-2 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none"
                  >
                    {['A', 'B', 'C', 'D', 'E', 'F'].map(g => (
                      <option key={g} value={g}>{settings?.groupAliases?.[g] || `${g} 小隊`}</option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <button onClick={saveEdit} className="flex-1 bg-[#A8D8B9] text-white py-2 rounded-xl font-medium">儲存</button>
                    <button onClick={() => setIsEditMode(false)} className="bg-[#E8E8E8] text-[#5D5D5D] px-4 py-2 rounded-xl">取消</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm px-2 py-0.5 rounded-full bg-[#FFD6A5]/30 text-[#8B6914] font-medium">
                      {student.number} 號
                    </span>
                    <span className="text-sm px-2 py-0.5 rounded-full bg-[#A8D8B9]/30 text-[#4A7C59] font-medium">
                      {settings?.groupAliases?.[student.group] || `${student.group || 'A'} 小隊`}
                    </span>
                  </div>
                  <h3 className="text-2xl font-bold mb-2 text-[#5D5D5D]">{student.name}</h3>
                  <button
                    onClick={() => { setEditData({ name: student.name, gender: student.gender, group: student.group }); setIsEditMode(true) }}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#FFD6A5]/30 text-[#8B6914] text-sm font-medium hover:bg-[#FFD6A5]/50 transition-colors"
                  >
                    <Pencil size={14} />編輯資料
                  </button>
                  
                  {/* 完成統計 */}
                  {hasTasks && (
                    <div className="mt-3 flex items-center gap-2">
                      <div className="flex-1 h-2 bg-[#E8E8E8] rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${(completedCount / tasks.length) * 100}%`,
                            background: isAllDone ? '#7BC496' : '#FFBF69'
                          }}
                        />
                      </div>
                      <span className="text-sm font-medium text-[#5D5D5D]">{completedCount}/{tasks.length}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
          
          {/* 任務列表 */}
          <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
            {tasks.length === 0 ? (
              <div className="text-center py-8 bg-[#F9F9F9] rounded-2xl">
                <div className="text-4xl mb-2">😸</div>
                <p className="text-[#8B8B8B]">今日暫無任務</p>
              </div>
            ) : (
              tasks.map(task => {
                const IconComponent = getTaskIcon(task.title)
                const statusValue = status[task.id]
                const isCompleted = isDoneStatus(statusValue)
                const statusLabel = getStatusLabel(statusValue)
                
                return (
                  <label
                    key={task.id}
                    className={`flex items-center gap-4 p-4 rounded-2xl cursor-pointer transition-all ${
                      isCompleted
                        ? 'bg-[#A8D8B9]/20 border-2 border-[#A8D8B9]'
                        : 'bg-white border-2 border-transparent hover:border-[#FFD6A5]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isCompleted}
                      onChange={e => onToggleStatus(student.id, task.id, e.target.checked)}
                      className="sr-only"
                    />
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      isCompleted ? 'bg-[#7BC496]' : 'bg-[#FFD6A5]'
                    }`}>
                      <IconComponent size={18} className="text-white" />
                    </div>
                    <span className={`flex-1 font-medium ${isCompleted ? 'text-[#7BC496] line-through' : 'text-[#5D5D5D]'}`}>
                      {task.title}
                    </span>
                    {statusLabel && (
                      <span className="text-xs px-2 py-1 rounded-full bg-[#FFD6A5]/40 text-[#8B6914] font-bold">
                        {statusLabel}
                      </span>
                    )}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleStatus(student.id, task.id, 'leave'); }}
                        className="px-2 py-1 text-xs rounded-lg bg-[#E8E8E8] text-[#5D5D5D] hover:bg-[#D8D8D8]"
                      >
                        請假
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleStatus(student.id, task.id, 'exempt'); }}
                        className="px-2 py-1 text-xs rounded-lg bg-[#FFD6A5]/60 text-[#8B6914] hover:bg-[#FFD6A5]"
                      >
                        免交
                      </button>
                    </div>
                  </label>
                )
              })
            )}
          </div>

          {overdueItems.length > 0 && (
            <div className="mt-4 p-4 rounded-2xl border-2 border-[#FFADAD] bg-[#FFADAD]/10">
              <div className="font-bold text-[#D64545] mb-2">⚠️ 尚有未完成的歷史任務</div>
              <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                {overdueItems.map((item, idx) => (
                  <label
                    key={`${item.date || 'no-date'}-${item.task.id || 'no-id'}-${idx}`}
                    className="flex items-center gap-3 p-3 rounded-xl bg-white border-2 border-transparent hover:border-[#FFADAD]/40 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={false}
                      onChange={e => onToggleStatus(student.id, item.task.id, e.target.checked, item.date)}
                      className="sr-only"
                    />
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#FFADAD]/60 text-white">
                      <AlertTriangle size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-[#D64545] truncate">{item.task.title}</div>
                      <div className="text-xs text-[#8B8B8B]">日期：{formatDateDisplay(item.date)}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleStatus(student.id, item.task.id, true, item.date); }}
                        className="px-2 py-1 text-xs rounded-lg bg-[#FFADAD]/30 text-[#D64545] hover:bg-[#FFADAD]/50"
                      >
                        補交
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleStatus(student.id, item.task.id, 'leave', item.date); }}
                        className="px-2 py-1 text-xs rounded-lg bg-[#E8E8E8] text-[#5D5D5D] hover:bg-[#D8D8D8]"
                      >
                        請假
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleStatus(student.id, item.task.id, 'exempt', item.date); }}
                        className="px-2 py-1 text-xs rounded-lg bg-[#FFD6A5]/60 text-[#8B6914] hover:bg-[#FFD6A5]"
                      >
                        免交
                      </button>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {showHistory && (
            <div className="mt-4 p-4 rounded-2xl bg-[#F9F9F9] border border-[#E8E8E8]">
              <div className="font-bold text-[#5D5D5D] mb-3">📊 該生完整任務紀錄</div>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {historyItems.length === 0 ? (
                  <div className="text-sm text-[#8B8B8B]">尚無歷史紀錄。</div>
                ) : (
                  historyItems.map((item, idx) => (
                    <label
                      key={`${item.date || 'no-date'}-${item.task.id || 'no-id'}-${idx}-history`}
                      className={`flex items-center gap-3 p-3 rounded-xl border-2 ${item.completed ? 'bg-[#A8D8B9]/15 border-[#A8D8B9]/40' : 'bg-white border-[#E8E8E8]'}`}
                    >
                      <input
                        type="checkbox"
                        checked={item.completed}
                        onChange={e => onToggleStatus(student.id, item.task.id, e.target.checked, item.date)}
                        className="sr-only"
                      />
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${item.completed ? 'bg-[#A8D8B9]' : 'bg-[#FFD6A5]'}`}>
                        {item.completed ? <Check size={18} className="text-white" /> : <ScrollText size={18} className="text-white" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-[#5D5D5D] truncate">{item.task.title}</div>
                        <div className="text-xs text-[#8B8B8B]">日期：{formatDateDisplay(item.date)}</div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); onToggleStatus(student.id, item.task.id, true, item.date); }}
                          className="px-2 py-1 text-xs rounded-lg bg-[#A8D8B9]/30 text-[#4A7C59] hover:bg-[#A8D8B9]/50"
                        >
                          完成
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); onToggleStatus(student.id, item.task.id, 'leave', item.date); }}
                          className="px-2 py-1 text-xs rounded-lg bg-[#E8E8E8] text-[#5D5D5D] hover:bg-[#D8D8D8]"
                        >
                          請假
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); onToggleStatus(student.id, item.task.id, 'exempt', item.date); }}
                          className="px-2 py-1 text-xs rounded-lg bg-[#FFD6A5]/60 text-[#8B6914] hover:bg-[#FFD6A5]"
                        >
                          免交
                        </button>
                      </div>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================
// 設定 Modal
// ============================================

function SettingsModal({ classId, className, settings, students, allLogs, onClose, onSave, onRestoreFromBackup, onClearLocalClass, apiUrl }) {
  const [localSettings, setLocalSettings] = useState({
    taskTypes: settings?.taskTypes || ['作業', '訂正', '攜帶物品', '考試', '通知單', '回條'],
    groupAliases: settings?.groupAliases || {}
  })
  const [newTaskType, setNewTaskType] = useState('')
  const [saving, setSaving] = useState(false)
  const [backupUrl, setBackupUrl] = useState(() => localStorage.getItem('ppt_backup_url') || '')
  const [backupToken, setBackupToken] = useState(() => localStorage.getItem('ppt_backup_token') || 'meow1234')
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupMsg, setBackupMsg] = useState(null)
  const [backupMeta, setBackupMeta] = useState(null)

  const defaultGroups = ['A', 'B', 'C', 'D', 'E', 'F']

  useEffect(() => {
    if (!classId) return
    try {
      const raw = localStorage.getItem(`ppt_backup_meta_${classId}`)
      setBackupMeta(raw ? JSON.parse(raw) : null)
    } catch {
      setBackupMeta(null)
    }
  }, [classId])

  const handleSave = async () => {
    try {
      setSaving(true)
      if (apiUrl) {
        fetch(apiUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ action: 'save_settings', classId, settings: localSettings })
        }).catch(err => console.error(err))
      }
      if (onSave) onSave(localSettings)
      onClose()
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  const handleBackupUpload = async () => {
    if (!backupUrl.trim()) {
      setBackupMsg('請先輸入 GAS 連結')
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
      localStorage.setItem('ppt_backup_token', backupToken.trim() || 'meow1234')
      const meta = { updatedAt: payload.data.updatedAt, className: className || '', classId }
      localStorage.setItem(`ppt_backup_meta_${classId}`, JSON.stringify(meta))
      setBackupMeta(meta)
      setBackupMsg('備份已送出（單一班級）')
    } catch (err) {
      console.error('備份上傳失敗:', err)
      setBackupMsg('備份上傳失敗')
    } finally {
      setBackupBusy(false)
    }
  }

  const handleBackupDownload = async () => {
    if (!backupUrl.trim()) {
      setBackupMsg('請先輸入 GAS 連結')
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
        settings: restored.settings || settings,
        updatedAt: restored.updatedAt || new Date().toISOString()
      })
      if (onRestoreFromBackup) {
        onRestoreFromBackup(restored)
      }
      localStorage.setItem('ppt_backup_url', backupUrl.trim())
      localStorage.setItem('ppt_backup_token', backupToken.trim() || 'meow1234')
      const meta = { updatedAt: restored.updatedAt || new Date().toISOString(), className: className || '', classId }
      localStorage.setItem(`ppt_backup_meta_${classId}`, JSON.stringify(meta))
      setBackupMeta(meta)
      setBackupMsg('已完成下載並覆蓋本地（單一班級）')
    } catch (err) {
      console.error('備份下載失敗:', err)
      setBackupMsg('備份下載失敗')
    } finally {
      setBackupBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative bg-[#fdfbf7] rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="h-3 bg-gradient-to-r from-[#A8D8B9] to-[#FFD6A5]" />

        <div className="p-6 border-b border-[#E8E8E8] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#A8D8B9] to-[#FFD6A5] flex items-center justify-center">
              <Settings size={24} className="text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-[#5D5D5D]">村莊設定</h2>
              <p className="text-sm text-[#8B8B8B]">自訂任務類型與資料管理</p>
            </div>
          </div>
          <button onClick={onClose} disabled={saving} className="p-2 rounded-full hover:bg-[#E8E8E8] transition-colors">
            <X size={24} className="text-[#5D5D5D]" />
          </button>
        </div>

        <div className="p-6 max-h-[70vh] overflow-y-auto">

          {/* 任務類型設定 */}
          <div className="space-y-4 mb-6">
            <h3 className="text-sm font-bold text-[#5D5D5D] flex items-center gap-2">
              <ClipboardList size={16} className="text-[#A8D8B9]" />
              任務類型標籤
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
            <div className="flex gap-2">
              <input
                type="text"
                value={newTaskType}
                onChange={e => setNewTaskType(e.target.value)}
                className="flex-1 px-4 py-2 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none"
                placeholder="新標籤..."
              />
              <button
                onClick={() => { if(newTaskType.trim()) { setLocalSettings(p => ({...p, taskTypes: [...p.taskTypes, newTaskType.trim()]})); setNewTaskType('') } }}
                className="px-4 py-2 rounded-xl bg-[#A8D8B9] text-white"
              >
                <Plus size={20} />
              </button>
            </div>
          </div>

          {/* 小隊名稱設定 */}
          <div className="border-t border-[#E8E8E8] pt-6 space-y-4">
            <h3 className="text-sm font-bold text-[#5D5D5D] flex items-center gap-2">
              <Flag size={16} className="text-[#FFD6A5]" />
              小隊名稱設定
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {defaultGroups.map(group => (
                <div key={group} className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[#8B8B8B] w-6">{group}</span>
                  <input
                    type="text"
                    value={localSettings.groupAliases[group] || ''}
                    onChange={e => setLocalSettings(p => ({
                      ...p,
                      groupAliases: { ...p.groupAliases, [group]: e.target.value }
                    }))}
                    placeholder={`${group} 小隊`}
                    className="flex-1 px-3 py-2 text-sm rounded-xl border-2 border-[#E8E8E8] focus:border-[#FFD6A5] outline-none"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* 備份中心 */}
          <div className="border-t border-[#E8E8E8] pt-6 space-y-3">
            <h3 className="text-sm font-bold text-[#5D5D5D] flex items-center gap-2">
              <Download size={16} className="text-[#A8D8B9]" />
              備份中心
            </h3>
            <p className="text-xs text-[#8B8B8B]">
              ⚠️ 目前備份/還原僅針對「單一班級」。請確認目前班級：{className || classId}
            </p>
            {backupMeta?.updatedAt && (
              <p className="text-xs text-[#8B8B8B]">
                上次備份時間：{new Date(backupMeta.updatedAt).toLocaleString()}
              </p>
            )}
            <input
              type="url"
              value={backupUrl}
              onChange={(e) => setBackupUrl(e.target.value)}
              placeholder="https://script.google.com/macros/s/.../exec"
              className="w-full px-3 py-2 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none"
            />
            <input
              type="text"
              value={backupToken}
              onChange={(e) => setBackupToken(e.target.value)}
              placeholder="Token（預設 meow1234）"
              className="w-full px-3 py-2 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none"
            />
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleBackupUpload}
                disabled={backupBusy}
                className="px-4 py-2 rounded-xl bg-[#A8D8B9] text-white font-bold hover:bg-[#7BC496] transition-all disabled:opacity-50"
              >
                ⬆️ 上傳備份
              </button>
              <button
                onClick={handleBackupDownload}
                disabled={backupBusy}
                className="px-4 py-2 rounded-xl bg-[#FFD6A5] text-white font-bold hover:bg-[#FFBF69] transition-all disabled:opacity-50"
              >
                ⬇️ 下載備份
              </button>
            </div>
            {backupMsg && (
              <div className="text-xs text-[#5D5D5D] bg-[#F9F9F9] border border-[#E8E8E8] rounded-xl px-3 py-2">
                {backupMsg}
              </div>
            )}
          </div>

          <div className="border-t border-[#E8E8E8] pt-6">
            <button
              onClick={() => {
                if (window.confirm('確定要清除本機此班級資料嗎？此操作不會影響雲端備份。')) {
                  onClearLocalClass?.(classId)
                  onClose()
                }
              }}
              className="w-full py-2.5 rounded-xl bg-[#FFADAD]/20 text-[#D64545] font-bold hover:bg-[#FFADAD]/30 transition-colors"
            >
              清除本機此班級資料
            </button>
          </div>

          <div className="mt-6 flex gap-3">
            <button onClick={handleSave} disabled={saving} className="flex-1 py-3 rounded-xl bg-gradient-to-r from-[#A8D8B9] to-[#7BC496] text-white font-medium">
              {saving ? '儲存中...' : '儲存設定'}
            </button>
            <button onClick={onClose} disabled={saving} className="px-4 py-3 rounded-xl bg-[#E8E8E8] text-[#5D5D5D]">取消</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================
// Header
// ============================================

function Header({ todayStr, completionRate, className, classAlias, onLogout, onOpenSettings, onOpenTeamManagement, onOpenTaskOverview, onOpenGadgets, onDisconnect }) {
  const displayName = classAlias || className
  return (
    <header className="bg-white/80 backdrop-blur-md rounded-3xl p-4 md:p-5 mb-6 shadow-lg border border-white/50">
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
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 bg-[#fdfbf7] px-4 py-2 rounded-2xl">
            <div className="hidden sm:block">
              <span className="text-xs text-[#8B8B8B]">達成率</span>
              <div className="text-lg font-bold text-[#5D5D5D]">{Math.round(completionRate * 100)}%</div>
            </div>
            <div className="w-24 md:w-32 h-3 bg-[#E8E8E8] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${completionRate * 100}%`, background: completionRate >= 0.8 ? '#7BC496' : '#FFBF69' }}
              />
            </div>
          </div>
          <button onClick={onOpenTeamManagement} className="p-3 rounded-2xl bg-[#fdfbf7] hover:bg-[#FFD6A5]/20 transition-colors" title="小隊管理">
            <Flag size={22} className="text-[#5D5D5D]" />
          </button>
          <button onClick={onOpenTaskOverview} className="p-3 rounded-2xl bg-[#fdfbf7] hover:bg-[#A8D8B9]/20 transition-colors" title="任務總覽">
            <ListTodo size={22} className="text-[#5D5D5D]" />
          </button>
          <button onClick={onOpenSettings} className="p-3 rounded-2xl bg-[#fdfbf7] hover:bg-[#FFD6A5]/20 transition-colors" title="村莊設定">
            <Settings size={22} className="text-[#5D5D5D]" />
          </button>
          <button onClick={onOpenGadgets} className="p-3 rounded-2xl bg-[#fdfbf7] hover:bg-[#A8D8B9]/20 transition-colors" title="課堂法寶">
            <Sparkles size={22} className="text-[#5D5D5D]" />
          </button>
          <button onClick={onLogout} className="p-3 rounded-2xl bg-[#fdfbf7] hover:bg-[#FFADAD]/20 transition-colors" title="返回村莊列表">
            <LogOut size={22} className="text-[#5D5D5D]" />
          </button>
          <button onClick={onDisconnect} className="p-3 rounded-2xl bg-[#fdfbf7] hover:bg-[#FFADAD]/20 text-[#D64545] transition-colors" title="斷開資料庫">
            <Unplug size={22} />
          </button>
        </div>
      </div>
    </header>
  )
}

// ============================================
// 村莊儀表板 (Dashboard View)
// ============================================

function DashboardView({ classId, className, classAlias, onLogout, apiUrl, onDisconnect, onClearLocalClass }) {
  const [students, setStudents] = useState([])
  const [allLogs, setAllLogs] = useState([])
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedStudent, setSelectedStudent] = useState(null)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [showSettings, setShowSettings] = useState(false)
  const [showTeamManagement, setShowTeamManagement] = useState(false)
  const [showTaskOverview, setShowTaskOverview] = useState(false)
  const [showFocus, setShowFocus] = useState(false)
  const [showGadgets, setShowGadgets] = useState(false)

  const normalizeDate = useCallback((date) => {
    if (typeof date === 'string') {
      try { return formatDate(new Date(date)) } catch { return date.split('T')[0] }
    }
    return formatDate(date)
  }, [])

  useEffect(() => {
    if (!classId) return
    const cached = loadClassCache(classId)
    if (cached) {
      const normStudents = (cached.students || []).map((s, i) => ({ ...s, id: s.id || s.uuid || `student_${i}` }))
      const normLogs = (cached.logs || []).map(log => {
        const dateStr = normalizeDate(log.date)
        const tasks = (log.tasks || []).map((t, i) => ({ ...t, id: t.id || makeTaskId(dateStr, t, i) }))
        return { ...log, date: dateStr, tasks }
      })
      setStudents(normStudents)
      setAllLogs(normLogs)
      setSettings(cached.settings || settings)
      setLoading(false)
    }
  }, [classId, normalizeDate])

  const { tasks, studentStatus } = useMemo(() => {
    const dateStr = formatDate(currentDate)
    const log = allLogs.find(log => normalizeDate(log.date) === dateStr)
    return log ? { tasks: (log.tasks || []).map((t, i) => ({...t, id: t.id || `task_${i}`})), studentStatus: log.status || {} } : { tasks: [], studentStatus: {} }
  }, [allLogs, currentDate, normalizeDate])

  const completionRate = useMemo(() => {
    if (students.length === 0 || tasks.length === 0) return 0
    let completedChecks = 0
    students.forEach(s => tasks.forEach(t => { if (isDoneStatus(studentStatus[s.id]?.[t.id])) completedChecks++ }))
    return completedChecks / (students.length * tasks.length)
  }, [students, tasks, studentStatus])

  const fetchAllData = useCallback(async () => {
    if (!apiUrl || !classId) return
    const cached = loadClassCache(classId)
    if (cached) return
    try {
      setLoading(true)
      const response = await fetch(`${apiUrl}?action=get_class_data_all&classId=${classId}`)
      if (!response.ok) throw new Error('API Error')
      const data = await response.json()
      
      const normStudents = (data.students || []).map((s, i) => ({...s, id: s.id || s.uuid || `student_${i}`}))
      const normLogs = (data.logs || []).map(log => {
        const dateStr = normalizeDate(log.date)
        const tasks = (log.tasks || []).map((t, i) => ({ ...t, id: t.id || makeTaskId(dateStr, t, i) }))
        return { ...log, date: dateStr, tasks }
      })
      const normSettings = data.settings || settings

      setStudents(normStudents)
      setAllLogs(normLogs)
      setSettings(normSettings)
    } catch (err) {
      setError(`連線錯誤: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [classId, apiUrl, normalizeDate])

  useEffect(() => { fetchAllData() }, [fetchAllData])

  useEffect(() => {
    if (!classId) return
    saveClassCache(classId, {
      classId,
      students,
      logs: allLogs,
      settings,
      updatedAt: new Date().toISOString()
    })
  }, [classId, students, allLogs, settings])

  const handleTasksUpdate = useCallback((updatedTasks) => {
    const dateStr = formatDate(currentDate)
    const normDate = normalizeDate(dateStr)
    setAllLogs(prev => {
      const idx = prev.findIndex(l => normalizeDate(l.date) === normDate)
      if (idx >= 0) {
        const newLogs = [...prev]
        newLogs[idx] = { ...newLogs[idx], tasks: updatedTasks }
        return newLogs
      }
      return [...prev, { date: normDate, tasks: updatedTasks, status: {} }]
    })
  }, [currentDate, normalizeDate])

  const toggleStatus = useCallback((studentId, taskId, checked, dateOverride) => {
    const rawDate = dateOverride || currentDate
    const dateStr = typeof rawDate === 'string' ? rawDate : formatDate(rawDate)
    const normDate = normalizeDate(dateStr)

    setAllLogs(prev => {
      const idx = prev.findIndex(l => normalizeDate(l.date) === normDate)
      if (idx >= 0) {
        const newLogs = [...prev]
        const currentStatus = newLogs[idx].status || {}
        newLogs[idx] = { ...newLogs[idx], status: { ...currentStatus, [studentId]: { ...currentStatus[studentId], [taskId]: checked } } }
        return newLogs
      }
      const log = prev.find(l => normalizeDate(l.date) === normDate)
      return [...prev, { date: normDate, tasks: log?.tasks || [], status: { [studentId]: { [taskId]: checked } } }]
    })

    if (apiUrl) {
      fetch(apiUrl, { method: 'POST', mode: 'no-cors', headers: {'Content-Type': 'text/plain'}, body: JSON.stringify({ action: 'update_status', classId, date: dateStr, studentId, taskId, checked }) }).catch(console.error)
    }
  }, [classId, currentDate, normalizeDate, apiUrl])

  const checkOverdue = useCallback((studentId) => {
    const todayStr = getTodayStr()
    const today = parseDate(todayStr)

    for (const log of allLogs) {
      const logDate = parseDate(normalizeDate(log.date))
      if (logDate >= today) continue

      const logTasks = log.tasks || []
      const logStatus = log.status?.[studentId] || {}

      for (const task of logTasks) {
        if (!isDoneStatus(logStatus[task.id])) {
          return true
        }
      }
    }
    return false
  }, [allLogs, normalizeDate])

  const handleTeamSave = useCallback((assignments) => {
    setStudents(prev => prev.map(s => ({ ...s, group: assignments[s.id] || s.group })))
  }, [])

  const groupedStudents = useMemo(() => {
    const groups = {}
    students.forEach(s => { const g = s.group || 'A'; if(!groups[g]) groups[g] = []; groups[g].push(s) })
    return Object.keys(groups).sort().reduce((acc, k) => { acc[k] = groups[k]; return acc }, {})
  }, [students])

  const getGroupCompletionRate = (groupStudents) => {
    if (tasks.length === 0 || groupStudents.length === 0) return 0
    let completed = 0
    groupStudents.forEach(s => tasks.forEach(t => { if (isDoneStatus(studentStatus[s.id]?.[t.id])) completed++ }))
    return completed / (groupStudents.length * tasks.length)
  }

  const purrCount = students.filter(s => tasks.length > 0 && tasks.every(t => isDoneStatus(studentStatus[s.id]?.[t.id]))).length
  const angryCount = students.filter(s => tasks.length > 0 && tasks.some(t => !isDoneStatus(studentStatus[s.id]?.[t.id]))).length

  if (loading) return <LoadingScreen message="正在進入村莊..." />
  if (error) return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="text-center">
        <h2 className="text-xl font-bold text-[#D64545] mb-2">載入失敗</h2>
        <p className="text-[#8B8B8B] mb-4">{error}</p>
        <button onClick={onDisconnect} className="px-4 py-2 bg-[#E8E8E8] rounded-xl">斷開連結</button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8 bg-[#fdfbf7]">
      <Header
        todayStr={formatDate(currentDate)}
        completionRate={completionRate}
        className={className}
        classAlias={classAlias}
        onLogout={onLogout}
        onOpenSettings={() => setShowSettings(true)}
        onOpenTeamManagement={() => setShowTeamManagement(true)}
        onOpenTaskOverview={() => setShowTaskOverview(true)}
        onOpenGadgets={() => setShowGadgets(true)}
        onDisconnect={onDisconnect}
      />
      
      <div className="flex flex-col lg:flex-row gap-6">
        <aside className="w-full lg:w-[350px] lg:shrink-0 space-y-4">
          <div className="bg-white/60 backdrop-blur-sm rounded-3xl p-4 shadow-lg border border-white/50 space-y-6">
            <div>
              <h2 className="text-lg font-bold text-[#5D5D5D] mb-4 flex items-center gap-2">
                <CalendarIcon size={20} className="text-[#A8D8B9]" />村莊日誌
              </h2>
              <CalendarNav currentDate={currentDate} onDateChange={setCurrentDate} />
            </div>
            <div className="h-px bg-gradient-to-r from-transparent via-[#E8E8E8] to-transparent" />
            <TaskBoard
              tasks={tasks}
              students={students}
              studentStatus={studentStatus}
              classId={classId}
              currentDateStr={formatDate(currentDate)}
              onTasksUpdate={handleTasksUpdate}
              taskTypes={settings.taskTypes}
              apiUrl={apiUrl}
              onOpenFocus={() => setShowFocus(true)}
            />
          </div>
        </aside>

        <main className="flex-1 min-w-0">
          <div className="bg-white/60 backdrop-blur-sm rounded-3xl p-6 shadow-lg border border-white/50">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-[#5D5D5D] flex items-center gap-2">
                <Users size={24} className="text-[#A8D8B9]" />村民廣場
              </h2>
              <div className="flex items-center gap-3">
                <span className="px-3 py-1 rounded-full text-xs font-medium bg-[#A8D8B9]/30 text-[#4A7C59]">✨ {purrCount} 已完成</span>
                <span className="px-3 py-1 rounded-full text-xs font-medium bg-[#FFADAD]/30 text-[#D64545]">⏳ {angryCount} 未完成</span>
              </div>
            </div>

            {students.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-[#8B8B8B]">目前沒有村民資料</p>
              </div>
            ) : (
              <div className="space-y-6">
                {Object.entries(groupedStudents).map(([group, groupStudents]) => {
                  const rate = getGroupCompletionRate(groupStudents)
                  const isComplete = rate === 1 && tasks.length > 0
                  const groupName = settings.groupAliases?.[group] || `${group} 小隊`
                  
                  return (
                    <div
                      key={group}
                      className={`p-4 rounded-2xl transition-all ${
                        isComplete
                          ? 'bg-gradient-to-r from-yellow-50 to-amber-50 border-4 border-yellow-400 shadow-[0_0_20px_rgba(250,204,21,0.4)]'
                          : 'bg-white/40 border border-white/50'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <Flag size={20} className="text-[#FF8A8A]" />
                          <h3 className="text-lg font-bold text-[#5D5D5D]">{groupName}</h3>
                          {isComplete && (
                            <span className="flex items-center gap-1 px-2 py-1 rounded-lg bg-yellow-400 text-yellow-900 text-xs font-bold">
                              <Trophy size={14} />全員達成！
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="w-24 h-2 bg-[#E8E8E8] rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${rate * 100}%`,
                                background: isComplete
                                  ? 'linear-gradient(90deg, #FFD700, #FFA500)'
                                  : 'linear-gradient(90deg, #A8D8B9, #7BC496)'
                              }}
                            />
                          </div>
                          <span className="text-xs text-[#8B8B8B]">{Math.round(rate * 100)}%</span>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-3">
                        {groupStudents.map((student) => (
                          <VillagerCard
                            key={student.id}
                            student={student}
                            tasks={tasks}
                            studentStatus={studentStatus}
                            onClick={() => setSelectedStudent(student)}
                            hasOverdue={checkOverdue(student.id)}
                          />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </main>
      </div>

      <footer className="mt-10 text-center text-[#8B8B8B] text-sm">
        <p className="flex items-center justify-center gap-2">
          <PawPrint size={16} className="text-[#A8D8B9]" />
          呼嚕嚕小鎮 Purr Purr Town v2.0.6 © 2026
          <PawPrint size={16} className="text-[#A8D8B9]" />
        </p>
      </footer>

      {/* Modals */}
      {selectedStudent && (
        <PassportModal
          student={selectedStudent}
          tasks={tasks}
          studentStatus={studentStatus}
          classId={classId}
          apiUrl={apiUrl}
          settings={settings}
          hasOverdue={checkOverdue(selectedStudent.id)}
          allLogs={allLogs}
          currentDateStr={formatDate(currentDate)}
          onClose={() => setSelectedStudent(null)}
          onToggleStatus={toggleStatus}
          onStudentUpdate={(updated) => {
            setStudents(p => p.map(s => s.id === updated.id ? updated : s))
            setSelectedStudent(null)
          }}
        />
      )}
      
      {showSettings && (
        <SettingsModal
          classId={classId}
          className={className}
          settings={settings}
          students={students}
          allLogs={allLogs}
          onClose={() => setShowSettings(false)}
          onSave={setSettings}
          onRestoreFromBackup={(restored) => {
            setStudents((restored.students || []).map((s, i) => ({ ...s, id: s.id || s.uuid || `student_${i}` })))
            setAllLogs((restored.logs || []).map(log => {
              const dateStr = normalizeDate(log.date)
              const tasks = (log.tasks || []).map((t, i) => ({ ...t, id: t.id || makeTaskId(dateStr, t, i) }))
              return { ...log, date: dateStr, tasks }
            }))
            setSettings(restored.settings || settings)
          }}
          onClearLocalClass={onClearLocalClass}
          apiUrl={apiUrl}
        />
      )}
      
      {showTeamManagement && (
        <TeamManagementModal
          students={students}
          settings={settings}
          classId={classId}
          onClose={() => setShowTeamManagement(false)}
          onSave={handleTeamSave}
          onSettingsUpdate={setSettings}
          apiUrl={apiUrl}
        />
      )}
      
      {showTaskOverview && (
        <TaskOverviewModal
          allLogs={allLogs}
          students={students}
          classId={classId}
          settings={settings}
          onClose={() => setShowTaskOverview(false)}
          onNavigateToDate={setCurrentDate}
          onToggleStatus={toggleStatus}
        />
      )}

      {showFocus && (
        <FocusView
          tasks={tasks}
          currentDateStr={formatDate(currentDate)}
          onClose={() => setShowFocus(false)}
        />
      )}

      {showGadgets && (
        <GadgetsModal
          students={students}
          onClose={() => setShowGadgets(false)}
        />
      )}
    </div>
  )
}

// ============================================
// 主應用程式 (App)
// ============================================

function App() {
  const [apiUrl, setApiUrl] = useState(null)
  const [localMode, setLocalMode] = useState(true)
  const [localClasses, setLocalClasses] = useState(() => loadLocalClasses())
  const [selectedClass, setSelectedClass] = useState(null)
  const [hasStarted, setHasStarted] = useState(false)

  const handleDisconnect = () => {
    setSelectedClass(null)
  }

  const handleLocalMode = () => {
    setHasStarted(true)
    setLocalMode(true)
    setApiUrl(null)
    setSelectedClass(null)
  }

  const handleCreateLocalClass = (payload) => {
    const classId = `${payload.year}_${Math.floor(Math.random() * 1000)}`
    const studentCount = payload.studentCount || 10
    const newClass = {
      id: classId,
      year: payload.year,
      name: payload.className,
      teacher: payload.teacher,
      alias: payload.alias || '',
      status: 'active',
      studentCount
    }
    const nextClasses = [...localClasses, newClass]
    setLocalClasses(nextClasses)
    saveLocalClasses(nextClasses)

    const students = Array.from({ length: studentCount }).map((_, i) => ({
      uuid: `s_${classId}_${i + 1}`,
      id: `s_${classId}_${i + 1}`,
      number: i + 1,
      name: `${i + 1}號村民`,
      group: 'A',
      gender: 'neutral'
    }))
    saveClassCache(classId, {
      classId,
      students,
      logs: [],
      settings: DEFAULT_SETTINGS,
      updatedAt: new Date().toISOString()
    })
  }

  const handleSelectClass = (classId, displayName, alias) => {
    setSelectedClass({ id: classId, name: displayName || `班級 ${classId}`, alias: alias || null })
  }

  const handleClearLocalClass = (classId) => {
    localStorage.removeItem(getClassCacheKey(classId))
    const next = loadLocalClasses().filter(c => c.id !== classId)
    setLocalClasses(next)
    saveLocalClasses(next)
    if (selectedClass?.id === classId) {
      setSelectedClass(null)
    }
  }

  if (!hasStarted) {
    return <WelcomeView onLocalMode={handleLocalMode} />
  }

  if (!selectedClass) {
    return (
      <LoginView
        apiUrl={apiUrl}
        localMode={localMode}
        localClasses={localClasses}
        onCreateLocalClass={handleCreateLocalClass}
        onSelectClass={handleSelectClass}
        onDisconnect={handleDisconnect}
      />
    )
  }

  return (
    <DashboardView
      classId={selectedClass.id}
      className={selectedClass.name}
      classAlias={selectedClass.alias}
      onLogout={() => setSelectedClass(null)}
      onDisconnect={handleDisconnect}
      apiUrl={apiUrl}
      onClearLocalClass={handleClearLocalClass}
    />
  )
}

export default App
