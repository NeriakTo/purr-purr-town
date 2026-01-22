import { useState, useEffect, useCallback, useMemo } from 'react'
import Calendar from 'react-calendar'
import 'react-calendar/dist/Calendar.css'
import { format } from 'date-fns'
import {
  PawPrint,
  BookOpen,
  AlertTriangle,
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
  Unplug
} from 'lucide-react'

// ============================================
// 常數與工具函數
// ============================================

// 注意：v2.1 已移除全域 API_URL，改由 Props 傳遞

// 使用 date-fns 處理日期
function getTodayStr() {
  return format(new Date(), 'yyyy-MM-dd')
}

function formatDateDisplay(dateStr) {
  return dateStr.replace(/-/g, '/')
}

// 日期字串轉 Date 物件
function parseDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day)
}

// Date 物件轉日期字串
function formatDate(date) {
  return format(date, 'yyyy-MM-dd')
}

// 根據任務名稱決定 Icon
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

// DiceBear 頭像 URL (notionists 風格)
function getAvatarUrl(uuid) {
  const colors = ['b6e3f4', 'ffd5dc', 'ffdfbf', 'e0d4ff', 'd1f4e0', 'fff4c4']
  const color = colors[parseInt(uuid?.slice(-1) || '0', 16) % colors.length]
  return `https://api.dicebear.com/7.x/notionists/svg?seed=${uuid}&backgroundColor=${color}`
}

// 檢查是否為預設姓名
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
        <h2 className="text-2xl font-bold text-[#5D5D5D] mb-2">
          {message}
        </h2>
        <p className="text-[#8B8B8B] flex items-center justify-center gap-2">
          <Loader2 size={16} className="animate-spin" />
          載入中
        </p>
      </div>

      <div className="absolute bottom-8 flex items-center gap-2 text-[#A8D8B9]">
        <PawPrint size={20} />
        <span className="text-sm font-medium">Purr Purr Town v2.1</span>
        <PawPrint size={20} />
      </div>
    </div>
  )
}

// ============================================
// 歡迎連結頁面 (WelcomeView) - BYOB 核心
// ============================================

