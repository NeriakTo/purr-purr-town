import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
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

// --- Task Date Logic (v2.2.0) ---
function getNextDay(dateStr) {
  const date = parseDate(dateStr)
  date.setDate(date.getDate() + 1)
  return formatDate(date)
}

function getTaskDueDate(task, logDate) {
  return task.dueDate || logDate
}

function getTaskCreatedAt(task, logDate) {
  return task.createdAt || logDate
}

function getTasksForDate(allLogs, targetDateStr, normalizeDateFn) {
  const results = []
  allLogs.forEach(log => {
    const logDate = normalizeDateFn(log.date)
    const logTasks = log.tasks || []
    logTasks.forEach(task => {
      const dueDate = getTaskDueDate(task, logDate)
      if (normalizeDateFn(dueDate) === targetDateStr) {
        results.push({ task, logDate })
      }
    })
  })
  return results
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

// --- Status System 2.0 ---
const STATUS_VALUES = {
  ON_TIME: 'on_time',
  LATE: 'late',
  MISSING: 'missing',
  LEAVE: 'leave',
  EXEMPT: 'exempt',
}

function normalizeStatus(value) {
  if (value === true) return STATUS_VALUES.ON_TIME
  if (value === 'leave') return STATUS_VALUES.LEAVE
  if (value === 'exempt') return STATUS_VALUES.EXEMPT
  if (Object.values(STATUS_VALUES).includes(value)) return value
  return value // false, undefined, etc. remain as-is
}

function isDoneStatus(value) {
  const norm = normalizeStatus(value)
  return norm === STATUS_VALUES.ON_TIME || norm === STATUS_VALUES.LATE || norm === STATUS_VALUES.LEAVE || norm === STATUS_VALUES.EXEMPT
}

function getStatusLabel(value) {
  const norm = normalizeStatus(value)
  switch (norm) {
    case STATUS_VALUES.ON_TIME: return '準時'
    case STATUS_VALUES.LATE: return '遲交'
    case STATUS_VALUES.MISSING: return '未交'
    case STATUS_VALUES.LEAVE: return '請假'
    case STATUS_VALUES.EXEMPT: return '免交'
    default: return ''
  }
}

function getStatusVisual(value) {
  const norm = normalizeStatus(value)
  switch (norm) {
    case STATUS_VALUES.ON_TIME:
      return { icon: Check, color: '#7BC496', bg: 'bg-[#A8D8B9]/20', border: 'border-[#A8D8B9]', text: 'text-[#4A7C59]', label: '準時' }
    case STATUS_VALUES.LATE:
      return { icon: Clock, color: '#FFBF69', bg: 'bg-[#FFD6A5]/20', border: 'border-[#FFD6A5]', text: 'text-[#8B6914]', label: '遲交' }
    case STATUS_VALUES.MISSING:
      return { icon: XCircle, color: '#D64545', bg: 'bg-[#FFADAD]/20', border: 'border-[#FFADAD]', text: 'text-[#D64545]', label: '未交' }
    case STATUS_VALUES.LEAVE:
      return { icon: Clock, color: '#8B8B8B', bg: 'bg-[#E8E8E8]/50', border: 'border-[#D8D8D8]', text: 'text-[#8B8B8B]', label: '請假' }
    case STATUS_VALUES.EXEMPT:
      return { icon: Eye, color: '#B8B8B8', bg: 'bg-[#F0F0F0]/50', border: 'border-[#E0E0E0]', text: 'text-[#A0A0A0]', label: '免交' }
    default:
      return { icon: null, color: '#D8D8D8', bg: 'bg-white', border: 'border-[#E8E8E8]', text: 'text-[#5D5D5D]', label: '' }
  }
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
        <span className="text-sm font-medium">Purr Purr Town v2.2.0</span>
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
      <p className="mt-6 text-[#B8B8B8] text-xs">Purr Purr Town v2.2.0 • BYOB Architecture</p>
    </div>
  )
}

// ============================================
// 建立班級 Modal
// ============================================