function WelcomeView({ onConnect }) {
  const [inputUrl, setInputUrl] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState(null)

  const handleConnect = async (e) => {
    e.preventDefault()
    if (!inputUrl.trim()) return

    try {
      setChecking(true)
      setError(null)
      
      // 測試連線
      const testUrl = `${inputUrl.trim()}?action=get_classes`
      const response = await fetch(testUrl)
      
      if (!response.ok) {
        throw new Error('無法連線到此網址')
      }

      // 嘗試解析資料確認格式正確
      const data = await response.json()
      if (!data || !data.classes) {
        throw new Error('資料格式不符，請確認是否為呼嚕嚕小鎮專用範本')
      }

      // 連線成功
      onConnect(inputUrl.trim())

    } catch (err) {
      console.error(err)
      setError('連線失敗：請檢查網址是否正確，或確認權限已設為「任何人」')
    } finally {
      setChecking(false)
    }
  }

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
            <p className="text-[#B8B8B8] text-xs">Dev Mode</p>
            <p className="text-[#8B8B8B] text-sm">
              這裡是一個安全、去中心化的班級管理工具。<br/>
              資料由您自行保管，請連結您的村莊資料庫。
            </p>
          </div>

          <form onSubmit={handleConnect} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#5D5D5D] mb-2 ml-1">
                Google Apps Script 網址
              </label>
              <div className="relative">
                <input
                  type="url"
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
                  placeholder="https://script.google.com/..."
                  className="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none transition-all text-[#5D5D5D] bg-[#F9F9F9]"
                  required
                />
                <Link size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#B8B8B8]" />
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-[#FFADAD]/20 text-[#D64545] text-xs flex items-start gap-2">
                <WifiOff size={14} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={checking || !inputUrl}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#A8D8B9] to-[#7BC496] text-white font-bold shadow-md hover:shadow-lg active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {checking ? <Loader2 size={20} className="animate-spin" /> : <Sparkles size={20} />}
              開始連結村莊
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-[#E8E8E8]">
            <h3 className="text-xs font-bold text-[#8B8B8B] mb-3 uppercase tracking-wider text-center">
              還沒有資料庫嗎？
            </h3>
            <div className="space-y-3">
              <div className="flex items-start gap-3 text-sm text-[#5D5D5D]">
                <div className="w-6 h-6 rounded-full bg-[#FFD6A5] text-white flex items-center justify-center shrink-0 font-bold text-xs">1</div>
                <p>複製我們提供的 <a href="#" className="text-[#A8D8B9] font-bold hover:underline">Google Sheet 範本</a></p>
              </div>
              <div className="flex items-start gap-3 text-sm text-[#5D5D5D]">
                <div className="w-6 h-6 rounded-full bg-[#FFD6A5] text-white flex items-center justify-center shrink-0 font-bold text-xs">2</div>
                <p>在擴充功能中部署 Apps Script (權限選 Anyone)</p>
              </div>
              <div className="flex items-start gap-3 text-sm text-[#5D5D5D]">
                <div className="w-6 h-6 rounded-full bg-[#FFD6A5] text-white flex items-center justify-center shrink-0 font-bold text-xs">3</div>
                <p>將產生的網址貼到上方欄位</p>
              </div>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-6 text-[#B8B8B8] text-xs">Purr Purr Town v2.1 • BYOB Architecture</p>
    </div>
  )
}

// ============================================
// 建立班級 Modal 元件
// ============================================

function CreateClassModal({ onClose, onSuccess, apiUrl }) {
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
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" style={{ animation: 'fadeIn 0.3s ease-out' }} />
      <div
        className="relative bg-[#fdfbf7] rounded-3xl shadow-2xl max-w-md w-full overflow-hidden"
        style={{ animation: 'popIn 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-3" style={{ background: 'repeating-linear-gradient(90deg, #A8D8B9, #A8D8B9 20px, #FFD6A5 20px, #FFD6A5 40px)' }} />
        <button
          onClick={onClose}
          disabled={submitting}
          className="absolute top-6 right-4 p-2 rounded-full bg-white/80 hover:bg-white shadow-md transition-all hover:scale-110 z-10 disabled:opacity-50"
        >
          <X size={20} className="text-[#5D5D5D]" />
        </button>

        <div className="p-6">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4" style={{ background: 'linear-gradient(135deg, #FFD6A5 0%, #FFBF69 100%)' }}>
              <Home size={32} className="text-white" />
            </div>
            <h2 className="text-2xl font-bold text-[#5D5D5D]">🏠 建立新村莊</h2>
          </div>

          {submitError && (
            <div className="mb-4 p-3 rounded-xl bg-[#FFADAD]/20 text-[#D64545] text-sm text-center">{submitError}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-[#5D5D5D] mb-2"><CalendarIcon size={16} className="text-[#A8D8B9]" />學年度</label>
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
              <label className="flex items-center gap-2 text-sm font-medium text-[#5D5D5D] mb-2"><School size={16} className="text-[#FFD6A5]" />班級名稱</label>
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
              <label className="flex items-center gap-2 text-sm font-medium text-[#5D5D5D] mb-2"><User size={16} className="text-[#FFADAD]" />村長姓名</label>
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
              <label className="flex items-center gap-2 text-sm font-medium text-[#5D5D5D] mb-2"><Sparkles size={16} className="text-[#FFD6A5]" />村莊別名 <span className="text-xs text-[#8B8B8B] font-normal">(選填)</span></label>
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
              <label className="flex items-center gap-2 text-sm font-medium text-[#5D5D5D] mb-2"><Users size={16} className="text-[#A8D8B9]" />預設村民人數</label>
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
              className="w-full mt-6 py-4 rounded-2xl bg-gradient-to-r from-[#A8D8B9] to-[#7BC496] text-white font-bold text-lg shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? <><Loader2 size={22} className="animate-spin" />建立中...</> : <><Plus size={22} />建立村莊<Sparkles size={18} /></>}
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

function LoginView({ onSelectClass, loading, error, apiUrl, onDisconnect }) {
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
    fetchClasses()
  }, [fetchClasses])

  const handleCreateSuccess = () => {
    setShowCreateModal(false)
    fetchClasses()
  }

  if (loadingClasses) {
    return <LoadingScreen message="正在載入村莊列表..." />
  }

  return (
    <div className="min-h-screen bg-[#fdfbf7] p-6 md:p-10">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 text-6xl opacity-10 animate-float">🏠</div>
        <div className="absolute bottom-20 left-1/4 text-4xl opacity-10 animate-float">🐱</div>
      </div>

      <div className="max-w-4xl mx-auto relative z-10">
        {/* Header with Disconnect Button */}
        <div className="flex justify-end mb-4">
           <button 
             onClick={onDisconnect}
             className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/50 text-[#8B8B8B] hover:bg-[#FFADAD]/20 hover:text-[#D64545] transition-colors text-sm font-medium"
           >
             <Unplug size={16} />
             斷開資料庫連結
           </button>
        </div>

        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-24 h-24 rounded-3xl mb-6 shadow-xl bg-gradient-to-br from-[#A8D8B9] to-[#7BC496]">
            <PawPrint size={48} className="text-white" />
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-[#5D5D5D] mb-4">🐾 呼嚕嚕小鎮</h1>
          <p className="text-[#8B8B8B] text-lg">選擇您要進入的村莊</p>
        </div>

        <div className="flex justify-center mb-8">
          <button
            onClick={() => setShowCreateModal(true)}
            className="group flex items-center gap-3 px-6 py-4 rounded-2xl bg-gradient-to-r from-[#FFD6A5] to-[#FFBF69] text-white font-bold text-lg shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all duration-300"
          >
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center group-hover:rotate-90 transition-transform duration-300">
              <Plus size={24} />
            </div>
            🏠 建立新村莊
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-2xl bg-[#FFADAD]/20 text-[#D64545] flex items-center gap-3 justify-center">
            <WifiOff size={20} /><span>{error}</span>
          </div>
        )}

        {classes.length === 0 ? (
          <div className="text-center py-16 bg-white/60 rounded-3xl shadow-lg">
            <div className="text-6xl mb-4">🏚️</div>
            <p className="text-[#8B8B8B] text-lg">目前沒有可用的村莊</p>
            <p className="text-[#B8B8B8] text-sm mt-2">點擊上方按鈕建立你的第一個村莊吧！</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {classes.map((cls, index) => {
              const displayName = cls.alias || cls.name || `班級 ${cls.id}`
              const fullClassName = cls.year && cls.name ? `${cls.year}學年 ${cls.name}` : cls.name || ''

              return (
                <button
                  key={cls.id}
                  onClick={() => onSelectClass(cls.id, displayName, cls.alias)}
                  disabled={loading}
                  className="group bg-white rounded-3xl p-6 shadow-lg border-2 border-transparent hover:border-[#A8D8B9] hover:shadow-xl transition-all duration-300 hover:-translate-y-2 disabled:opacity-50 disabled:cursor-not-allowed text-left animate-slide-up"
                  style={{ animationDelay: `${index * 0.1}s` }}
                >
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform" style={{ background: `linear-gradient(135deg, ${index % 3 === 0 ? '#A8D8B9, #7BC496' : index % 3 === 1 ? '#FFD6A5, #FFBF69' : '#FFADAD, #FF8A8A'})` }}>
                    <School size={32} className="text-white" />
                  </div>
                  <h3 className="text-xl font-bold text-[#5D5D5D] mb-1">{displayName}</h3>
                  {cls.alias && fullClassName && <p className="text-[#A8D8B9] text-sm font-medium mb-2">{fullClassName}</p>}
                  <p className="text-[#8B8B8B] text-sm mb-4">
                    {cls.teacher && <span>村長：{cls.teacher}</span>}
                    {cls.teacher && cls.studentCount !== undefined && <span> · </span>}
                    {cls.studentCount !== undefined && <span>{cls.studentCount} 位村民</span>}
                  </p>
                  <div className="flex items-center gap-2 text-[#A8D8B9] font-medium group-hover:gap-3 transition-all">
                    <span>進入村莊</span><ChevronRight size={18} className="group-hover:translate-x-1 transition-transform" />
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {showCreateModal && (
        <CreateClassModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={handleCreateSuccess}
          apiUrl={apiUrl}
        />
      )}
    </div>
  )
}

// ============================================
// 村莊日誌 (Calendar Nav)
// ============================================

function CalendarNav({ currentDate, onDateChange }) {
  const todayStr = getTodayStr()
  return (
    <div className="react-calendar-container">
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
    </div>
  )
}

// ============================================
// 任務板元件
// ============================================

function TaskBoard({ tasks, students, studentStatus, classId, currentDateStr, onTasksUpdate, taskTypes, compact, apiUrl }) {
  const [showAddTask, setShowAddTask] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskType, setNewTaskType] = useState(taskTypes?.[0] || '作業')

  const handleAddTask = async () => {
    if (!newTaskTitle.trim()) return
    const newTask = { id: `task_${Date.now()}`, title: newTaskTitle.trim(), type: newTaskType }
    const updatedTasks = [...tasks, newTask]
    
    if (onTasksUpdate) onTasksUpdate(updatedTasks)

    fetch(apiUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'save_tasks', classId, date: currentDateStr, tasks: updatedTasks })
    }).catch(err => console.error('發布任務失敗:', err))

    setNewTaskTitle('')
    setNewTaskType(taskTypes?.[0] || '作業')
    setShowAddTask(false)
  }

  const getTaskCompletion = (taskId) => {
    const completed = students.filter(s => studentStatus[s.id]?.[taskId] === true).length
    return { completed, total: students.length }
  }

  return (
    <div>
      <h2 className="text-lg font-bold text-[#5D5D5D] mb-4 flex items-center gap-2">
        <ClipboardList size={20} className="text-[#A8D8B9]" />📝 今日島務
      </h2>
      <div className="rounded-2xl p-4 shadow-md relative overflow-hidden cork-texture border-4 border-[#8B7355] shadow-[inset_0_2px_10px_rgba(0,0,0,0.2),0_10px_40px_rgba(139,115,85,0.4)]">
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-b from-white/20 to-transparent" />
        {['top-3 left-3', 'top-3 right-3'].map((pos, i) => (
          <div key={i} className={`absolute ${pos} w-5 h-5 rounded-full shadow-md bg-gradient-to-br from-[#FFD700] to-[#B8860B]`} />
        ))}

        <div className="flex items-center justify-between mb-4">
          {!showAddTask && (
            <button
              onClick={() => setShowAddTask(true)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#A8D8B9] text-white text-sm font-medium hover:bg-[#7BC496] transition-all shadow-md"
            >
              <Plus size={16} />發布任務
            </button>
          )}
        </div>

        {showAddTask && (
          <div className="mb-4 p-4 bg-white/90 rounded-2xl shadow-md space-y-3">
            <input
              type="text"
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleAddTask()}
              placeholder="輸入任務名稱..."
              className="w-full px-4 py-2 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-[#5D5D5D]"
              autoFocus
            />
            <select
              value={newTaskType}
              onChange={(e) => setNewTaskType(e.target.value)}
              className="w-full px-4 py-2 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none bg-white text-[#5D5D5D]"
            >
              {taskTypes?.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
            <div className="flex gap-2">
              <button onClick={handleAddTask} className="flex-1 px-4 py-2 rounded-xl bg-gradient-to-r from-[#A8D8B9] to-[#7BC496] text-white font-medium">儲存</button>
              <button onClick={() => setShowAddTask(false)} className="px-4 py-2 rounded-xl bg-[#E8E8E8] text-[#5D5D5D] font-medium">取消</button>
            </div>
          </div>
        )}

        {tasks.length === 0 ? (
          <div className="text-center py-8 bg-white/30 rounded-2xl">
            <div className="text-4xl mb-3">😸</div>
            <p className="text-[#6B5344] font-medium">今日暫無委託</p>
          </div>
        ) : (
          <div className="space-y-3">
            {tasks.map((task, index) => {
              const IconComponent = getTaskIcon(task.title)
              const { completed, total } = getTaskCompletion(task.id)
              const isAllDone = completed === total && total > 0

              return (
                <div key={task.id} className="bg-white/90 backdrop-blur rounded-2xl p-4 shadow-md transition-all duration-300 hover:scale-[1.02]" style={{ transform: `rotate(${index % 2 === 0 ? -1 : 1}deg)` }}>
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isAllDone ? 'bg-[#A8D8B9]' : 'bg-[#FFD6A5]'}`}>
                      <IconComponent size={20} className="text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className={`font-bold text-[#5D5D5D] ${isAllDone ? 'line-through opacity-60' : ''}`}>{task.title}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 h-2 bg-[#E8E8E8] rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-500" style={{ width: total > 0 ? `${(completed / total) * 100}%` : '0%', backgroundColor: isAllDone ? '#A8D8B9' : '#FFD6A5' }} />
                        </div>
                        <span className="text-xs text-[#8B8B8B] whitespace-nowrap">{completed}/{total}</span>
                      </div>
                    </div>
                    <div className="text-lg">{isAllDone ? '✅' : '⏳'}</div>
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
// 村民卡片 & 設定 & 護照 (共用組件)
// ============================================

function VillagerCard({ student, tasks, studentStatus, onClick }) {
  const status = studentStatus[student.id] || {}
  const hasTasks = tasks.length > 0
  const isAngry = hasTasks && tasks.some(t => status[t.id] !== true)
  const isPurr = hasTasks && tasks.every(t => status[t.id] === true)
  const isIdle = !hasTasks
  
  const studentNumber = student.number || student.seatNumber
  const hasDefaultName = isDefaultName(student.name, studentNumber)
  const rotation = ((student.id || 0) % 7) - 3

  return (
    <div
      onClick={onClick}
      className={`relative bg-white rounded-xl p-2 cursor-pointer group transition-all duration-300 ease-out hover:scale-105 hover:-translate-y-1 ${isAngry ? 'shadow-md shadow-[#FFADAD]/30' : isPurr ? 'shadow-md shadow-[#A8D8B9]/30' : 'shadow-md shadow-[#E8E8E8]/30'}`}
      style={{ transform: `rotate(${rotation}deg)` }}
    >
      <div className={`absolute -top-1 -left-1 w-6 h-6 rounded-full flex items-center justify-center text-white font-bold text-xs shadow-sm z-10 ${isAngry ? 'bg-[#FF8A8A]' : isPurr ? 'bg-[#7BC496]' : 'bg-[#B8B8B8]'}`}>
        {studentNumber || '?'}
      </div>
      <div className={`absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full z-10 shadow-sm ${isIdle ? 'bg-[#E8E8E8]' : isAngry ? 'bg-[#FFADAD]' : 'bg-[#A8D8B9]'}`} />

      <div className={`relative w-12 h-12 mx-auto rounded-lg overflow-hidden mb-1.5 ${isAngry ? 'bg-gradient-to-br from-[#FFADAD]/20 to-[#FF8A8A]/10' : isPurr ? 'bg-gradient-to-br from-[#A8D8B9]/20 to-[#7BC496]/10' : 'bg-gradient-to-br from-[#E8E8E8]/20 to-[#D8D8D8]/10'}`}>
        <img src={getAvatarUrl(student.uuid || student.id)} alt={student.name} className={`w-full h-full object-cover transition-all duration-300 group-hover:scale-110 ${isAngry ? 'grayscale-[50%] opacity-80' : isIdle ? 'opacity-60' : ''}`} />
      </div>

      <div className="text-center">
        <h3 className={`text-sm font-bold truncate ${hasDefaultName ? 'text-[#B8B8B8] italic' : 'text-[#5D5D5D]'}`}>
          {student.name || `未命名`}{hasDefaultName && '⚠️'}
        </h3>
      </div>
    </div>
  )
}

function SettingsModal({ classId, settings, onClose, onSave, apiUrl }) {
  const [localSettings, setLocalSettings] = useState({ taskTypes: settings?.taskTypes || ['作業', '訂正', '攜帶物品', '考試', '通知單', '回條'] })
  const [newTaskType, setNewTaskType] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    try {
      setSaving(true)
      fetch(apiUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'save_settings', classId, settings: localSettings })
      }).catch(err => console.error(err))
      if (onSave) onSave(localSettings)
      onClose()
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in" />
      <div className="relative bg-[#fdfbf7] rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden animate-pop-in">
        <div className="h-3" style={{ background: 'repeating-linear-gradient(90deg, #A8D8B9, #A8D8B9 20px, #FFD6A5 20px, #FFD6A5 40px)' }} />
        <button onClick={onClose} disabled={saving} className="absolute top-6 right-4 p-2 rounded-full bg-white/80 hover:bg-white shadow-md transition-all z-10"><X size={20} className="text-[#5D5D5D]" /></button>
        <div className="p-6">
          <div className="text-center mb-6"><h2 className="text-2xl font-bold text-[#5D5D5D]">⚙️ 村莊設定</h2></div>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 mb-4">
              {localSettings.taskTypes.map(type => (
                <div key={type} className="flex items-center gap-2 px-3 py-1.5 rounded-xl border-2 bg-gray-100 text-gray-700 border-gray-300">
                  <span className="text-sm font-medium">{type}</span>
                  <button onClick={() => setLocalSettings(p => ({...p, taskTypes: p.taskTypes.filter(t => t !== type)}))}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input type="text" value={newTaskType} onChange={e => setNewTaskType(e.target.value)} className="flex-1 px-4 py-2 rounded-xl border-2 border-[#E8E8E8]" placeholder="新標籤..." />
              <button onClick={() => { if(newTaskType) { setLocalSettings(p => ({...p, taskTypes: [...p.taskTypes, newTaskType]})); setNewTaskType('') } }} className="px-4 py-2 rounded-xl bg-[#A8D8B9] text-white"><Plus /></button>
            </div>
          </div>
          <div className="mt-6 flex gap-3">
            <button onClick={handleSave} disabled={saving} className="flex-1 py-3 rounded-xl bg-gradient-to-r from-[#A8D8B9] to-[#7BC496] text-white font-medium">{saving ? '儲存中...' : '儲存設定'}</button>
            <button onClick={onClose} disabled={saving} className="px-4 py-3 rounded-xl bg-[#E8E8E8] text-[#5D5D5D]">取消</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function PassportModal({ student, tasks, studentStatus, classId, onClose, onToggleStatus, onStudentUpdate, apiUrl }) {
  const [isEditMode, setIsEditMode] = useState(false)
  const [editData, setEditData] = useState({ name: student.name || '', gender: student.gender || 'male', group: student.group || 'A' })
  const status = studentStatus[student.id] || {}
  const hasTasks = tasks.length > 0
  const isAllDone = hasTasks && tasks.every(t => status[t.id] === true)
  const completedCount = tasks.filter(t => status[t.id] === true).length

  const saveEdit = () => {
    if (!editData.name.trim()) return
    const updatedStudent = { ...student, id: student.id || student.uuid, name: editData.name.trim(), group: editData.group, gender: editData.gender }
    if (onStudentUpdate) onStudentUpdate(updatedStudent)
    setIsEditMode(false)
    onClose()
    fetch(apiUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'update_student', classId, uuid: student.uuid || student.id, name: editData.name.trim(), group: editData.group, gender: editData.gender })
    }).catch(console.error)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in" />
      <div className="relative bg-[#fdfbf7] rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden animate-pop-in">
        <div className="h-3" style={{ background: 'repeating-linear-gradient(90deg, #A8D8B9, #A8D8B9 20px, #FFD6A5 20px, #FFD6A5 40px)' }} />
        <button onClick={onClose} className="absolute top-6 right-4 p-2 rounded-full bg-white/80 hover:bg-white shadow-md z-10"><X size={20} className="text-[#5D5D5D]" /></button>
        <div className="p-6">
          <div className="flex items-start gap-6 mb-6">
            <div className={`w-28 h-28 rounded-3xl overflow-hidden shadow-lg shrink-0 ring-4 ${isAllDone ? 'ring-[#A8D8B9]' : 'ring-[#FFADAD]'}`}>
              <img src={getAvatarUrl(student.uuid || student.id)} alt={student.name} className="w-full h-full object-cover" />
            </div>
            <div className="flex-1">
              {isEditMode ? (
                <div className="space-y-3">
                  <input type="text" value={editData.name} onChange={e => setEditData(p => ({...p, name: e.target.value}))} className="w-full px-3 py-2 rounded-xl border-2 border-[#E8E8E8]" />
                  <div className="flex gap-2">
                    <button onClick={saveEdit} className="flex-1 bg-[#A8D8B9] text-white py-2 rounded-xl">儲存</button>
                    <button onClick={() => setIsEditMode(false)} className="bg-[#E8E8E8] text-[#5D5D5D] px-4 py-2 rounded-xl">取消</button>
                  </div>
                </div>
              ) : (
                <>
                  <h3 className="text-2xl font-bold mb-1 text-[#5D5D5D]">{student.name}</h3>
                  <button onClick={() => { setEditData({ name: student.name, gender: student.gender, group: student.group }); setIsEditMode(true) }} className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#FFD6A5]/30 text-[#8B6914] text-sm font-medium"><Pencil size={14} />編輯資料</button>
                </>
              )}
            </div>
          </div>
          <div className="space-y-3 max-h-48 overflow-y-auto pr-2">
            {tasks.map(task => (
              <label key={task.id} className={`flex items-center gap-4 p-4 rounded-2xl cursor-pointer ${status[task.id] === true ? 'bg-[#A8D8B9]/20 border-2 border-[#A8D8B9]' : 'bg-white border-2 border-transparent hover:border-[#FFD6A5]'}`}>
                <input type="checkbox" checked={status[task.id] === true} onChange={e => onToggleStatus(student.id, task.id, e.target.checked)} className="sr-only" />
                <div className={`w-7 h-7 rounded-lg border-2 flex items-center justify-center ${status[task.id] === true ? 'bg-[#A8D8B9] border-[#7BC496]' : 'bg-white border-[#E8E8E8]'}`}>{status[task.id] === true && <CheckCircle size={18} className="text-white" />}</div>
                <span className="flex-1 font-medium text-[#5D5D5D]">{task.title}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================
// Header 元件
// ============================================

function Header({ todayStr, completionRate, error, className, classAlias, onLogout, onOpenSettings, onDisconnect }) {
  const displayName = classAlias || className
  return (
    <header className="bg-white/80 backdrop-blur-md rounded-3xl p-4 md:p-5 mb-6 shadow-lg border border-white/50">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#A8D8B9] to-[#7BC496] flex items-center justify-center shadow-md"><PawPrint size={28} className="text-white" /></div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-[#5D5D5D] flex items-center gap-2">🐾 {displayName || '呼嚕嚕小鎮'}</h1>
            <p className="text-xs md:text-sm text-[#8B8B8B]">{formatDateDisplay(todayStr)}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 bg-[#fdfbf7] px-4 py-2 rounded-2xl">
            <div className="hidden sm:block"><span className="text-xs text-[#8B8B8B]">達成率</span><div className="text-lg font-bold text-[#5D5D5D]">{Math.round(completionRate * 100)}%</div></div>
            <div className="w-24 md:w-32 h-3 bg-[#E8E8E8] rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500 ease-out" style={{ width: `${completionRate * 100}%`, background: completionRate >= 0.8 ? '#7BC496' : '#FFBF69' }} />
            </div>
          </div>
          <button onClick={onOpenSettings} className="p-3 rounded-2xl bg-[#fdfbf7] hover:bg-[#FFD6A5]/20"><Settings size={22} className="text-[#5D5D5D]" /></button>
          <button onClick={onLogout} className="p-3 rounded-2xl bg-[#fdfbf7] hover:bg-[#FFADAD]/20" title="返回村莊列表"><LogOut size={22} className="text-[#5D5D5D]" /></button>
          <button onClick={onDisconnect} className="p-3 rounded-2xl bg-[#fdfbf7] hover:bg-[#FFADAD]/20 text-[#D64545]" title="斷開資料庫"><Unplug size={22} /></button>
        </div>
      </div>
    </header>
  )
}

// ============================================
// 村莊儀表板 (Dashboard View)
// ============================================

function DashboardView({ classId, className, classAlias, onLogout, apiUrl, onDisconnect }) {
  const [students, setStudents] = useState([])
  const [allLogs, setAllLogs] = useState([])
  const [settings, setSettings] = useState({ taskTypes: ['作業', '訂正', '攜帶物品', '考試', '通知單', '回條'] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedStudent, setSelectedStudent] = useState(null)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [showSettings, setShowSettings] = useState(false)

  const normalizeDate = useCallback((date) => {
    if (typeof date === 'string') {
      try { return formatDate(new Date(date)) } catch { return date.split('T')[0] }
    }
    return formatDate(date)
  }, [])

  const { tasks, studentStatus } = useMemo(() => {
    const dateStr = formatDate(currentDate)
    const log = allLogs.find(log => normalizeDate(log.date) === dateStr)
    return log ? { tasks: (log.tasks || []).map((t, i) => ({...t, id: t.id || `task_${i}`})), studentStatus: log.status || {} } : { tasks: [], studentStatus: {} }
  }, [allLogs, currentDate, normalizeDate])

  const completionRate = useMemo(() => {
    if (students.length === 0 || tasks.length === 0) return 0
    let completedChecks = 0
    students.forEach(s => tasks.forEach(t => { if (studentStatus[s.id]?.[t.id] === true) completedChecks++ }))
    return completedChecks / (students.length * tasks.length)
  }, [students, tasks, studentStatus])

  const fetchAllData = useCallback(async () => {
    if (!apiUrl || !classId) return
    try {
      setLoading(true)
      const response = await fetch(`${apiUrl}?action=get_class_data_all&classId=${classId}`)
      if (!response.ok) throw new Error('API Error')
      const data = await response.json()
      
      const normStudents = (data.students || []).map((s, i) => ({...s, id: s.id || s.uuid || `student_${i}`}))
      const normLogs = (data.logs || []).map(log => ({...log, date: normalizeDate(log.date)}))
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

  const handleTasksUpdate = useCallback((updatedTasks) => {
    const dateStr = formatDate(currentDate)
    const normDate = normalizeDate(dateStr)
    setAllLogs(prev => {
      const idx = prev.findIndex(l => normalizeDate(l.date) === normDate)
      if (idx >= 0) { const newLogs = [...prev]; newLogs[idx] = { ...newLogs[idx], tasks: updatedTasks }; return newLogs }
      return [...prev, { date: normDate, tasks: updatedTasks, status: {} }]
    })
    fetch(apiUrl, { method: 'POST', mode: 'no-cors', headers: {'Content-Type': 'text/plain'}, body: JSON.stringify({ action: 'save_tasks', classId, date: dateStr, tasks: updatedTasks }) }).catch(console.error)
  }, [currentDate, classId, apiUrl, normalizeDate])

  const toggleStatus = useCallback((studentId, taskId, checked) => {
    const dateStr = formatDate(currentDate)
    const normDate = normalizeDate(dateStr)
    setAllLogs(prev => {
      const idx = prev.findIndex(l => normalizeDate(l.date) === normDate)
      if (idx >= 0) {
        const newLogs = [...prev]
        const currentStatus = newLogs[idx].status || {}
        newLogs[idx] = { ...newLogs[idx], status: { ...currentStatus, [studentId]: { ...currentStatus[studentId], [taskId]: checked } } }
        return newLogs
      }
      return [...prev, { date: normDate, tasks, status: { [studentId]: { [taskId]: checked } } }]
    })
    fetch(apiUrl, { method: 'POST', mode: 'no-cors', headers: {'Content-Type': 'text/plain'}, body: JSON.stringify({ action: 'update_status', classId, date: dateStr, studentId, taskId, checked }) }).catch(console.error)
  }, [classId, currentDate, normalizeDate, tasks, apiUrl])

  const groupedStudents = useMemo(() => {
    const groups = {}
    students.forEach(s => { const g = s.group || 'A'; if(!groups[g]) groups[g] = []; groups[g].push(s) })
    return Object.keys(groups).sort().reduce((acc, k) => { acc[k] = groups[k]; return acc }, {})
  }, [students])

  const getGroupCompletionRate = (groupStudents) => {
    if (tasks.length === 0 || groupStudents.length === 0) return 0
    let completed = 0
    groupStudents.forEach(s => tasks.forEach(t => { if (studentStatus[s.id]?.[t.id] === true) completed++ }))
    return completed / (groupStudents.length * tasks.length)
  }

  const purrCount = students.filter(s => tasks.length > 0 && tasks.every(t => studentStatus[s.id]?.[t.id] === true)).length
  const angryCount = students.filter(s => tasks.length > 0 && tasks.some(t => studentStatus[s.id]?.[t.id] !== true)).length

  if (loading) return <LoadingScreen message="正在進入村莊..." />
  if (error) return <div className="p-8 text-center"><h2 className="text-xl font-bold">載入失敗</h2><p>{error}</p><button onClick={onDisconnect} className="mt-4 px-4 py-2 bg-gray-200 rounded">斷開連結</button></div>

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8 bg-[#fdfbf7]">
      <Header todayStr={formatDate(currentDate)} completionRate={completionRate} error={error} className={className} classAlias={classAlias} onLogout={onLogout} onOpenSettings={() => setShowSettings(true)} onDisconnect={onDisconnect} />
      
      <div className="flex flex-col lg:flex-row gap-6">
        <aside className="w-full lg:w-[350px] lg:shrink-0 space-y-4">
          <div className="bg-white/60 backdrop-blur-sm rounded-3xl p-4 shadow-lg border border-white/50 space-y-6">
            <div>
              <h2 className="text-lg font-bold text-[#5D5D5D] mb-4 flex items-center gap-2"><CalendarIcon size={20} className="text-[#A8D8B9]" />📅 村莊日誌</h2>
              <CalendarNav currentDate={currentDate} onDateChange={setCurrentDate} />
            </div>
            <div className="h-px bg-gradient-to-r from-transparent via-[#E8E8E8] to-transparent" />
            <TaskBoard tasks={tasks} students={students} studentStatus={studentStatus} classId={classId} currentDateStr={formatDate(currentDate)} onTasksUpdate={handleTasksUpdate} taskTypes={settings.taskTypes} compact={true} apiUrl={apiUrl} />
          </div>
        </aside>

        <main className="flex-1 min-w-0">
          <div className="bg-white/60 backdrop-blur-sm rounded-3xl p-6 shadow-lg border border-white/50">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-[#5D5D5D] flex items-center gap-2"><Users size={24} className="text-[#A8D8B9]" />🏘️ 村民廣場</h2>
              <div className="flex items-center gap-3">
                <span className="px-3 py-1 rounded-full text-xs font-medium bg-[#A8D8B9]/30 text-[#4A7C59]">✨ {purrCount} 已完成</span>
                <span className="px-3 py-1 rounded-full text-xs font-medium bg-[#FFADAD]/30 text-[#D64545]">💢 {angryCount} 未完成</span>
              </div>
            </div>

            {students.length === 0 ? (
               <div className="text-center py-16"><p className="text-[#8B8B8B]">目前沒有村民資料</p></div>
            ) : (
              <div className="space-y-6">
                {Object.entries(groupedStudents).map(([group, groupStudents]) => {
                  const rate = getGroupCompletionRate(groupStudents)
                  const isComplete = rate === 1 && tasks.length > 0
                  return (
                    <div key={group} className={`p-4 rounded-2xl transition-all ${isComplete ? 'bg-yellow-50 border-4 border-yellow-400 shadow-[0_0_20px_rgba(250,204,21,0.6)]' : 'bg-white/40 border border-white/50'}`}>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <Flag size={20} className="text-[#FF8A8A]" />
                          <h3 className="text-lg font-bold text-[#5D5D5D]">🚩 {group} 小隊</h3>
                          {isComplete && <span className="flex items-center gap-1 px-2 py-1 rounded-lg bg-yellow-400 text-yellow-900 text-xs font-bold"><Trophy size={14} />🏆 全員達成！</span>}
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex-1 w-24 h-2 bg-[#E8E8E8] rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${rate * 100}%`, background: isComplete ? 'linear-gradient(90deg, #FFD700, #FFA500)' : 'linear-gradient(90deg, #A8D8B9, #7BC496)' }} />
                          </div>
                          <span className="text-xs text-[#8B8B8B]">{Math.round(rate * 100)}%</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-3">
                        {groupStudents.map((student, i) => (
                          <div key={student.id} style={{ animation: 'slideUp 0.5s ease-out forwards', animationDelay: `${i * 0.03}s`, opacity: 0 }}>
                            <VillagerCard student={student} tasks={tasks} studentStatus={studentStatus} onClick={() => setSelectedStudent(student)} />
                          </div>
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
        <p className="flex items-center justify-center gap-2"><PawPrint size={16} className="text-[#A8D8B9]" />呼嚕嚕小鎮 Purr Purr Town v2.1 © 2026<PawPrint size={16} className="text-[#A8D8B9]" /></p>
      </footer>

      {selectedStudent && (
        <PassportModal
          student={selectedStudent} tasks={tasks} studentStatus={studentStatus} classId={classId} apiUrl={apiUrl}
          onClose={() => setSelectedStudent(null)}
          onToggleStatus={toggleStatus}
          onStudentUpdate={(updated) => { setStudents(p => p.map(s => s.id === updated.id ? updated : s)); setSelectedStudent(null) }}
        />
      )}
      {showSettings && <SettingsModal classId={classId} settings={settings} onClose={() => setShowSettings(false)} onSave={setSettings} apiUrl={apiUrl} />}
    </div>
  )
}

// ============================================
// 主應用程式 (App) - 管理 API URL 與路由
// ============================================

function App() {
  const [apiUrl, setApiUrl] = useState(() => localStorage.getItem('ppt_api_url'))
  const [selectedClass, setSelectedClass] = useState(null)

  const handleConnect = (url) => {
    localStorage.setItem('ppt_api_url', url)
    setApiUrl(url)
  }

  const handleDisconnect = () => {
    if (window.confirm('確定要斷開資料庫連結嗎？您需要重新輸入網址才能進入。')) {
      localStorage.removeItem('ppt_api_url')
      setApiUrl(null)
      setSelectedClass(null)
    }
  }

  const handleSelectClass = (classId, displayName, alias) => {
    setSelectedClass({ id: classId, name: displayName || `班級 ${classId}`, alias: alias || null })
  }

  if (!apiUrl) {
    return <WelcomeView onConnect={handleConnect} />
  }

  if (!selectedClass) {
    return (
      <LoginView
        apiUrl={apiUrl}
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
    />
  )
}

export default App