function CreateClassModal({ onClose, onSuccess, onCreateLocalClass }) {
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

      onCreateLocalClass({
        year: formData.year.trim(),
        className: formData.className.trim(),
        teacher: formData.teacher.trim(),
        alias: formData.alias.trim(),
        studentCount: parseInt(formData.studentCount.trim(), 10)
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
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

function LoginView({ onSelectClass, localClasses, onCreateLocalClass }) {
  const [showCreateModal, setShowCreateModal] = useState(false)

  const classes = localClasses || []

  const handleCreateSuccess = () => {
    setShowCreateModal(false)
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
                    className="group bg-white rounded-2xl p-5 shadow-md border border-[#F0F0F0] hover:shadow-xl hover:border-[#A8D8B9] transition-all hover:-translate-y-1 text-left"
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
          Purr Purr Town v2.2.0
          <PawPrint size={12} />
        </p>
      </footer>

      {showCreateModal && (
        <CreateClassModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={handleCreateSuccess}
          onCreateLocalClass={onCreateLocalClass}
        />
      )}
    </div>
  )
}

// ============================================
// 小隊管理 Modal (v2.0 - 以小隊為中心的操作邏輯)
// ============================================

function TeamManagementModal({ students, settings, onClose, onSave, onSettingsUpdate }) {
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
      
      // 更新小隊名稱設定
      const newSettings = {
        ...settings,
        groupAliases: { ...settings?.groupAliases, ...groupNames }
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
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
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

function TaskOverviewModal({ allLogs, students, onClose, onNavigateToDate, settings, onToggleStatus, onDeleteTask }) {
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
        const incompleteStudents = students.filter(s => !isDoneStatus(logStatus[s.id]?.[task.id]))
        const onTimeStudents = students.filter(s => normalizeStatus(logStatus[s.id]?.[task.id]) === STATUS_VALUES.ON_TIME)
        const lateStudents = students.filter(s => normalizeStatus(logStatus[s.id]?.[task.id]) === STATUS_VALUES.LATE)
        const missingStudents = students.filter(s => normalizeStatus(logStatus[s.id]?.[task.id]) === STATUS_VALUES.MISSING)
        const leaveStudents = students.filter(s => normalizeStatus(logStatus[s.id]?.[task.id]) === STATUS_VALUES.LEAVE)
        const exemptStudents = students.filter(s => normalizeStatus(logStatus[s.id]?.[task.id]) === STATUS_VALUES.EXEMPT)
        const doneCount = onTimeStudents.length + lateStudents.length + leaveStudents.length + exemptStudents.length

        const dueDate = getTaskDueDate(task, log.date)
        tasks.push({
          ...task,
          date: log.date,
          dueDate,
          completedCount: doneCount,
          incompleteCount: incompleteStudents.length,
          totalCount: students.length,
          onTimeStudents,
          lateStudents,
          missingStudents,
          leaveStudents,
          exemptStudents,
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
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
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
                            截止：{formatDateDisplay(task.dueDate || task.date)}
                          </span>
                          {task.dueDate && task.dueDate !== task.date && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-[#F0F0F0] text-[#8B8B8B]">
                              建立：{formatDateDisplay(task.date)}
                            </span>
                          )}
                          {task.type && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-[#FFD6A5]/30 text-[#8B6914]">
                              {task.type}
                            </span>
                          )}
                        </div>
                        <h4 className="font-bold text-[#5D5D5D] truncate">{task.title}</h4>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className={`text-lg font-bold ${task.isComplete ? 'text-[#7BC496]' : 'text-[#FF8A8A]'}`}>
                            {task.completedCount}/{task.totalCount}
                          </div>
                          <div className="text-xs text-[#8B8B8B]">
                            {task.isComplete ? '✅ 全員完成' : `⏳ 剩餘 ${task.incompleteCount} 人`}
                          </div>
                        </div>
                        {onDeleteTask && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              if (window.confirm(`確定要刪除「${task.title}」任務嗎？`)) {
                                onDeleteTask(task.date, task.id)
                              }
                            }}
                            className="p-2 rounded-full hover:bg-[#FFADAD]/20 transition-colors"
                            title="刪除任務"
                          >
                            <Trash2 size={18} className="text-[#D64545]" />
                          </button>
                        )}
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
                      {/* 未完成 */}
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
                                    selected.forEach(studentId => onToggleStatus(studentId, task.id, STATUS_VALUES.ON_TIME, task.date))
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
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (isBatchMode) {
                                    setBatchSelected(prev => ({ ...prev, [s.id]: !prev[s.id] }))
                                  } else if (onToggleStatus) {
                                    onToggleStatus(s.id, task.id, STATUS_VALUES.ON_TIME, task.date)
                                  }
                                }}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border transition-all cursor-pointer hover:opacity-80 ${
                                  isBatchMode
                                    ? batchSelected[s.id]
                                      ? 'bg-[#7BC496]/20 border-[#7BC496]'
                                      : 'bg-[#FFADAD]/20 border-[#FFADAD]/30 hover:border-[#7BC496]/50'
                                    : 'bg-[#FFADAD]/20 border-[#FFADAD]/30 hover:border-[#7BC496]/50'
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

                      {/* 準時完成 */}
                      {task.onTimeStudents.length > 0 && (
                        <div className="mt-4">
                          <h5 className="text-sm font-bold text-[#7BC496] mb-2 flex items-center gap-2">
                            <Check size={16} />
                            準時 ({task.onTimeStudents.length})
                          </h5>
                          <div className="flex flex-wrap gap-2">
                            {task.onTimeStudents.map(s => (
                              <div
                                key={s.id}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (onToggleStatus) onToggleStatus(s.id, task.id, false, task.date)
                                }}
                                className="flex items-center gap-2 px-3 py-1.5 bg-[#A8D8B9]/20 rounded-lg text-sm border border-[#A8D8B9]/30 cursor-pointer hover:opacity-80 hover:border-[#FFADAD]/50 transition-all"
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

                      {/* 遲交 */}
                      {task.lateStudents.length > 0 && (
                        <div className="mt-4">
                          <h5 className="text-sm font-bold text-[#8B6914] mb-2 flex items-center gap-2">
                            <Clock size={16} />
                            遲交 ({task.lateStudents.length})
                          </h5>
                          <div className="flex flex-wrap gap-2">
                            {task.lateStudents.map(s => (
                              <div
                                key={s.id}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (onToggleStatus) onToggleStatus(s.id, task.id, false, task.date)
                                }}
                                className="flex items-center gap-2 px-3 py-1.5 bg-[#FFD6A5]/20 rounded-lg text-sm border border-[#FFD6A5]/30 cursor-pointer hover:opacity-80 hover:border-[#FFADAD]/50 transition-all"
                              >
                                <div className="w-6 h-6 rounded-full overflow-hidden">
                                  <AvatarEmoji seed={s.uuid || s.id} className="w-full h-full rounded-full text-xs" />
                                </div>
                                <span className="text-[#8B6914]">{s.number}. {s.name}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 未交 */}
                      {task.missingStudents.length > 0 && (
                        <div className="mt-4">
                          <h5 className="text-sm font-bold text-[#D64545] mb-2 flex items-center gap-2">
                            <XCircle size={16} />
                            未交 ({task.missingStudents.length})
                          </h5>
                          <div className="flex flex-wrap gap-2">
                            {task.missingStudents.map(s => (
                              <div
                                key={s.id}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (onToggleStatus) onToggleStatus(s.id, task.id, false, task.date)
                                }}
                                className="flex items-center gap-2 px-3 py-1.5 bg-[#FFADAD]/20 rounded-lg text-sm border border-[#FFADAD]/30 cursor-pointer hover:opacity-80 hover:border-[#7BC496]/50 transition-all"
                              >
                                <div className="w-6 h-6 rounded-full overflow-hidden">
                                  <AvatarEmoji seed={s.uuid || s.id} className="w-full h-full rounded-full text-xs" />
                                </div>
                                <span className="text-[#D64545]">{s.number}. {s.name}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 請假 */}
                      {task.leaveStudents.length > 0 && (
                        <div className="mt-4">
                          <h5 className="text-sm font-bold text-[#8B8B8B] mb-2 flex items-center gap-2">
                            <Clock size={16} />
                            請假 ({task.leaveStudents.length})
                          </h5>
                          <div className="flex flex-wrap gap-2">
                            {task.leaveStudents.map(s => (
                              <div
                                key={s.id}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (onToggleStatus) onToggleStatus(s.id, task.id, false, task.date)
                                }}
                                className="flex items-center gap-2 px-3 py-1.5 bg-[#E8E8E8]/50 rounded-lg text-sm border border-[#D8D8D8] cursor-pointer hover:opacity-80 hover:border-[#FFADAD]/50 transition-all"
                              >
                                <div className="w-6 h-6 rounded-full overflow-hidden">
                                  <AvatarEmoji seed={s.uuid || s.id} className="w-full h-full rounded-full text-xs" />
                                </div>
                                <span className="text-[#8B8B8B]">{s.number}. {s.name}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 免交 */}
                      {task.exemptStudents.length > 0 && (
                        <div className="mt-4">
                          <h5 className="text-sm font-bold text-[#A0A0A0] mb-2 flex items-center gap-2">
                            <Eye size={16} />
                            免交 ({task.exemptStudents.length})
                          </h5>
                          <div className="flex flex-wrap gap-2">
                            {task.exemptStudents.map(s => (
                              <div
                                key={s.id}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (onToggleStatus) onToggleStatus(s.id, task.id, false, task.date)
                                }}
                                className="flex items-center gap-2 px-3 py-1.5 bg-[#F0F0F0]/50 rounded-lg text-sm border border-[#E0E0E0] cursor-pointer hover:opacity-80 hover:border-[#FFADAD]/50 transition-all"
                              >
                                <div className="w-6 h-6 rounded-full overflow-hidden">
                                  <AvatarEmoji seed={s.uuid || s.id} className="w-full h-full rounded-full text-xs" />
                                </div>
                                <span className="text-[#A0A0A0]">{s.number}. {s.name}</span>
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
// 村莊歷史 Modal (v2.2.0)
// ============================================

function HistoryModal({ allLogs, students, settings, onClose, onToggleStatus }) {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [expandedTask, setExpandedTask] = useState(null)

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const allHistoryTasks = useMemo(() => {
    const tasks = []
    allLogs.forEach(log => {
      const logDate = typeof log.date === 'string' ? log.date.split('T')[0] : formatDate(log.date)
      const logTasks = log.tasks || []
      const logStatus = log.status || {}

      logTasks.forEach(task => {
        const dueDate = getTaskDueDate(task, logDate)
        const createdAt = getTaskCreatedAt(task, logDate)

        if (dateFrom && dueDate < dateFrom) return
        if (dateTo && dueDate > dateTo) return
        if (filterType !== 'all' && task.type !== filterType) return

        const studentStatuses = students.map(s => {
          const statusValue = logStatus[s.id]?.[task.id]
          return { student: s, status: statusValue, visual: getStatusVisual(statusValue) }
        })

        tasks.push({
          ...task,
          logDate,
          dueDate,
          createdAt,
          studentStatuses,
          completedCount: studentStatuses.filter(ss => isDoneStatus(ss.status)).length,
          totalCount: students.length,
        })
      })
    })

    return tasks.sort((a, b) => new Date(b.dueDate) - new Date(a.dueDate))
  }, [allLogs, students, dateFrom, dateTo, filterType])

  const taskTypes = useMemo(() => {
    const types = new Set()
    allLogs.forEach(log => (log.tasks || []).forEach(t => t.type && types.add(t.type)))
    return Array.from(types)
  }, [allLogs])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#fdfbf7]">
      <div className="h-3 bg-gradient-to-r from-[#FFD6A5] to-[#A8D8B9]" />

      {/* Header */}
      <div className="px-6 py-4 border-b border-[#E8E8E8] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#FFD6A5] to-[#A8D8B9] flex items-center justify-center shadow-md">
            <ScrollText size={24} className="text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-[#5D5D5D]">村莊歷史</h2>
            <p className="text-sm text-[#8B8B8B]">查看與補登所有歷史任務紀錄</p>
          </div>
        </div>
        <button onClick={onClose} className="p-2 rounded-full hover:bg-[#E8E8E8] transition-colors">
          <X size={24} className="text-[#5D5D5D]" />
        </button>
      </div>

      {/* Filters */}
      <div className="px-6 py-3 border-b border-[#E8E8E8] flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <CalendarIcon size={18} className="text-[#8B8B8B]" />
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="px-3 py-1.5 rounded-lg border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-sm text-[#5D5D5D]" />
          <span className="text-[#8B8B8B]">~</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="px-3 py-1.5 rounded-lg border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-sm text-[#5D5D5D]" />
        </div>
        <div className="flex items-center gap-2 overflow-x-auto">
          <Filter size={18} className="text-[#8B8B8B] shrink-0" />
          <button onClick={() => setFilterType('all')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${filterType === 'all' ? 'bg-[#A8D8B9] text-white' : 'bg-[#E8E8E8] text-[#5D5D5D] hover:bg-[#D8D8D8]'}`}>
            全部
          </button>
          {taskTypes.map(type => (
            <button key={type} onClick={() => setFilterType(type)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${filterType === type ? 'bg-[#FFD6A5] text-white' : 'bg-[#E8E8E8] text-[#5D5D5D] hover:bg-[#D8D8D8]'}`}>
              {type}
            </button>
          ))}
        </div>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto p-6 space-y-3">
        {allHistoryTasks.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-4">📜</div>
            <p className="text-[#8B8B8B] text-lg">沒有符合條件的歷史紀錄</p>
          </div>
        ) : (
          allHistoryTasks.map((task, idx) => {
            const taskKey = `${task.logDate}-${task.id}`
            const isExpanded = expandedTask === taskKey
            const IconComponent = getTaskIcon(task.title)
            const allDone = task.completedCount === task.totalCount && task.totalCount > 0

            return (
              <div key={`${taskKey}-${idx}`} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <div
                  className="p-4 cursor-pointer hover:bg-[#F9F9F9] transition-colors"
                  onClick={() => setExpandedTask(isExpanded ? null : taskKey)}
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${allDone ? 'bg-[#A8D8B9]' : 'bg-[#FFD6A5]'}`}>
                      <IconComponent size={24} className="text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[#E8E8E8] text-[#5D5D5D]">
                          截止：{formatDateDisplay(task.dueDate)}
                        </span>
                        {task.createdAt !== task.dueDate && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-[#F0F0F0] text-[#8B8B8B]">
                            建立：{formatDateDisplay(task.createdAt)}
                          </span>
                        )}
                        {task.type && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-[#FFD6A5]/30 text-[#8B6914]">{task.type}</span>
                        )}
                      </div>
                      <h4 className="font-bold text-[#5D5D5D] truncate">{task.title}</h4>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`text-lg font-bold ${allDone ? 'text-[#7BC496]' : 'text-[#5D5D5D]'}`}>{task.completedCount}/{task.totalCount}</div>
                    </div>
                    <ChevronDown size={20} className={`text-[#8B8B8B] transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
                  </div>
                  {/* Progress bar */}
                  <div className="mt-3 h-2 bg-[#E8E8E8] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${task.totalCount > 0 ? (task.completedCount / task.totalCount) * 100 : 0}%`,
                        background: allDone ? 'linear-gradient(90deg, #A8D8B9, #7BC496)' : 'linear-gradient(90deg, #FFD6A5, #FFBF69)'
                      }}
                    />
                  </div>
                </div>

                {/* Expanded: student list with status edit */}
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-[#E8E8E8]">
                    <div className="mt-3 space-y-1.5 max-h-80 overflow-y-auto">
                      {task.studentStatuses.map(({ student, status, visual }) => {
                        const StatusIcon = visual.icon
                        return (
                          <div key={student.id} className={`flex items-center gap-3 p-2.5 rounded-xl ${visual.bg} border ${visual.border} transition-all`}>
                            <div className="w-8 h-8 rounded-full overflow-hidden shrink-0">
                              <AvatarEmoji seed={student.uuid || student.id} className="w-full h-full rounded-full text-sm" />
                            </div>
                            <span className="font-medium text-[#5D5D5D] flex-1 min-w-0 truncate">{student.number}. {student.name}</span>
                            {StatusIcon && <StatusIcon size={16} style={{ color: visual.color }} />}
                            <span className={`text-xs font-bold shrink-0 ${visual.text}`}>{visual.label || '未完成'}</span>
                            <div className="flex items-center gap-1 shrink-0">
                              <button onClick={() => onToggleStatus(student.id, task.id, STATUS_VALUES.ON_TIME, task.logDate)}
                                className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${normalizeStatus(status) === STATUS_VALUES.ON_TIME ? 'bg-[#7BC496] text-white' : 'bg-[#A8D8B9]/20 hover:bg-[#A8D8B9] text-[#4A7C59] hover:text-white'}`}
                                title="準時">
                                <Check size={14} />
                              </button>
                              <button onClick={() => onToggleStatus(student.id, task.id, STATUS_VALUES.LATE, task.logDate)}
                                className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${normalizeStatus(status) === STATUS_VALUES.LATE ? 'bg-[#FFBF69] text-white' : 'bg-[#FFD6A5]/20 hover:bg-[#FFD6A5] text-[#8B6914] hover:text-white'}`}
                                title="遲交">
                                <Clock size={14} />
                              </button>
                              <button onClick={() => onToggleStatus(student.id, task.id, STATUS_VALUES.MISSING, task.logDate)}
                                className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${normalizeStatus(status) === STATUS_VALUES.MISSING ? 'bg-[#D64545] text-white' : 'bg-[#FFADAD]/20 hover:bg-[#FFADAD] text-[#D64545] hover:text-white'}`}
                                title="未交">
                                <XCircle size={14} />
                              </button>
                              <button onClick={() => onToggleStatus(student.id, task.id, 'leave', task.logDate)}
                                className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${normalizeStatus(status) === STATUS_VALUES.LEAVE ? 'bg-[#8B8B8B] text-white' : 'bg-[#E8E8E8]/50 hover:bg-[#D8D8D8] text-[#8B8B8B]'}`}
                                title="請假">
                                <Clock size={14} />
                              </button>
                              <button onClick={() => onToggleStatus(student.id, task.id, 'exempt', task.logDate)}
                                className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${normalizeStatus(status) === STATUS_VALUES.EXEMPT ? 'bg-[#B8B8B8] text-white' : 'bg-[#F0F0F0]/50 hover:bg-[#E0E0E0] text-[#A0A0A0]'}`}
                                title="免交">
                                <Eye size={14} />
                              </button>
                              {isDoneStatus(status) && (
                                <button onClick={() => onToggleStatus(student.id, task.id, false, task.logDate)}
                                  className="w-7 h-7 rounded-full flex items-center justify-center bg-white/80 hover:bg-[#FFADAD]/20 text-[#D64545] transition-colors border border-[#E8E8E8]"
                                  title="清除狀態">
                                  <X size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
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

function TaskBoard({ tasks, students, studentStatus, onTasksUpdate, taskTypes, onOpenFocus, currentDateStr }) {
  const [showAddTask, setShowAddTask] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskType, setNewTaskType] = useState(taskTypes?.[0] || '作業')
  const [newTaskDueDate, setNewTaskDueDate] = useState(() => currentDateStr ? getNextDay(currentDateStr) : '')

  useEffect(() => {
    if (currentDateStr) setNewTaskDueDate(getNextDay(currentDateStr))
  }, [currentDateStr])

  const handleAddTask = async () => {
    if (!newTaskTitle.trim()) return
    const createdAt = currentDateStr || getTodayStr()
    const dueDate = newTaskDueDate || getNextDay(createdAt)
    const newTask = { id: `task_${Date.now()}`, title: newTaskTitle.trim(), type: newTaskType, createdAt, dueDate }
    const updatedTasks = [...tasks, newTask]

    if (onTasksUpdate) onTasksUpdate(updatedTasks)

    setNewTaskTitle('')
    setNewTaskType(taskTypes?.[0] || '作業')
    setNewTaskDueDate(currentDateStr ? getNextDay(currentDateStr) : '')
    setShowAddTask(false)
  }

  const handleDeleteTask = (taskId) => {
    const updatedTasks = tasks.filter(t => t.id !== taskId)
    if (onTasksUpdate) onTasksUpdate(updatedTasks)
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
            <div className="flex items-center gap-2">
              <label className="text-sm text-[#5D5D5D] font-medium shrink-0">截止日期</label>
              <input
                type="date"
                value={newTaskDueDate}
                onChange={(e) => setNewTaskDueDate(e.target.value)}
                min={currentDateStr}
                className="flex-1 px-4 py-2.5 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-[#5D5D5D]"
              />
            </div>
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
  const [customMin, setCustomMin] = useState(0)
  const [customSec, setCustomSec] = useState(0)
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

  const applyCustomTime = () => {
    const total = (parseInt(customMin, 10) || 0) * 60 + (parseInt(customSec, 10) || 0)
    if (total > 0) {
      setDuration(total)
      setRemaining(total)
      setTimeUp(false)
      setRunning(false)
    }
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
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
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

              {/* 自訂時間 */}
              <div className="flex items-center gap-2 w-full max-w-md justify-center">
                <span className="text-sm font-bold text-[#8B8B8B]">自訂</span>
                <input
                  type="number"
                  min="0"
                  max="99"
                  value={customMin}
                  onChange={e => setCustomMin(e.target.value)}
                  className="w-16 px-2 py-1.5 rounded-lg border-2 border-[#E8E8E8] text-center font-bold text-[#5D5D5D] focus:border-[#A8D8B9] focus:outline-none transition-colors"
                />
                <span className="text-sm font-bold text-[#5D5D5D]">分</span>
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={customSec}
                  onChange={e => setCustomSec(e.target.value)}
                  className="w-16 px-2 py-1.5 rounded-lg border-2 border-[#E8E8E8] text-center font-bold text-[#5D5D5D] focus:border-[#A8D8B9] focus:outline-none transition-colors"
                />
                <span className="text-sm font-bold text-[#5D5D5D]">秒</span>
                <button
                  onClick={applyCustomTime}
                  className="px-4 py-1.5 rounded-xl bg-[#A8D8B9] text-white font-bold text-sm hover:bg-[#7BC496] transition-all"
                >
                  設定
                </button>
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
                <div className={`draw-reel relative transition-all duration-500 ${winner ? 'border-4 border-[#FFBF69] shadow-2xl' : ''}`}>
                  {winner && <div className="confetti-layer" />}
                  <div className="relative z-10">
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

  const hasMissing = hasTasks && tasks.some(t => normalizeStatus(status[t.id]) === STATUS_VALUES.MISSING)

  const getBgStyle = () => {
    if (!hasTasks) return 'bg-[#F7F7F7] border-[#EBEBEB]'
    if (allDone) return 'bg-gradient-to-br from-[#EDF7EF] to-[#DFF0E3] border-[#B5DFBF]'
    if (hasMissing) return 'bg-gradient-to-br from-[#FFF0F0] to-[#FFE0E0] border-[#F0B5B5]'
    return 'bg-gradient-to-br from-[#FFF8F0] to-[#FFEDDA] border-[#F0D9B5]'
  }

  return (
    <div
      onClick={onClick}
      className={`relative ${getBgStyle()} rounded-xl 2xl:rounded-lg p-2.5 2xl:p-1.5 cursor-pointer group transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md border`}
    >
      {/* 座號標籤 */}
      <div className={`absolute -top-1.5 -left-1.5 w-6 h-6 2xl:w-5 2xl:h-5 rounded-md flex items-center justify-center text-white font-bold text-[10px] 2xl:text-[8px] shadow-sm z-10 ${
        allDone ? 'bg-[#7BC496]' : hasIncomplete ? 'bg-[#FFBF69]' : 'bg-[#C8C8C8]'
      }`}>
        {studentNumber || '?'}
      </div>

      {/* 欠交警示 */}
      {hasOverdue && (
        <div className="absolute -top-1 -right-1 w-5 h-5 2xl:w-4 2xl:h-4 rounded-full bg-[#D64545] flex items-center justify-center z-20 animate-pulse shadow-sm">
          <AlertCircle size={12} className="text-white" />
        </div>
      )}

      {/* 頭像區 */}
      <div className="relative w-full aspect-square mb-1.5 2xl:mb-1 rounded-lg overflow-hidden bg-white/60">
        <AvatarEmoji
          seed={student.uuid || student.id}
          className="w-full h-full rounded-lg text-5xl 2xl:text-3xl transition-transform duration-200 group-hover:scale-105"
        />

        {/* 完成狀態指示器 */}
        {hasTasks && (
          <div className="absolute bottom-1 right-1">
            {allDone ? (
              <div className="w-5 h-5 rounded-full bg-[#7BC496] flex items-center justify-center shadow-sm">
                <Check size={12} className="text-white" />
              </div>
            ) : (
              <div className="bg-white/90 backdrop-blur-sm text-[10px] px-1.5 py-0.5 rounded-md flex items-center gap-0.5 shadow-sm border border-black/5">
                <span className="font-bold text-[#FFBF69]">{completedCount}/{totalTasks}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 名字 */}
      <div className="text-center">
        <h3 className={`text-xs 2xl:text-[10px] font-bold truncate ${hasDefaultName ? 'text-[#C0C0C0] italic' : 'text-[#5D5D5D]'}`}>
          {student.name || '未命名'}
        </h3>
      </div>

      {/* 任務進度條 */}
      {hasTasks && !allDone && (
        <div className="mt-1.5 2xl:mt-1 h-1 bg-black/5 rounded-full overflow-hidden">
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

function PassportModal({ student, tasks, studentStatus, onClose, onToggleStatus, onStudentUpdate, hasOverdue, settings, allLogs, currentDateStr }) {
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
      const logTasks = log.tasks || []
      const logStatus = log.status?.[student.id] || {}
      logTasks.forEach(task => {
        const dueDate = getTaskDueDate(task, logDateStr)
        if (parseDate(dueDate) >= today) return
        if (!isDoneStatus(logStatus[task.id])) {
          items.push({ date: logDateStr, dueDate, task })
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
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
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
                const visual = getStatusVisual(statusValue)
                const StatusIcon = visual.icon

                return (
                  <div
                    key={task.id}
                    className={`flex items-center gap-4 p-4 rounded-2xl transition-all border-2 ${visual.bg} ${visual.border}`}
                  >
                    <div
                      onClick={() => onToggleStatus(student.id, task.id, isCompleted ? false : true)}
                      className="cursor-pointer flex items-center gap-3 flex-1 min-w-0"
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0`}
                        style={{ background: isCompleted ? visual.color : '#FFD6A5' }}>
                        <IconComponent size={18} className="text-white" />
                      </div>
                      <span className={`flex-1 font-medium ${isCompleted ? `${visual.text} line-through` : 'text-[#5D5D5D]'}`}>
                        {task.title}
                      </span>
                      {visual.label && StatusIcon && (
                        <span className={`text-xs px-2 py-1 rounded-full ${visual.bg} ${visual.text} font-bold flex items-center gap-1`}>
                          <StatusIcon size={12} />{visual.label}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleStatus(student.id, task.id, STATUS_VALUES.LATE); }}
                        className="px-2 py-1 text-xs rounded-lg bg-[#FFD6A5]/30 text-[#8B6914] hover:bg-[#FFD6A5] flex items-center gap-0.5"
                        title="遲交"
                      >
                        <Clock size={12} />遲交
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleStatus(student.id, task.id, STATUS_VALUES.MISSING); }}
                        className="px-2 py-1 text-xs rounded-lg bg-[#FFADAD]/30 text-[#D64545] hover:bg-[#FFADAD] flex items-center gap-0.5"
                        title="未交"
                      >
                        <XCircle size={12} />未交
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleStatus(student.id, task.id, 'leave'); }}
                        className="px-2 py-1 text-xs rounded-lg bg-[#E8E8E8] text-[#5D5D5D] hover:bg-[#D8D8D8]"
                      >
                        請假
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleStatus(student.id, task.id, 'exempt'); }}
                        className="px-2 py-1 text-xs rounded-lg bg-[#F0F0F0] text-[#A0A0A0] hover:bg-[#E0E0E0]"
                      >
                        免交
                      </button>
                    </div>
                  </div>
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
                        onClick={(e) => { e.stopPropagation(); onToggleStatus(student.id, item.task.id, STATUS_VALUES.LATE, item.date); }}
                        className="px-2 py-1 text-xs rounded-lg bg-[#FFD6A5]/30 text-[#8B6914] hover:bg-[#FFD6A5] flex items-center gap-0.5"
                      >
                        <Clock size={10} />補交
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleStatus(student.id, item.task.id, STATUS_VALUES.MISSING, item.date); }}
                        className="px-2 py-1 text-xs rounded-lg bg-[#FFADAD]/30 text-[#D64545] hover:bg-[#FFADAD]/50 flex items-center gap-0.5"
                      >
                        <XCircle size={10} />未交
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleStatus(student.id, item.task.id, 'leave', item.date); }}
                        className="px-2 py-1 text-xs rounded-lg bg-[#E8E8E8] text-[#5D5D5D] hover:bg-[#D8D8D8]"
                      >
                        請假
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleStatus(student.id, item.task.id, 'exempt', item.date); }}
                        className="px-2 py-1 text-xs rounded-lg bg-[#F0F0F0] text-[#A0A0A0] hover:bg-[#E0E0E0]"
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
// 設定 Modal (修復中文亂碼版)
// ============================================

function SettingsModal({ classId, className, settings, students, allLogs, onClose, onSave, onRestoreFromBackup, onClearLocalClass }) {
  const [localSettings, setLocalSettings] = useState({
    taskTypes: settings?.taskTypes || DEFAULT_SETTINGS.taskTypes,
    groupAliases: settings?.groupAliases || {}
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
        groupAliases: restored.settings?.groupAliases || prev.groupAliases
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
          groupAliases: restored.settings?.groupAliases || localSettings.groupAliases
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

function Header({ todayStr, completionRate, className, classAlias, onLogout, onOpenSettings, onOpenTeamManagement, onOpenTaskOverview, onOpenGadgets, onOpenHistory }) {
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
          <button onClick={onOpenTaskOverview} className="p-3 rounded-2xl bg-[#fdfbf7] hover:bg-[#A8D8B9]/20 transition-colors" title="任務總覽">
            <ListTodo size={22} className="text-[#5D5D5D]" />
          </button>
          <button onClick={onOpenHistory} className="p-3 rounded-2xl bg-[#fdfbf7] hover:bg-[#FFD6A5]/20 transition-colors" title="村莊歷史">
            <ScrollText size={22} className="text-[#5D5D5D]" />
          </button>
          <button onClick={onOpenGadgets} className="p-3 rounded-2xl bg-[#fdfbf7] hover:bg-[#A8D8B9]/20 transition-colors" title="課堂法寶">
            <Sparkles size={22} className="text-[#5D5D5D]" />
          </button>
          <button onClick={onOpenTeamManagement} className="p-3 rounded-2xl bg-[#fdfbf7] hover:bg-[#FFD6A5]/20 transition-colors" title="小隊管理">
            <Flag size={22} className="text-[#5D5D5D]" />
          </button>
          <button onClick={onOpenSettings} className="p-3 rounded-2xl bg-[#fdfbf7] hover:bg-[#FFD6A5]/20 transition-colors" title="村莊設定">
            <Settings size={22} className="text-[#5D5D5D]" />
          </button>
          <button onClick={onLogout} className="p-3 rounded-2xl bg-[#fdfbf7] hover:bg-[#FFADAD]/20 transition-colors" title="返回村莊列表">
            <LogOut size={22} className="text-[#5D5D5D]" />
          </button>
        </div>
      </div>
    </header>
  )
}

// ============================================
// 村莊儀表板 (Dashboard View)
// ============================================

function DashboardView({ classId, className, classAlias, onLogout, onClearLocalClass }) {
  const [students, setStudents] = useState([])
  const [allLogs, setAllLogs] = useState([])
  const allLogsRef = useRef(allLogs)
  useEffect(() => { allLogsRef.current = allLogs }, [allLogs])
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [selectedStudent, setSelectedStudent] = useState(null)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [showSettings, setShowSettings] = useState(false)
  const [showTeamManagement, setShowTeamManagement] = useState(false)
  const [showTaskOverview, setShowTaskOverview] = useState(false)
  const [showFocus, setShowFocus] = useState(false)
  const [showGadgets, setShowGadgets] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

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

  // v2.2.0: Cross-log task query by dueDate
  const { tasks, studentStatus } = useMemo(() => {
    const dateStr = formatDate(currentDate)
    const taskEntries = getTasksForDate(allLogs, dateStr, normalizeDate)

    const mergedTasks = taskEntries.map(({ task, logDate }) => ({
      ...task,
      id: task.id || `task_${Date.now()}`,
      _sourceLogDate: logDate,
    }))

    const mergedStatus = {}
    students.forEach(s => {
      mergedStatus[s.id] = {}
      taskEntries.forEach(({ task, logDate }) => {
        const log = allLogs.find(l => normalizeDate(l.date) === logDate)
        mergedStatus[s.id][task.id] = log?.status?.[s.id]?.[task.id]
      })
    })

    return { tasks: mergedTasks, studentStatus: mergedStatus }
  }, [allLogs, currentDate, normalizeDate, students])

  const completionRate = useMemo(() => {
    if (students.length === 0 || tasks.length === 0) return 0
    let completedChecks = 0
    students.forEach(s => tasks.forEach(t => { if (isDoneStatus(studentStatus[s.id]?.[t.id])) completedChecks++ }))
    return completedChecks / (students.length * tasks.length)
  }, [students, tasks, studentStatus])

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

  const handleDeleteTaskFromLog = useCallback((date, taskId) => {
    const normDate = normalizeDate(typeof date === 'string' ? date : formatDate(date))
    setAllLogs(prev => prev.map(log =>
      normalizeDate(log.date) === normDate
        ? { ...log, tasks: (log.tasks || []).filter(t => t.id !== taskId) }
        : log
    ))
  }, [normalizeDate])

  const toggleStatus = useCallback((studentId, taskId, checked, dateOverride) => {
    // Status 2.0: normalize true → on_time
    let newValue = checked
    if (checked === true) newValue = STATUS_VALUES.ON_TIME

    // v2.2.0: Resolve the source log date (where the task was created)
    let targetLogDate
    if (dateOverride) {
      targetLogDate = typeof dateOverride === 'string' ? dateOverride : formatDate(dateOverride)
    } else {
      // Find which log contains this task by scanning for dueDate match
      const currentDateStr = formatDate(currentDate)
      const entries = getTasksForDate(allLogsRef.current, currentDateStr, normalizeDate)
      const entry = entries.find(e => e.task.id === taskId)
      targetLogDate = entry ? entry.logDate : currentDateStr
    }
    const normDate = normalizeDate(targetLogDate)

    setAllLogs(prev => {
      const idx = prev.findIndex(l => normalizeDate(l.date) === normDate)
      if (idx >= 0) {
        const newLogs = [...prev]
        const currentStatus = newLogs[idx].status || {}
        newLogs[idx] = { ...newLogs[idx], status: { ...currentStatus, [studentId]: { ...currentStatus[studentId], [taskId]: newValue } } }
        return newLogs
      }
      const log = prev.find(l => normalizeDate(l.date) === normDate)
      return [...prev, { date: normDate, tasks: log?.tasks || [], status: { [studentId]: { [taskId]: newValue } } }]
    })
  }, [currentDate, normalizeDate])

  const checkOverdue = useCallback((studentId) => {
    const todayStr = getTodayStr()
    const today = parseDate(todayStr)

    for (const log of allLogs) {
      const logDateStr = normalizeDate(log.date)
      const logTasks = log.tasks || []
      const logStatus = log.status?.[studentId] || {}

      for (const task of logTasks) {
        const dueDate = getTaskDueDate(task, logDateStr)
        if (parseDate(dueDate) >= today) continue
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

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8 2xl:p-4 bg-[#fdfbf7]">
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
        onOpenHistory={() => setShowHistory(true)}
      />
      
      <div className="flex flex-col lg:flex-row gap-6 2xl:gap-4">
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
              onTasksUpdate={handleTasksUpdate}
              taskTypes={settings.taskTypes}
              onOpenFocus={() => setShowFocus(true)}
              currentDateStr={formatDate(currentDate)}
            />
          </div>
        </aside>

        <main className="flex-1 min-w-0">
          <div className="bg-white/60 backdrop-blur-sm rounded-3xl p-6 2xl:p-4 shadow-lg border border-white/50">
            <div className="flex items-center justify-between mb-6 2xl:mb-3">
              <h2 className="text-xl font-bold text-[#5D5D5D] flex items-center gap-2">
                <Users size={24} className="text-[#A8D8B9]" />村民廣場
              </h2>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#A8D8B9]/15">
                  <CheckCircle size={14} className="text-[#7BC496]" />
                  <span className="text-xs font-bold text-[#4A7C59]">{purrCount}</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#FFADAD]/15">
                  <Clock size={14} className="text-[#FF8A8A]" />
                  <span className="text-xs font-bold text-[#D64545]">{angryCount}</span>
                </div>
              </div>
            </div>

            {students.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-[#8B8B8B]">目前沒有村民資料</p>
              </div>
            ) : (
              <div className="space-y-5 2xl:space-y-3">
                {Object.entries(groupedStudents).map(([group, groupStudents], gi) => {
                  const rate = getGroupCompletionRate(groupStudents)
                  const isComplete = rate === 1 && tasks.length > 0
                  const groupName = settings.groupAliases?.[group] || `${group} 小隊`
                  const groupColors = ['#A8D8B9', '#FFD6A5', '#FFADAD', '#A0C4FF', '#BDB2FF', '#FDE2F3']
                  const accent = groupColors[gi % groupColors.length]

                  return (
                    <div
                      key={group}
                      className={`rounded-2xl overflow-hidden transition-all ${
                        isComplete
                          ? 'ring-2 ring-yellow-300 shadow-lg'
                          : 'shadow-sm'
                      }`}
                    >
                      {/* Group header bar */}
                      <div className={`px-4 py-3 2xl:px-3 2xl:py-2 flex items-center justify-between ${
                        isComplete
                          ? 'bg-gradient-to-r from-yellow-50 to-amber-50'
                          : 'bg-[#fdfbf7]'
                      }`}>
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{
                            background: isComplete ? '#FBBF24' : `${accent}30`
                          }}>
                            <Flag size={16} className={isComplete ? 'text-white' : ''} style={isComplete ? {} : { color: accent }} />
                          </div>
                          <h3 className="font-bold text-[#5D5D5D]">{groupName}</h3>
                          {isComplete && (
                            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-400/20 text-yellow-700 text-xs font-bold">
                              <Trophy size={12} />
                              全員達成
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2.5">
                          <div className="w-20 h-1.5 bg-black/5 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${rate * 100}%`,
                                background: isComplete
                                  ? 'linear-gradient(90deg, #FBBF24, #F59E0B)'
                                  : `linear-gradient(90deg, ${accent}, ${accent})`
                              }}
                            />
                          </div>
                          <span className="text-xs font-medium text-[#8B8B8B] w-8 text-right">{Math.round(rate * 100)}%</span>
                        </div>
                      </div>

                      {/* Student grid */}
                      <div className={`px-4 pb-4 pt-3 2xl:px-3 2xl:pb-3 2xl:pt-2 ${isComplete ? 'bg-gradient-to-b from-amber-50/50 to-white' : 'bg-white/40'}`}>
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-10 3xl:grid-cols-12 gap-3 2xl:gap-2">
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
          呼嚕嚕小鎮 Purr Purr Town v2.2.0 © 2026
          <PawPrint size={16} className="text-[#A8D8B9]" />
        </p>
      </footer>

      {/* Modals */}
      {selectedStudent && (
        <PassportModal
          student={selectedStudent}
          tasks={tasks}
          studentStatus={studentStatus}
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
        />
      )}
      
      {showTeamManagement && (
        <TeamManagementModal
          students={students}
          settings={settings}
          onClose={() => setShowTeamManagement(false)}
          onSave={handleTeamSave}
          onSettingsUpdate={setSettings}
        />
      )}
      
      {showTaskOverview && (
        <TaskOverviewModal
          allLogs={allLogs}
          students={students}
          settings={settings}
          onClose={() => setShowTaskOverview(false)}
          onNavigateToDate={setCurrentDate}
          onToggleStatus={toggleStatus}
          onDeleteTask={handleDeleteTaskFromLog}
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

      {showHistory && (
        <HistoryModal
          allLogs={allLogs}
          students={students}
          settings={settings}
          onClose={() => setShowHistory(false)}
          onToggleStatus={toggleStatus}
        />
      )}
    </div>
  )
}

// ============================================
// 主應用程式 (App)
// ============================================

function App() {
  const [localClasses, setLocalClasses] = useState(() => loadLocalClasses())
  const [selectedClass, setSelectedClass] = useState(null)
  const [hasStarted, setHasStarted] = useState(false)

  const handleLocalMode = () => {
    setHasStarted(true)
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
        localClasses={localClasses}
        onCreateLocalClass={handleCreateLocalClass}
        onSelectClass={handleSelectClass}
      />
    )
  }

  return (
    <DashboardView
      classId={selectedClass.id}
      className={selectedClass.name}
      classAlias={selectedClass.alias}
      onLogout={() => setSelectedClass(null)}
      onClearLocalClass={handleClearLocalClass}
    />
  )
}

export default App
