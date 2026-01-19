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
  Trophy
} from 'lucide-react'

// ============================================
// 常數與工具函數
// ============================================

const API_URL = import.meta.env.VITE_API_URL

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

// DiceBear 頭像 URL (notionists 風格，Notion 風格插畫)
function getAvatarUrl(uuid) {
  const colors = ['b6e3f4', 'ffd5dc', 'ffdfbf', 'e0d4ff', 'd1f4e0', 'fff4c4']
  const color = colors[parseInt(uuid?.slice(-1) || '0', 16) % colors.length]
  return `https://api.dicebear.com/7.x/notionists/svg?seed=${uuid}&backgroundColor=${color}`
}

// 檢查是否為預設姓名 (例如 "1號村民", "5號村民")
function isDefaultName(name, number) {
  if (!name || !number) return false
  try {
    const defaultPattern = new RegExp(`^${number}號村民$`)
    return defaultPattern.test(name) || name === `${number}號村民`
  } catch (err) {
    console.warn('isDefaultName 檢查失敗:', err)
    return false
  }
}

// ============================================
// Loading 畫面元件
// ============================================

function LoadingScreen({ message = '正在前往呼嚕嚕小鎮...' }) {
  return (
    <div className="fixed inset-0 bg-[#fdfbf7] flex flex-col items-center justify-center z-50">
      {/* 背景裝飾 */}
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

      {/* 主要 Loading 內容 */}
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

      {/* 底部裝飾 */}
      <div className="absolute bottom-8 flex items-center gap-2 text-[#A8D8B9]">
        <PawPrint size={20} />
        <span className="text-sm font-medium">Purr Purr Town v2.0</span>
        <PawPrint size={20} />
      </div>
    </div>
  )
}

// ============================================
// 建立班級 Modal 元件
// ============================================

function CreateClassModal({ onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    year: '',
    className: '',
    teacher: '',
    alias: '',  // 村莊別名 (Optional)
    studentCount: '30'  // 預設村民人數
  })
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)

  // 阻止背景滾動
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  // 表單驗證
  const validateForm = () => {
    const newErrors = {}
    if (!formData.year.trim()) {
      newErrors.year = '請輸入學年度'
    } else if (!/^\d+$/.test(formData.year.trim())) {
      newErrors.year = '學年度請輸入數字'
    }
    if (!formData.className.trim()) {
      newErrors.className = '請輸入班級名稱'
    }
    if (!formData.teacher.trim()) {
      newErrors.teacher = '請輸入村長姓名'
    }
    if (!formData.studentCount.trim()) {
      newErrors.studentCount = '請輸入村民人數'
    } else if (!/^\d+$/.test(formData.studentCount.trim())) {
      newErrors.studentCount = '請輸入數字'
    } else if (parseInt(formData.studentCount.trim(), 10) < 1 || parseInt(formData.studentCount.trim(), 10) > 50) {
      newErrors.studentCount = '人數需在 1-50 之間'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // 處理表單變更
  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    // 清除該欄位的錯誤
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: null }))
    }
  }

  // 提交表單
  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!validateForm()) return

    try {
      setSubmitting(true)
      setSubmitError(null)

      // 發送 POST 請求
      const payload = {
        action: 'create_class',
        year: formData.year.trim(),
        className: formData.className.trim(),
        teacher: formData.teacher.trim(),
        studentCount: parseInt(formData.studentCount.trim(), 10)
      }
      // 只有當 alias 有值時才加入
      if (formData.alias.trim()) {
        payload.alias = formData.alias.trim()
      }
      
      await fetch(API_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(payload)
      })

      // 成功後回調
      onSuccess()
    } catch (err) {
      console.error('建立班級失敗:', err)
      setSubmitError('建立失敗，請稍後再試')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* 背景遮罩 */}
      <div 
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        style={{ animation: 'fadeIn 0.3s ease-out' }}
      />

      {/* Modal 內容 */}
      <div
        className="relative bg-[#fdfbf7] rounded-3xl shadow-2xl max-w-md w-full overflow-hidden"
        style={{ animation: 'popIn 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 頂部裝飾條 */}
        <div
          className="h-3"
          style={{ background: 'repeating-linear-gradient(90deg, #A8D8B9, #A8D8B9 20px, #FFD6A5 20px, #FFD6A5 40px)' }}
        />

        {/* 關閉按鈕 */}
        <button
          onClick={onClose}
          disabled={submitting}
          className="absolute top-6 right-4 p-2 rounded-full bg-white/80 hover:bg-white shadow-md transition-all hover:scale-110 z-10 disabled:opacity-50"
        >
          <X size={20} className="text-[#5D5D5D]" />
        </button>

        <div className="p-6">
          {/* 標題區 */}
          <div className="text-center mb-6">
            <div
              className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
              style={{ background: 'linear-gradient(135deg, #FFD6A5 0%, #FFBF69 100%)' }}
            >
              <Home size={32} className="text-white" />
            </div>
            <h2 className="text-2xl font-bold text-[#5D5D5D]">🏠 建立新村莊</h2>
            <p className="text-[#8B8B8B] text-sm mt-2">填寫以下資訊，開始你的村莊管理之旅！</p>
          </div>

          {/* 錯誤提示 */}
          {submitError && (
            <div className="mb-4 p-3 rounded-xl bg-[#FFADAD]/20 text-[#D64545] text-sm text-center">
              {submitError}
            </div>
          )}

          {/* 表單 */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 學年度 */}
      <div>
              <label className="flex items-center gap-2 text-sm font-medium text-[#5D5D5D] mb-2">
                <Calendar size={16} className="text-[#A8D8B9]" />
                學年度
              </label>
              <input
                type="text"
                value={formData.year}
                onChange={(e) => handleChange('year', e.target.value)}
                placeholder="例如：114"
                disabled={submitting}
                className={`
                  w-full px-4 py-3 rounded-2xl border-2 transition-all outline-none
                  ${errors.year 
                    ? 'border-[#FFADAD] bg-[#FFADAD]/5' 
                    : 'border-[#E8E8E8] focus:border-[#A8D8B9] bg-white'
                  }
                  disabled:opacity-50 disabled:cursor-not-allowed
                `}
              />
              {errors.year && (
                <p className="mt-1 text-xs text-[#D64545]">{errors.year}</p>
              )}
      </div>

            {/* 班級名稱 */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-[#5D5D5D] mb-2">
                <School size={16} className="text-[#FFD6A5]" />
                班級名稱
              </label>
              <input
                type="text"
                value={formData.className}
                onChange={(e) => handleChange('className', e.target.value)}
                placeholder="例如：407班"
                disabled={submitting}
                className={`
                  w-full px-4 py-3 rounded-2xl border-2 transition-all outline-none
                  ${errors.className 
                    ? 'border-[#FFADAD] bg-[#FFADAD]/5' 
                    : 'border-[#E8E8E8] focus:border-[#A8D8B9] bg-white'
                  }
                  disabled:opacity-50 disabled:cursor-not-allowed
                `}
              />
              {errors.className && (
                <p className="mt-1 text-xs text-[#D64545]">{errors.className}</p>
              )}
            </div>

            {/* 村長姓名 */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-[#5D5D5D] mb-2">
                <User size={16} className="text-[#FFADAD]" />
                村長姓名
              </label>
              <input
                type="text"
                value={formData.teacher}
                onChange={(e) => handleChange('teacher', e.target.value)}
                placeholder="例如：王老師"
                disabled={submitting}
                className={`
                  w-full px-4 py-3 rounded-2xl border-2 transition-all outline-none
                  ${errors.teacher 
                    ? 'border-[#FFADAD] bg-[#FFADAD]/5' 
                    : 'border-[#E8E8E8] focus:border-[#A8D8B9] bg-white'
                  }
                  disabled:opacity-50 disabled:cursor-not-allowed
                `}
              />
              {errors.teacher && (
                <p className="mt-1 text-xs text-[#D64545]">{errors.teacher}</p>
              )}
            </div>

            {/* 村莊別名 (Optional) */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-[#5D5D5D] mb-2">
                <Sparkles size={16} className="text-[#FFD6A5]" />
                村莊別名
                <span className="text-xs text-[#8B8B8B] font-normal">(選填)</span>
              </label>
              <input
                type="text"
                value={formData.alias}
                onChange={(e) => handleChange('alias', e.target.value)}
                placeholder="例如：跳跳虎村"
                disabled={submitting}
                className="w-full px-4 py-3 rounded-2xl border-2 transition-all outline-none
                  border-[#E8E8E8] focus:border-[#A8D8B9] bg-white
                  disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <p className="mt-1 text-xs text-[#8B8B8B]">
                為你的村莊取一個可愛的暱稱吧！🐱
              </p>
            </div>

            {/* 預設村民人數 */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-[#5D5D5D] mb-2">
                <Users size={16} className="text-[#A8D8B9]" />
                預設村民人數
              </label>
              <input
                type="text"
                value={formData.studentCount}
                onChange={(e) => {
                  // 只允許輸入數字
                  const value = e.target.value.replace(/[^\d]/g, '')
                  handleChange('studentCount', value)
                }}
                placeholder="例如：30"
                disabled={submitting}
                className={`
                  w-full px-4 py-3 rounded-2xl border-2 transition-all outline-none
                  ${errors.studentCount 
                    ? 'border-[#FFADAD] bg-[#FFADAD]/5' 
                    : 'border-[#E8E8E8] focus:border-[#A8D8B9] bg-white'
                  }
                  disabled:opacity-50 disabled:cursor-not-allowed
                `}
              />
              {errors.studentCount && (
                <p className="mt-1 text-xs text-[#D64545]">{errors.studentCount}</p>
              )}
              <p className="mt-1 text-xs text-[#8B8B8B]">
                系統將自動建立指定數量的村民（座號 1~N）
              </p>
            </div>

            {/* 提交按鈕 */}
            <button
              type="submit"
              disabled={submitting}
              className="w-full mt-6 py-4 rounded-2xl bg-gradient-to-r from-[#A8D8B9] to-[#7BC496] text-white font-bold text-lg shadow-lg
                hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all duration-300
                flex items-center justify-center gap-2
                disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
              {submitting ? (
                <>
                  <Loader2 size={22} className="animate-spin" />
                  建立中...
                </>
              ) : (
                <>
                  <Plus size={22} />
                  建立村莊
                  <Sparkles size={18} />
                </>
              )}
        </button>
          </form>

          {/* 提示文字 */}
          <p className="mt-4 text-center text-xs text-[#8B8B8B]">
            建立後可在村莊中新增村民與管理任務 🐱
        </p>
      </div>

        {/* 底部裝飾條 */}
        <div
          className="h-3"
          style={{ background: 'repeating-linear-gradient(90deg, #FFD6A5, #FFD6A5 20px, #A8D8B9 20px, #A8D8B9 40px)' }}
        />
      </div>
    </div>
  )
}

// ============================================
// 村莊入口 (Login View) - 班級選擇
// ============================================

function LoginView({ onSelectClass, loading, error }) {
  const [classes, setClasses] = useState([])
  const [loadingClasses, setLoadingClasses] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)

  // 載入班級列表
  const fetchClasses = useCallback(async () => {
    if (!API_URL) {
      console.error('VITE_API_URL 環境變數未設定')
      setLoadingClasses(false)
      return
    }

    try {
      setLoadingClasses(true)
      const response = await fetch(`${API_URL}?action=get_classes`)
      if (!response.ok) throw new Error('Failed to fetch classes')
      const data = await response.json()
      setClasses(data.classes || [])
    } catch (err) {
      console.error('載入班級列表失敗:', err)
    } finally {
      setLoadingClasses(false)
    }
  }, [])

  useEffect(() => {
    fetchClasses()
  }, [fetchClasses])

  // 建立班級成功後的回調
  const handleCreateSuccess = () => {
    setShowCreateModal(false)
    // 重新載入班級列表
    fetchClasses()
  }

  if (loadingClasses) {
    return <LoadingScreen message="正在載入村莊列表..." />
  }

  return (
    <div className="min-h-screen bg-[#fdfbf7] p-6 md:p-10">
      {/* 背景裝飾 */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div 
          className="absolute top-20 left-10 text-6xl opacity-10"
          style={{ animation: 'float 4s ease-in-out infinite' }}
        >
          🏠
        </div>
        <div 
          className="absolute top-40 right-20 text-5xl opacity-10"
          style={{ animation: 'float 5s ease-in-out infinite 1s' }}
        >
          🌳
        </div>
        <div 
          className="absolute bottom-20 left-1/4 text-4xl opacity-10"
          style={{ animation: 'float 3s ease-in-out infinite 0.5s' }}
        >
          🐱
        </div>
      </div>

      {/* 主要內容 */}
      <div className="max-w-4xl mx-auto relative z-10">
        {/* Header */}
        <div className="text-center mb-12">
          <div 
            className="inline-flex items-center justify-center w-24 h-24 rounded-3xl mb-6"
            style={{ 
              background: 'linear-gradient(135deg, #A8D8B9 0%, #7BC496 100%)',
              boxShadow: '0 10px 40px rgba(168, 216, 185, 0.4)'
            }}
          >
            <PawPrint size={48} className="text-white" />
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-[#5D5D5D] mb-4">
            🐾 呼嚕嚕小鎮
          </h1>
          <p className="text-[#8B8B8B] text-lg">
            選擇您要進入的村莊
          </p>
        </div>

        {/* 建立新村莊按鈕 */}
        <div className="flex justify-center mb-8">
          <button
            onClick={() => setShowCreateModal(true)}
            className="group flex items-center gap-3 px-6 py-4 rounded-2xl
              bg-gradient-to-r from-[#FFD6A5] to-[#FFBF69]
              text-white font-bold text-lg shadow-lg
              hover:shadow-xl hover:scale-105 active:scale-95
              transition-all duration-300"
          >
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center group-hover:rotate-90 transition-transform duration-300">
              <Plus size={24} />
            </div>
            🏠 建立新村莊
          </button>
        </div>

        {/* 錯誤提示 */}
        {error && (
          <div className="mb-6 p-4 rounded-2xl bg-[#FFADAD]/20 text-[#D64545] flex items-center gap-3 justify-center">
            <WifiOff size={20} />
            <span>{error}</span>
          </div>
        )}

        {/* 班級卡片列表 */}
        {classes.length === 0 ? (
          <div className="text-center py-16 bg-white/60 rounded-3xl shadow-lg">
            <div className="text-6xl mb-4">🏚️</div>
            <p className="text-[#8B8B8B] text-lg">目前沒有可用的村莊</p>
            <p className="text-[#B8B8B8] text-sm mt-2">點擊上方按鈕建立你的第一個村莊吧！</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {classes.map((cls, index) => {
              // 決定顯示名稱：優先使用別名
              const displayName = cls.alias || cls.name || `班級 ${cls.id}`
              // 組合完整班級資訊：學年 + 班級名稱
              const fullClassName = cls.year && cls.name 
                ? `${cls.year}學年 ${cls.name}` 
                : cls.name || ''

              return (
                <button
                  key={cls.id}
                  onClick={() => onSelectClass(cls.id, displayName, cls.alias)}
                  disabled={loading}
                  className="group bg-white rounded-3xl p-6 shadow-lg border-2 border-transparent
                    hover:border-[#A8D8B9] hover:shadow-xl transition-all duration-300
                    hover:-translate-y-2 disabled:opacity-50 disabled:cursor-not-allowed text-left"
                  style={{ 
                    animationDelay: `${index * 0.1}s`,
                    animation: 'slideUp 0.5s ease-out forwards'
                  }}
                >
                  {/* 班級圖示 */}
                  <div 
                    className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform"
                    style={{ 
                      background: `linear-gradient(135deg, ${
                        index % 3 === 0 ? '#A8D8B9, #7BC496' :
                        index % 3 === 1 ? '#FFD6A5, #FFBF69' :
                        '#FFADAD, #FF8A8A'
                      })`
                    }}
                  >
                    <School size={32} className="text-white" />
                  </div>

                  {/* 村莊名稱 - 優先顯示別名 */}
                  <h3 className="text-xl font-bold text-[#5D5D5D] mb-1">
                    {displayName}
                  </h3>
                  
                  {/* 如果有別名，顯示完整班級資訊作為副標題 */}
                  {cls.alias && fullClassName && (
                    <p className="text-[#A8D8B9] text-sm font-medium mb-2">
                      {fullClassName}
                    </p>
                  )}

                  {/* 其他資訊 */}
                  <p className="text-[#8B8B8B] text-sm mb-4">
                    {cls.teacher && <span>村長：{cls.teacher}</span>}
                    {cls.teacher && cls.studentCount !== undefined && <span> · </span>}
                    {cls.studentCount !== undefined && <span>{cls.studentCount} 位村民</span>}
                  </p>

                  {/* 進入按鈕 */}
                  <div className="flex items-center gap-2 text-[#A8D8B9] font-medium group-hover:gap-3 transition-all">
                    <span>進入村莊</span>
                    <ChevronRight size={18} className="group-hover:translate-x-1 transition-transform" />
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* Footer */}
        <footer className="mt-12 text-center text-[#8B8B8B] text-sm">
          <p className="flex items-center justify-center gap-2">
            <PawPrint size={14} className="text-[#A8D8B9]" />
            Purr Purr Town v2.0 © 2026
            <PawPrint size={14} className="text-[#A8D8B9]" />
          </p>
        </footer>
      </div>

      {/* 建立班級 Modal */}
      {showCreateModal && (
        <CreateClassModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={handleCreateSuccess}
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
            if (dateStr === todayStr) {
              return 'react-calendar__tile--today'
            }
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
// 任務板元件 (軟木塞風格) - 含發布任務功能
// ============================================

function TaskBoard({ tasks, students, studentStatus, classId, currentDateStr, onTasksUpdate, taskTypes = ['作業', '訂正', '攜帶物品'], compact = false }) {
  const [showAddTask, setShowAddTask] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskType, setNewTaskType] = useState(taskTypes[0] || '作業')

  // 發布任務
  const handleAddTask = async () => {
    if (!newTaskTitle.trim()) return

    const newTask = {
      id: `task_${Date.now()}`,
      title: newTaskTitle.trim(),
      type: newTaskType
    }

    const updatedTasks = [...tasks, newTask]

    // 樂觀更新：立即更新 tasks state
    if (onTasksUpdate) {
      onTasksUpdate(updatedTasks)
    }

    // 背景執行 API 呼叫
    fetch(API_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'save_tasks',
        classId,
        date: currentDateStr,
        tasks: updatedTasks
      })
    }).catch(err => {
      console.error('發布任務失敗 (背景):', err)
    })

    // 重置表單
    setNewTaskTitle('')
    setNewTaskType(taskTypes[0] || '作業')
    setShowAddTask(false)
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleAddTask()
    }
  }
  const getTaskCompletion = (taskId) => {
    const completed = students.filter(s => studentStatus[s.id]?.[taskId] === true).length
    return { completed, total: students.length }
  }

  return (
    <div>
      {!compact && (
        <h2 className="text-xl font-bold text-[#4A3728] mb-4 flex items-center gap-2">
          <ClipboardList size={24} className="text-[#6B5344]" />
          📝 今日島務
        </h2>
      )}
      {compact && (
        <h3 className="text-lg font-bold text-[#5D5D5D] mb-4 flex items-center gap-2">
          <ClipboardList size={20} className="text-[#A8D8B9]" />
          📝 今日島務
        </h3>
      )}
      <div
        className={`rounded-2xl p-4 shadow-md relative overflow-hidden ${compact ? '' : 'p-6'}`}
        style={{
          backgroundColor: '#C4A77D',
          backgroundImage: `
            radial-gradient(ellipse at 20% 30%, rgba(255,255,255,0.1) 0%, transparent 50%),
            radial-gradient(ellipse at 80% 70%, rgba(0,0,0,0.05) 0%, transparent 50%),
            url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.3'/%3E%3C/svg%3E")
          `,
          border: compact ? '4px solid #8B7355' : '8px solid #8B7355',
          boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.2), 0 10px 40px rgba(139, 115, 85, 0.4)'
        }}
      >
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-b from-white/20 to-transparent" />

        {['top-3 left-3', 'top-3 right-3'].map((pos, i) => (
          <div
            key={i}
            className={`absolute ${pos} w-5 h-5 rounded-full shadow-md`}
            style={{
              background: 'radial-gradient(circle at 30% 30%, #FFD700, #B8860B)',
              boxShadow: '0 2px 4px rgba(0,0,0,0.3), inset 0 1px 2px rgba(255,255,255,0.5)'
            }}
          />
        ))}

        <div className="flex items-center justify-between mb-4">
          {!showAddTask && (
            <button
              onClick={() => setShowAddTask(true)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#A8D8B9] text-white text-sm font-medium
                hover:bg-[#7BC496] transition-all shadow-md"
            >
              <Plus size={16} />
              發布任務
            </button>
          )}
        </div>

        {/* 新增任務輸入框 */}
        {showAddTask && (
          <div className="mb-4 p-4 bg-white/90 rounded-2xl shadow-md space-y-3">
            <input
              type="text"
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="輸入任務名稱..."
              className="w-full px-4 py-2 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-[#5D5D5D]"
              autoFocus
            />
            <select
              value={newTaskType}
              onChange={(e) => setNewTaskType(e.target.value)}
              className="w-full px-4 py-2 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none bg-white text-[#5D5D5D]"
            >
              {taskTypes.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                onClick={handleAddTask}
                className="flex-1 px-4 py-2 rounded-xl bg-gradient-to-r from-[#A8D8B9] to-[#7BC496] text-white font-medium
                  hover:shadow-lg transition-all"
              >
                儲存
              </button>
              <button
                onClick={() => {
                  setShowAddTask(false)
                  setNewTaskTitle('')
                  setNewTaskType(taskTypes[0] || '作業')
                }}
                className="px-4 py-2 rounded-xl bg-[#E8E8E8] text-[#5D5D5D] font-medium hover:bg-[#D8D8D8] transition-all"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {tasks.length === 0 ? (
          <div className="text-center py-8 bg-white/30 rounded-2xl">
            <div className="text-4xl mb-3">😸</div>
            <p className="text-[#6B5344] font-medium">今日暫無委託</p>
            <p className="text-[#8B7355] text-sm mt-1">好好休息吧～喵</p>
          </div>
        ) : (
          <div className="space-y-3">
            {tasks.map((task, index) => {
              const IconComponent = getTaskIcon(task.title)
              const { completed, total } = getTaskCompletion(task.id)
              const isAllDone = completed === total && total > 0

              return (
                <div
                  key={task.id}
                  className="bg-white/90 backdrop-blur rounded-2xl p-4 shadow-md transition-all duration-300 hover:scale-[1.02]"
                  style={{ transform: `rotate(${index % 2 === 0 ? -1 : 1}deg)` }}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isAllDone ? 'bg-[#A8D8B9]' : 'bg-[#FFD6A5]'}`}>
                      <IconComponent size={20} className="text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className={`font-bold text-[#5D5D5D] ${isAllDone ? 'line-through opacity-60' : ''}`}>
                        {task.title}
                      </h3>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 h-2 bg-[#E8E8E8] rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: total > 0 ? `${(completed / total) * 100}%` : '0%',
                              backgroundColor: isAllDone ? '#A8D8B9' : '#FFD6A5'
                            }}
                          />
                        </div>
                        <span className="text-xs text-[#8B8B8B] whitespace-nowrap">
                          {completed}/{total}
                        </span>
                      </div>
                    </div>
                    <div className="text-lg">{isAllDone ? '✅' : '⏳'}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {!compact && (
          <div className="mt-4 pt-4 border-t-2 border-[#8B7355]/30 text-center">
            <p className="text-[#6B5344] text-sm flex items-center justify-center gap-2">
              <Star size={14} className="text-[#FFD6A5]" />
              點擊村民查看詳情
              <Star size={14} className="text-[#FFD6A5]" />
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================
// 村民卡片元件 (DiceBear 頭像)
// ============================================

function VillagerCard({ student, tasks, studentStatus, onClick }) {
  const status = studentStatus[student.id] || {}
  
  // 狀態判定邏輯修復：
  // - 炸毛：tasks.length > 0 且該學生有 false 的項目
  // - 呼嚕：tasks.length > 0 且該學生全為 true
  // - 閒置：tasks.length === 0 (顯示中性狀態)
  const hasTasks = tasks.length > 0
  const hasIncomplete = hasTasks && tasks.some(t => status[t.id] !== true)
  const isAllComplete = hasTasks && tasks.every(t => status[t.id] === true)
  const isIdle = !hasTasks
  
  const isAngry = hasIncomplete // 炸毛狀態
  const isPurr = isAllComplete // 呼嚕狀態
  
  const completedCount = tasks.filter(t => status[t.id] === true).length
  const studentNumber = student.number || student.seatNumber
  const hasDefaultName = isDefaultName(student.name, studentNumber)

  // 隨機旋轉角度
  const rotation = ((student.id || 0) % 7) - 3

  return (
    <div
      onClick={onClick}
        className={`
        relative bg-white rounded-xl p-2 cursor-pointer group
        transition-all duration-300 ease-out
        hover:scale-105 hover:-translate-y-1
        ${isAngry 
          ? 'shadow-md shadow-[#FFADAD]/30' 
          : isPurr 
            ? 'shadow-md shadow-[#A8D8B9]/30' 
            : 'shadow-md shadow-[#E8E8E8]/30'
        }
      `}
      style={{
        transform: `rotate(${rotation}deg)`,
        boxShadow: isAngry
          ? '0 2px 10px rgba(255, 173, 173, 0.3)'
          : isPurr
            ? '0 2px 10px rgba(168, 216, 185, 0.3)'
            : '0 2px 10px rgba(232, 232, 232, 0.3)'
      }}
    >
      {/* 座號標籤 - 左上角 */}
      <div
        className={`
          absolute -top-1 -left-1 w-6 h-6 rounded-full flex items-center justify-center
          text-white font-bold text-xs shadow-sm z-10
          ${isAngry 
            ? 'bg-[#FF8A8A]' 
            : isPurr 
              ? 'bg-[#7BC496]' 
              : 'bg-[#B8B8B8]'
          }
        `}
      >
        {student.number || student.seatNumber || '?'}
      </div>

      {/* 狀態燈號 - 右上角 */}
      {!isIdle && (
        <div
          className={`absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full z-10 shadow-sm ${
            isAngry ? 'bg-[#FFADAD]' : 'bg-[#A8D8B9]'
          }`}
        />
      )}
      {isIdle && (
        <div className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full z-10 shadow-sm bg-[#E8E8E8]" />
      )}

      {/* 頭像區域 */}
      <div
        className={`
          relative w-12 h-12 mx-auto rounded-lg overflow-hidden mb-1.5
          ${isAngry
            ? 'bg-gradient-to-br from-[#FFADAD]/20 to-[#FF8A8A]/10'
            : isPurr
              ? 'bg-gradient-to-br from-[#A8D8B9]/20 to-[#7BC496]/10'
              : 'bg-gradient-to-br from-[#E8E8E8]/20 to-[#D8D8D8]/10'
          }
        `}
      >
        {/* DiceBear 頭像 */}
        <img
          src={getAvatarUrl(student.uuid || student.id)}
          alt={student.name}
            className={`
            w-full h-full object-cover transition-all duration-300
            group-hover:scale-110
            ${isAngry ? 'grayscale-[50%] opacity-80' : isIdle ? 'opacity-60' : ''}
          `}
        />
      </div>

      {/* 姓名區域 */}
      <div className="text-center">
        <h3 className={`text-sm font-bold truncate ${hasDefaultName ? 'text-[#B8B8B8] italic' : 'text-[#5D5D5D]'}`}>
          {student.name || `未命名 (${studentNumber || '?'}號)`}
          {hasDefaultName && <span className="ml-0.5 text-[10px] not-italic">⚠️</span>}
        </h3>
      </div>
    </div>
  )
}

// ============================================
// 村莊設定 Modal 元件
// ============================================

function SettingsModal({ classId, settings, onClose, onSave }) {
  const [localSettings, setLocalSettings] = useState({
    taskTypes: settings?.taskTypes || ['作業', '訂正', '攜帶物品', '考試', '通知單', '回條']
  })
  const [newTaskType, setNewTaskType] = useState('')
  const [saving, setSaving] = useState(false)

  // 當 settings prop 改變時，更新 localSettings
  useEffect(() => {
    if (settings?.taskTypes) {
      setLocalSettings({
        taskTypes: settings.taskTypes
      })
    }
  }, [settings])

  // 任務類型顏色映射
  const getTaskTypeColor = (type) => {
    const colorMap = {
      '作業': 'bg-blue-100 text-blue-700 border-blue-300',
      '訂正': 'bg-red-100 text-red-700 border-red-300',
      '攜帶物品': 'bg-purple-100 text-purple-700 border-purple-300',
      '考試': 'bg-orange-100 text-orange-700 border-orange-300',
      '通知單': 'bg-green-100 text-green-700 border-green-300',
      '回條': 'bg-yellow-100 text-yellow-700 border-yellow-300'
    }
    return colorMap[type] || 'bg-gray-100 text-gray-700 border-gray-300'
  }

  // 新增任務類型
  const handleAddTaskType = () => {
    if (newTaskType.trim() && !localSettings.taskTypes.includes(newTaskType.trim())) {
      setLocalSettings(prev => ({
        ...prev,
        taskTypes: [...prev.taskTypes, newTaskType.trim()]
      }))
      setNewTaskType('')
    }
  }

  // 刪除任務類型
  const handleDeleteTaskType = (typeToDelete) => {
    setLocalSettings(prev => ({
      ...prev,
      taskTypes: prev.taskTypes.filter(t => t !== typeToDelete)
    }))
  }

  // 儲存設定
  const handleSave = async () => {
    try {
      setSaving(true)

      // 背景執行 API 呼叫
      fetch(API_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'save_settings',
          classId,
          settings: localSettings
        })
      }).catch(err => {
        console.error('儲存設定失敗 (背景):', err)
      })

      // 更新本地 State
      if (onSave) {
        onSave(localSettings)
      }

      onClose()
    } catch (err) {
      console.error('儲存設定失敗:', err)
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      // 禁止點擊背景關閉
    >
      <div 
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        style={{ animation: 'fadeIn 0.3s ease-out' }}
      />

      <div
        className="relative bg-[#fdfbf7] rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden"
        style={{ animation: 'popIn 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="h-3"
          style={{ background: 'repeating-linear-gradient(90deg, #A8D8B9, #A8D8B9 20px, #FFD6A5 20px, #FFD6A5 40px)' }}
        />

        <button
          onClick={onClose}
          disabled={saving}
          className="absolute top-6 right-4 p-2 rounded-full bg-white/80 hover:bg-white shadow-md transition-all hover:scale-110 z-10 disabled:opacity-50"
        >
          <X size={20} className="text-[#5D5D5D]" />
        </button>

        <div className="p-6">
          {/* 標題 */}
          <div className="text-center mb-6">
            <div
              className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
              style={{ background: 'linear-gradient(135deg, #FFD6A5 0%, #FFBF69 100%)' }}
            >
              <Settings size={32} className="text-white" />
            </div>
            <h2 className="text-2xl font-bold text-[#5D5D5D]">⚙️ 村莊設定</h2>
            <p className="text-[#8B8B8B] text-sm mt-2">管理村莊的任務類型標籤</p>
          </div>

          {/* 自訂任務類型 */}
          <div className="space-y-4">
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-[#5D5D5D] mb-3">
                <ClipboardList size={16} className="text-[#A8D8B9]" />
                任務類型標籤
              </label>

              {/* 現有標籤列表 */}
              <div className="flex flex-wrap gap-2 mb-4">
                {localSettings.taskTypes.map((type) => (
                  <div
                    key={type}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border-2 ${getTaskTypeColor(type)}`}
                  >
                    <span className="text-sm font-medium">{type}</span>
                    <button
                      onClick={() => handleDeleteTaskType(type)}
                      className="hover:bg-black/10 rounded-full p-0.5 transition-colors"
                      title="刪除標籤"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>

              {/* 新增標籤輸入框 */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newTaskType}
                  onChange={(e) => setNewTaskType(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      handleAddTaskType()
                    }
                  }}
                  placeholder="輸入新標籤名稱..."
                  className="flex-1 px-4 py-2 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-[#5D5D5D]"
                />
                <button
                  onClick={handleAddTaskType}
                  disabled={!newTaskType.trim() || localSettings.taskTypes.includes(newTaskType.trim())}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#A8D8B9] to-[#7BC496] text-white font-medium
                    hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus size={18} />
                </button>
              </div>
            </div>
          </div>

          {/* 儲存按鈕 */}
          <div className="mt-6 flex gap-3">
            <button
              onClick={handleSave}
              disabled={saving || localSettings.taskTypes.length === 0}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl
                bg-gradient-to-r from-[#A8D8B9] to-[#7BC496] text-white font-medium
                hover:shadow-lg transition-all disabled:opacity-50"
            >
              {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
              儲存設定
            </button>
            <button
              onClick={onClose}
              disabled={saving}
              className="px-4 py-3 rounded-xl bg-[#E8E8E8] text-[#5D5D5D] font-medium
                hover:bg-[#D8D8D8] transition-all disabled:opacity-50"
            >
              取消
            </button>
          </div>
        </div>

        <div
          className="h-3"
          style={{ background: 'repeating-linear-gradient(90deg, #FFD6A5, #FFD6A5 20px, #A8D8B9 20px, #A8D8B9 40px)' }}
        />
      </div>
    </div>
  )
}

// ============================================
// 村民護照 Modal 元件 (含編輯模式)
// ============================================

function PassportModal({ student, tasks, studentStatus, classId, onClose, onToggleStatus, onStudentUpdate }) {
  const [isEditMode, setIsEditMode] = useState(false)
  const [editData, setEditData] = useState({
    name: student.name || '',
    gender: student.gender || 'male',
    group: student.group || 'A'
  })
  const [saving, setSaving] = useState(false)

  const status = studentStatus[student.id] || {}
  
  // 狀態判定邏輯修復：與 VillagerCard 一致
  const hasTasks = tasks.length > 0
  const hasIncomplete = hasTasks && tasks.some(t => status[t.id] !== true)
  const isAllDone = hasTasks && tasks.every(t => status[t.id] === true)
  const isIdle = !hasTasks
  
  const completedCount = tasks.filter(t => status[t.id] === true).length
  const studentNumber = student.number || student.seatNumber
  const hasDefaultName = isDefaultName(student.name, studentNumber)

  const handleHealAll = () => {
    tasks.forEach(task => {
      if (status[task.id] !== true) {
        onToggleStatus(student.id, task.id, true)
      }
    })
  }

  // 進入編輯模式
  const enterEditMode = () => {
    setEditData({
      name: student.name || '',
      gender: student.gender || 'male',
      group: student.group || 'A'
    })
    setIsEditMode(true)
  }

  // 取消編輯
  const cancelEdit = () => {
    setIsEditMode(false)
    setEditData({
      name: student.name || '',
      gender: student.gender || 'male',
      group: student.group || 'A'
    })
  }

  // 儲存編輯 (樂觀更新)
  const saveEdit = () => {
    if (!editData.name.trim()) return

    // 樂觀更新：立即更新 React State
    const updatedStudent = {
      ...student,
      id: student.id || student.uuid, // 確保有 id 欄位
      name: editData.name.trim(),
      group: editData.group,
      gender: editData.gender
    }

    // 通知父元件立即更新 students state
    if (onStudentUpdate) {
      onStudentUpdate(updatedStudent)
    }

    // 立即關閉 Modal 和編輯模式
    setIsEditMode(false)
    onClose()

    // 背景執行 API 呼叫，不 await，不阻塞 UI
    fetch(API_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'update_student',
        classId,
        uuid: student.uuid || student.id,
        name: editData.name.trim(),
        group: editData.group,
        gender: editData.gender
      })
    }).catch(err => {
      console.error('更新村民資料失敗 (背景):', err)
      // 如果 API 失敗，可以在這裡選擇是否要重新載入資料或顯示錯誤提示
    })
  }

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      // 禁止點擊背景關閉，防止誤觸導致編輯資料流失
    >
      <div 
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        style={{ animation: 'fadeIn 0.3s ease-out' }}
      />

      <div
        className="relative bg-[#fdfbf7] rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden"
        style={{ animation: 'popIn 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="h-3"
          style={{ background: 'repeating-linear-gradient(90deg, #A8D8B9, #A8D8B9 20px, #FFD6A5 20px, #FFD6A5 40px)' }}
        />

        <button
          onClick={onClose}
          disabled={saving}
          className="absolute top-6 right-4 p-2 rounded-full bg-white/80 hover:bg-white shadow-md transition-all hover:scale-110 z-10 disabled:opacity-50"
        >
          <X size={20} className="text-[#5D5D5D]" />
        </button>

        <div className="p-6">
          {/* 標題 */}
          <div className="mb-4 text-center">
            <h2 className="text-2xl font-bold text-[#5D5D5D] flex items-center justify-center gap-2">
              <PawPrint size={24} className="text-[#A8D8B9]" />
              村民護照
            </h2>
          </div>

          {/* 頭像與資料區 */}
          <div className="flex items-start gap-6 mb-6">
            {/* 頭像 */}
            <div
              className={`
                w-28 h-28 rounded-3xl overflow-hidden shadow-lg shrink-0
                ${isAllDone
                  ? 'ring-4 ring-[#A8D8B9]'
                  : isIdle
                    ? 'ring-4 ring-[#E8E8E8]'
                    : 'ring-4 ring-[#FFADAD]'
                }
              `}
            >
              <img
                src={getAvatarUrl(student.uuid || student.id)}
                alt={student.name}
                className="w-full h-full object-cover"
              />
            </div>

            {/* 資料區 */}
            <div className="flex-1">
              {/* 座號標籤 (唯讀) */}
              <div className="flex items-center gap-2 mb-2">
                <span className="px-2 py-0.5 bg-[#FFD6A5] rounded-lg text-xs font-bold text-[#8B6914]">
                  {studentNumber}號
                </span>
                {!isIdle && (
                  <span
                    className={`px-2 py-0.5 rounded-lg text-xs font-bold ${isAllDone ? 'bg-[#A8D8B9] text-[#3D6B4A]' : 'bg-[#FFADAD] text-[#8B4545]'}`}
                  >
                    {isAllDone ? '✨ 已完成' : '💢 未完成'}
                  </span>
                )}
                {isIdle && (
                  <span className="px-2 py-0.5 rounded-lg text-xs font-bold bg-[#E8E8E8] text-[#8B8B8B]">
                    😴 待命中
                  </span>
                )}
              </div>

              {/* 編輯模式 */}
              {isEditMode ? (
                <div className="space-y-3">
                  {/* 姓名輸入 */}
                  <div>
                    <label className="text-xs text-[#8B8B8B] mb-1 block">姓名</label>
                    <input
                      type="text"
                      value={editData.name}
                      onChange={(e) => setEditData(prev => ({ ...prev, name: e.target.value }))}
                      disabled={saving}
                      className="w-full px-3 py-2 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-[#5D5D5D] font-bold"
                      placeholder="請輸入姓名"
                    />
                  </div>

                  {/* 性別與組別 */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-[#8B8B8B] mb-1 block">性別</label>
                      <select
                        value={editData.gender}
                        onChange={(e) => setEditData(prev => ({ ...prev, gender: e.target.value }))}
                        disabled={saving}
                        className="w-full px-3 py-2 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none bg-white text-[#5D5D5D]"
                      >
                        <option value="male">男</option>
                        <option value="female">女</option>
                        <option value="neutral">中性</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-[#8B8B8B] mb-1 block">組別</label>
                      <select
                        value={editData.group}
                        onChange={(e) => setEditData(prev => ({ ...prev, group: e.target.value }))}
                        disabled={saving}
                        className="w-full px-3 py-2 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none bg-white text-[#5D5D5D]"
                      >
                        <option value="A">A 組</option>
                        <option value="B">B 組</option>
                        <option value="C">C 組</option>
                        <option value="D">D 組</option>
                        <option value="E">E 組</option>
                        <option value="F">F 組</option>
                      </select>
                    </div>
                  </div>

                  {/* 編輯按鈕組 */}
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={saveEdit}
                      disabled={saving || !editData.name.trim()}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl
                        bg-gradient-to-r from-[#A8D8B9] to-[#7BC496] text-white font-medium
                        hover:shadow-lg transition-all disabled:opacity-50"
                    >
                      {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                      儲存
                    </button>
                    <button
                      onClick={cancelEdit}
                      disabled={saving}
                      className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl
                        bg-[#E8E8E8] text-[#5D5D5D] font-medium hover:bg-[#D8D8D8] transition-all disabled:opacity-50"
                    >
                      <XCircle size={16} />
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                /* 檢視模式 */
                <>
                  <h3 className={`text-2xl font-bold mb-1 ${hasDefaultName ? 'text-[#B8B8B8]' : 'text-[#5D5D5D]'}`}>
                    {student.name}
                    {hasDefaultName && (
                      <span className="ml-2 text-xs font-normal text-[#FFBF69]">⚠️ 請編輯</span>
                    )}
                  </h3>
                  <div className="flex items-center gap-2 text-sm text-[#8B8B8B] mb-2">
                    <span>{student.gender === 'female' ? '女生' : student.gender === 'neutral' ? '中性' : '男生'}</span>
                    <span>·</span>
                    <span>{student.group || 'A'} 組</span>
                  </div>
                  <button
                    onClick={enterEditMode}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#FFD6A5]/30 text-[#8B6914] text-sm font-medium
                      hover:bg-[#FFD6A5]/50 transition-all"
                  >
                    <Pencil size={14} />
                    編輯資料
                  </button>
                </>
              )}
            </div>
          </div>

          {/* 任務進度 */}
          {!isEditMode && (
            <>
              <div className="mb-4">
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-[#8B8B8B]">任務進度</span>
                  <span className="font-bold text-[#5D5D5D]">{completedCount} / {tasks.length}</span>
                </div>
                <div className="w-full h-3 bg-[#E8E8E8] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: tasks.length > 0 ? `${(completedCount / tasks.length) * 100}%` : '0%',
                      background: isAllDone
                        ? 'linear-gradient(90deg, #A8D8B9, #7BC496)'
                        : 'linear-gradient(90deg, #FFD6A5, #FFBF69)'
                    }}
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[#E8E8E8] to-transparent" />
                <span className="text-[#8B8B8B] text-sm">今日任務</span>
                <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[#E8E8E8] to-transparent" />
              </div>

              {tasks.length === 0 ? (
                <div className="text-center py-8 bg-white rounded-2xl">
                  <div className="text-4xl mb-2">😸</div>
                  <p className="text-[#8B8B8B]">今日暫無任務，放鬆一下吧～</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-48 overflow-y-auto pr-2">
                  {tasks.map((task) => {
                    const isChecked = status[task.id] === true
                    const IconComponent = getTaskIcon(task.title)

                    return (
                      <label
                        key={task.id}
                        className={`
                          flex items-center gap-4 p-4 rounded-2xl cursor-pointer transition-all duration-300
                          ${isChecked
                            ? 'bg-[#A8D8B9]/20 border-2 border-[#A8D8B9]'
                            : 'bg-white border-2 border-transparent hover:border-[#FFD6A5]'
                          }
                        `}
                      >
                        <div className="relative">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => onToggleStatus(student.id, task.id, e.target.checked)}
                            className="sr-only"
                          />
                          <div
                            className={`
                              w-7 h-7 rounded-lg border-2 flex items-center justify-center transition-all
                              ${isChecked
                                ? 'bg-[#A8D8B9] border-[#7BC496]'
                                : 'bg-white border-[#E8E8E8] hover:border-[#A8D8B9]'
                              }
                            `}
                          >
                            {isChecked && <CheckCircle size={18} className="text-white" />}
                          </div>
                        </div>

                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isChecked ? 'bg-[#A8D8B9]/30' : 'bg-[#FFD6A5]/30'}`}>
                          <IconComponent size={20} className={isChecked ? 'text-[#7BC496]' : 'text-[#FFBF69]'} />
                        </div>

                        <span className={`flex-1 font-medium text-[#5D5D5D] ${isChecked ? 'line-through opacity-60' : ''}`}>
                          {task.title}
                        </span>

                        <div className="text-xl">{isChecked ? '✅' : '⏳'}</div>
                      </label>
                    )
                  })}
                </div>
              )}

              {tasks.length > 0 && !isAllDone && (
                <button
                  onClick={handleHealAll}
                  className="w-full mt-4 py-3 rounded-2xl bg-gradient-to-r from-[#A8D8B9] to-[#7BC496] text-white font-bold shadow-lg
                    hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all duration-300
                    flex items-center justify-center gap-2"
                >
                  <Heart size={20} />
                  🎉 全員達成 (全選)
                  <Sparkles size={18} />
                </button>
              )}

              {isAllDone && tasks.length > 0 && (
                <div className="mt-4 p-4 rounded-2xl bg-gradient-to-r from-[#A8D8B9]/20 to-[#7BC496]/20 text-center">
                  <div className="text-2xl mb-1">🎉✨🐱✨🎉</div>
                  <p className="font-bold text-[#4A7C59] text-sm">太棒了！所有任務都完成了！</p>
                </div>
              )}
            </>
          )}
        </div>

        <div
          className="h-3"
          style={{ background: 'repeating-linear-gradient(90deg, #FFD6A5, #FFD6A5 20px, #A8D8B9 20px, #A8D8B9 40px)' }}
        />
      </div>
    </div>
  )
}

// ============================================
// Header 元件
// ============================================

function Header({ todayStr, completionRate, error, className, classAlias, onLogout, onOpenSettings }) {
  // 優先顯示別名，若沒有別名則顯示班級名稱
  const displayName = classAlias || className

  return (
    <header className="bg-white/80 backdrop-blur-md rounded-3xl p-4 md:p-5 mb-6 shadow-lg border border-white/50">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 md:w-14 md:h-14 rounded-2xl bg-gradient-to-br from-[#A8D8B9] to-[#7BC496] flex items-center justify-center shadow-md">
            <PawPrint size={28} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-[#5D5D5D] flex items-center gap-2">
              🐾 {displayName || '呼嚕嚕小鎮'}
            </h1>
            <p className="text-xs md:text-sm text-[#8B8B8B]">
              {formatDateDisplay(todayStr)}
              {classAlias && className && className !== classAlias && (
                <span className="ml-2 text-[#A8D8B9]">({className})</span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#FFADAD]/20 text-[#FF8A8A] text-sm">
              <WifiOff size={16} />
              <span className="hidden sm:inline">連線異常</span>
            </div>
          )}

          <div className="flex items-center gap-3 bg-[#fdfbf7] px-4 py-2 rounded-2xl">
            <div className="hidden sm:block">
              <span className="text-xs text-[#8B8B8B]">今日達成率</span>
              <div className="text-lg font-bold text-[#5D5D5D]">
                {Math.round(completionRate * 100)}%
              </div>
            </div>
            <div className="w-24 md:w-32 h-3 bg-[#E8E8E8] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500 ease-out"
                style={{
                  width: `${completionRate * 100}%`,
                  background: completionRate >= 0.8
                    ? 'linear-gradient(90deg, #A8D8B9, #7BC496)'
                    : completionRate >= 0.5
                      ? 'linear-gradient(90deg, #FFD6A5, #FFBF69)'
                      : 'linear-gradient(90deg, #FFADAD, #FF8A8A)'
                }}
              />
            </div>
          </div>

          <button className="relative p-3 rounded-2xl bg-[#fdfbf7] hover:bg-[#A8D8B9]/20 transition-colors">
            <Bell size={22} className="text-[#5D5D5D]" />
            <span className="absolute top-2 right-2 w-2 h-2 bg-[#FFADAD] rounded-full" />
          </button>

          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="p-3 rounded-2xl bg-[#fdfbf7] hover:bg-[#FFD6A5]/20 transition-colors"
              title="村莊設定"
            >
              <Settings size={22} className="text-[#5D5D5D]" />
            </button>
          )}

          <button
            onClick={onLogout}
            className="p-3 rounded-2xl bg-[#fdfbf7] hover:bg-[#FFADAD]/20 transition-colors"
            title="返回村莊選擇"
          >
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

function DashboardView({ classId, className, classAlias, onLogout }) {
  console.log('=== DashboardView 組件開始渲染 ===')
  console.log('Props:', { classId, className, classAlias })

  // 核心 State：學生名單與所有歷史日誌
  const [students, setStudents] = useState([])
  const [allLogs, setAllLogs] = useState([]) // 所有歷史日誌 [{ date: '2026-01-18', tasks: [], status: {} }, ...]
  const [settings, setSettings] = useState({
    taskTypes: ['作業', '訂正', '攜帶物品', '考試', '通知單', '回條'] // 預設任務類型
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedStudent, setSelectedStudent] = useState(null)
  const [currentDate, setCurrentDate] = useState(new Date()) // 當前選中的日期
  const [showSettings, setShowSettings] = useState(false) // 顯示設定 Modal
  
  // 優先使用別名，若沒有別名則使用班級名稱
  const displayName = classAlias || className

  console.log('DashboardView 初始狀態:', {
    loading,
    error,
    studentsCount: students.length,
    allLogsCount: allLogs.length
  })

  // 標準化日期格式為 yyyy-MM-dd
  const normalizeDate = useCallback((date) => {
    if (typeof date === 'string') {
      // 如果是字串，嘗試解析並格式化
      try {
        const d = new Date(date)
        return formatDate(d)
      } catch {
        // 如果已經是 yyyy-MM-dd 格式，直接返回
        return date.split('T')[0] // 處理可能的 ISO 格式
      }
    }
    return formatDate(date)
  }, [])

  // Derived State：從 allLogs 和 currentDate 計算當天的 tasks 和 studentStatus
  const { tasks, studentStatus } = useMemo(() => {
    const dateStr = formatDate(currentDate) // 確保是 yyyy-MM-dd 格式
    // 使用標準化日期進行比對，確保格式一致
    const log = allLogs.find(log => {
      const logDate = normalizeDate(log.date)
      return logDate === dateStr
    })
    
    if (log) {
      // 確保 tasks 和 status 都有正確的 id
      const normalizedTasks = (log.tasks || []).map((task, index) => ({
        ...task,
        id: task.id || task.uuid || `task_${index}`
      }))
      return {
        tasks: normalizedTasks,
        studentStatus: log.status || {}
      }
    }
    
    // 如果找不到該日期的資料，返回空陣列和空物件
    return {
      tasks: [],
      studentStatus: {}
    }
  }, [allLogs, currentDate, normalizeDate])

  // 計算達成率
  const completionRate = useMemo(() => {
    if (students.length === 0 || tasks.length === 0) return 0
    const totalChecks = students.length * tasks.length
    let completedChecks = 0
    students.forEach(s => {
      tasks.forEach(t => {
        if (studentStatus[s.id]?.[t.id] === true) completedChecks++
      })
    })
    return completedChecks / totalChecks
  }, [students, tasks, studentStatus])

  // 載入所有班級資料（只在進入村莊時呼叫一次）
  const fetchAllData = useCallback(async () => {
    console.log('=== fetchAllData 開始 ===')
    // 不記錄 API_URL 以避免洩露敏感資訊
    console.log('classId:', classId)

    if (!API_URL || !classId) {
      console.error('缺少必要參數:', { API_URL, classId })
      setError('缺少必要參數')
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError(null)
      console.log('設置 loading = true')

      const url = `${API_URL}?action=get_class_data_all&classId=${classId}`
      // 不記錄完整 URL 以避免洩露 API 網址
      console.log('正在載入所有資料 (action: get_class_data_all)')

      const response = await fetch(url)
      console.log('Response status:', response.status)
      console.log('Response ok:', response.ok)

      if (!response.ok) {
        const errorText = await response.text()
        console.error('HTTP 錯誤回應:', errorText)
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`)
      }

      let data
      try {
        const text = await response.text()
        console.log('Response text:', text)
        data = JSON.parse(text)
        console.log('API 回傳資料 (解析後):', data)
      } catch (parseErr) {
        console.error('JSON 解析失敗:', parseErr)
        throw new Error(`JSON 解析失敗: ${parseErr.message}`)
      }

      // 確保 students 陣列中的每個學生都有 id 欄位
      const normalizedStudents = (data.students || []).map((student, index) => ({
        ...student,
        id: student.id || student.uuid || `student_${index}`
      }))

      // 標準化 logs 中的日期格式（確保字串格式一致）
      const normalizedLogs = (data.logs || []).map(log => {
        // 強制將日期轉換為 yyyy-MM-dd 字串格式
        const normalizedDate = normalizeDate(log.date)
        return {
          ...log,
          date: normalizedDate, // 標準化日期格式為 yyyy-MM-dd
          tasks: (log.tasks || []).map((task, index) => ({
            ...task,
            id: task.id || task.uuid || `task_${index}`
          })),
          status: log.status || {}
        }
      })

      // 讀取設定（如果後端有回傳）
      const normalizedSettings = data.settings || {
        taskTypes: ['作業', '訂正', '攜帶物品', '考試', '通知單', '回條']
      }

      console.log('正規化後的資料:', { 
        students: normalizedStudents, 
        logs: normalizedLogs,
        settings: normalizedSettings
      })

      setStudents(normalizedStudents)
      setAllLogs(normalizedLogs)
      setSettings(normalizedSettings)
      console.log('State 更新完成')
    } catch (err) {
      console.error('載入資料失敗 (完整錯誤):', err)
      console.error('錯誤堆疊:', err.stack)
      setError(`連線錯誤: ${err.message}`)
    } finally {
      console.log('設置 loading = false')
      setTimeout(() => {
        setLoading(false)
        console.log('Loading 狀態已更新為 false')
      }, 500)
    }
  }, [classId, normalizeDate])

  // 只在進入村莊時載入一次所有資料
  useEffect(() => {
    fetchAllData()
  }, [fetchAllData])

  // 處理日期變更（不呼叫 API，直接從 allLogs 讀取）
  const handleDateChange = (date) => {
    setCurrentDate(date)
    // 不觸發 API，tasks 和 studentStatus 會透過 useMemo 自動更新
  }

  // 更新本地 allLogs 中的特定日期資料
  const updateLogForDate = useCallback((dateStr, updates) => {
    setAllLogs(prev => {
      const normalizedDate = normalizeDate(dateStr)
      const existingIndex = prev.findIndex(log => normalizeDate(log.date) === normalizedDate)
      
      if (existingIndex >= 0) {
        // 更新現有日誌
        const newLogs = [...prev]
        newLogs[existingIndex] = {
          ...newLogs[existingIndex],
          ...updates
        }
        return newLogs
      } else {
        // 新增新日誌
        return [...prev, {
          date: normalizedDate,
          tasks: updates.tasks || [],
          status: updates.status || {}
        }]
      }
    })
  }, [normalizeDate])

  // 處理任務更新（先更新本地，再背景發送 API）
  const handleTasksUpdate = useCallback((updatedTasks) => {
    const dateStr = formatDate(currentDate)
    
    // 樂觀更新：立即更新本地 allLogs
    updateLogForDate(dateStr, { tasks: updatedTasks })

    // 背景執行 API 呼叫
    fetch(API_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'save_tasks',
        classId,
        date: dateStr,
        tasks: updatedTasks
      })
    }).catch(err => {
      console.error('發布任務失敗 (背景):', err)
    })
  }, [currentDate, classId, updateLogForDate])

  // 分組顯示：按照 group 分組
  const groupedStudents = useMemo(() => {
    const groups = {}
    students.forEach(student => {
      const group = student.group || 'A'
      if (!groups[group]) {
        groups[group] = []
      }
      groups[group].push(student)
    })
    // 按照 A, B, C... 排序
    return Object.keys(groups).sort().reduce((acc, key) => {
      acc[key] = groups[key]
      return acc
    }, {})
  }, [students])

  // 計算小隊完成率
  const getGroupCompletionRate = useCallback((groupStudents) => {
    if (tasks.length === 0 || groupStudents.length === 0) return 0
    const totalChecks = groupStudents.length * tasks.length
    let completedChecks = 0
    groupStudents.forEach(s => {
      tasks.forEach(t => {
        if (studentStatus[s.id]?.[t.id] === true) completedChecks++
      })
    })
    return totalChecks > 0 ? completedChecks / totalChecks : 0
  }, [tasks, studentStatus])

  // 更新狀態 - 嚴格單一學生更新（先更新本地，再背景發送 API）
  const toggleStatus = useCallback((studentId, taskId, checked) => {
    const dateStr = formatDate(currentDate)
    
    // 樂觀更新：立即更新本地 allLogs
    setAllLogs(prev => {
      const normalizedDate = normalizeDate(dateStr)
      const existingIndex = prev.findIndex(log => normalizeDate(log.date) === normalizedDate)
      
      if (existingIndex >= 0) {
        const newLogs = [...prev]
        const currentStatus = newLogs[existingIndex].status || {}
        newLogs[existingIndex] = {
          ...newLogs[existingIndex],
          status: {
            ...currentStatus,
            [studentId]: {
              ...currentStatus[studentId],
              [taskId]: checked
            }
          }
        }
        return newLogs
      } else {
        // 如果該日期還沒有日誌，建立新的
        return [...prev, {
          date: normalizedDate,
          tasks: tasks, // 使用當前的 tasks
          status: {
            [studentId]: {
              [taskId]: checked
            }
          }
        }]
      }
    })

    // 背景發送 POST 請求，包含 classId
    fetch(API_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'update_status',
        classId,
        date: dateStr,
        studentId,
        taskId,
        checked
      })
    }).catch(err => {
      console.error('更新狀態失敗 (背景):', err)
    })
  }, [classId, currentDate, normalizeDate, tasks])

  // 調試：顯示當前狀態
  useEffect(() => {
    console.log('DashboardView 狀態:', {
      loading,
      error,
      studentsCount: students.length,
      tasksCount: tasks.length,
      hasError: !!error
    })
  }, [loading, error, students.length, tasks.length])

  // Loading 畫面
  if (loading) {
    console.log('顯示 Loading 畫面')
    return <LoadingScreen message={`正在進入 ${displayName || '村莊'}...`} />
  }

  // 錯誤畫面
  if (error) {
    console.log('顯示錯誤畫面:', error)
    return (
      <div className="min-h-screen p-4 md:p-6 lg:p-8 bg-[#fdfbf7] flex items-center justify-center">
        <div className="bg-white rounded-3xl p-8 shadow-lg max-w-md w-full text-center">
          <div className="text-6xl mb-4">😿</div>
          <h2 className="text-2xl font-bold text-[#5D5D5D] mb-2">載入失敗</h2>
          <p className="text-[#8B8B8B] mb-4">{error}</p>
          <div className="space-y-3">
            <button
              onClick={fetchAllData}
              className="w-full px-6 py-3 rounded-2xl bg-gradient-to-r from-[#A8D8B9] to-[#7BC496] text-white font-medium
                hover:shadow-lg transition-all"
            >
              🔄 重新載入
            </button>
            <button
              onClick={onLogout}
              className="w-full px-6 py-3 rounded-2xl bg-[#E8E8E8] text-[#5D5D5D] font-medium
                hover:bg-[#D8D8D8] transition-all"
            >
              ← 返回村莊列表
            </button>
          </div>
          <div className="mt-6 p-4 bg-[#FFD6A5]/20 rounded-xl text-left">
            <p className="text-xs text-[#8B8B8B] mb-2">調試資訊：</p>
            <p className="text-xs text-[#5D5D5D] font-mono break-all">
              classId: {classId || '未設定'}<br />
              API 連線: {API_URL ? '✓ 已設定' : '✗ 未設定'}<br />
              date: {formatDate(currentDate)}
            </p>
          </div>
        </div>
      </div>
    )
  }

  // 統計（修正狀態判定邏輯）
  const purrCount = students.filter(s => {
    const st = studentStatus[s.id] || {}
    // 呼嚕：tasks.length > 0 且該學生全為 true
    return tasks.length > 0 && tasks.every(t => st[t.id] === true)
  }).length

  const angryCount = students.filter(s => {
    const st = studentStatus[s.id] || {}
    // 炸毛：tasks.length > 0 且該學生有 false 的項目
    return tasks.length > 0 && tasks.some(t => st[t.id] !== true)
  }).length

  console.log('DashboardView 準備渲染:', {
    studentsCount: students.length,
    tasksCount: tasks.length,
    purrCount,
    angryCount,
    completionRate
  })

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8 bg-[#fdfbf7]">
      <Header
        todayStr={formatDate(currentDate)}
        completionRate={completionRate}
        error={error}
        className={className}
        classAlias={classAlias}
        onLogout={onLogout}
        onOpenSettings={() => setShowSettings(true)}
      />

      {/* 左右兩欄式佈局 */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* 左側欄：固定寬度 350px，包含日曆和任務區 */}
        <aside className="w-full lg:w-[350px] lg:shrink-0 space-y-4">
          {/* 整合的側邊欄容器 */}
          <div className="bg-white/60 backdrop-blur-sm rounded-3xl p-4 shadow-lg border border-white/50 space-y-6">
            {/* 村莊日誌 */}
            <div>
              <h2 className="text-lg font-bold text-[#5D5D5D] mb-4 flex items-center gap-2">
                <CalendarIcon size={20} className="text-[#A8D8B9]" />
                📅 村莊日誌
              </h2>
              <CalendarNav
                currentDate={currentDate}
                onDateChange={handleDateChange}
              />
            </div>

            {/* 分隔線 */}
            <div className="h-px bg-gradient-to-r from-transparent via-[#E8E8E8] to-transparent" />

            {/* 今日委託 */}
            <div>
              <TaskBoard
                tasks={tasks}
                students={students}
                studentStatus={studentStatus}
                classId={classId}
                currentDateStr={formatDate(currentDate)}
                onTasksUpdate={handleTasksUpdate}
                taskTypes={settings.taskTypes}
                compact={true}
              />
            </div>
          </div>
        </aside>

        {/* 右側欄：村民廣場 (flex-1) */}
        <main className="flex-1 min-w-0">
          <div className="bg-white/60 backdrop-blur-sm rounded-3xl p-6 shadow-lg border border-white/50">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-[#5D5D5D] flex items-center gap-2">
                <Users size={24} className="text-[#A8D8B9]" />
                🏘️ 村民廣場
                <span className="text-sm font-normal text-[#8B8B8B]">
                  ({students.length} 位村民)
                </span>
              </h2>

              <div className="flex items-center gap-3">
                <span className="px-3 py-1 rounded-full text-xs font-medium bg-[#A8D8B9]/30 text-[#4A7C59]">
                  ✨ {purrCount} 已完成
                </span>
                <span className="px-3 py-1 rounded-full text-xs font-medium bg-[#FFADAD]/30 text-[#D64545]">
                  💢 {angryCount} 未完成
                </span>
              </div>
            </div>

            {students.length === 0 ? (
              <div className="text-center py-16">
                <div className="text-6xl mb-4">🏠</div>
                <p className="text-[#8B8B8B] text-lg">目前沒有村民資料</p>
                <p className="text-[#B8B8B8] text-sm mt-2">請確認 API 連線正常</p>
              </div>
            ) : (
              <div className="space-y-6">
                {Object.entries(groupedStudents).map(([group, groupStudents]) => {
                  const completionRate = getGroupCompletionRate(groupStudents)
                  const isComplete = completionRate === 1 && tasks.length > 0

                  return (
                    <div
                      key={group}
                      className={`p-4 rounded-2xl transition-all ${
                        isComplete
                          ? 'bg-yellow-50 border-4 border-yellow-400 shadow-[0_0_20px_rgba(250,204,21,0.6)]'
                          : 'bg-white/40 border border-white/50'
                      }`}
                    >
                      {/* 小隊標題與進度 */}
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <Flag size={20} className="text-[#FF8A8A]" />
                          <h3 className="text-lg font-bold text-[#5D5D5D]">
                            🚩 {group} 小隊
                          </h3>
                          {/* 完成徽章 */}
                          {isComplete && (
                            <span className="flex items-center gap-1 px-2 py-1 rounded-lg bg-yellow-400 text-yellow-900 text-xs font-bold">
                              <Trophy size={14} />
                              🏆 全員達成！
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex-1 w-24 h-2 bg-[#E8E8E8] rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${completionRate * 100}%`,
                                background: isComplete
                                  ? 'linear-gradient(90deg, #FFD700, #FFA500)'
                                  : 'linear-gradient(90deg, #A8D8B9, #7BC496)'
                              }}
                            />
                          </div>
                          <span className="text-xs text-[#8B8B8B] whitespace-nowrap">
                            {Math.round(completionRate * 100)}%
                          </span>
                        </div>
                      </div>

                      {/* 小隊成員 */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-3">
                        {groupStudents
                          .filter(student => student && student.id)
                          .map((student, index) => (
                            <div
                              key={student.id}
                              style={{
                                animation: 'slideUp 0.5s ease-out forwards',
                                animationDelay: `${index * 0.03}s`,
                                opacity: 0
                              }}
                            >
                              <VillagerCard
                                student={student}
                                tasks={tasks}
                                studentStatus={studentStatus}
                                onClick={() => setSelectedStudent(student)}
                              />
                            </div>
                          ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div
            className="mt-6 rounded-3xl p-5 text-center shadow-lg"
            style={{ background: 'linear-gradient(135deg, #A8D8B9 0%, #7BC496 100%)' }}
          >
            <p className="text-white font-medium flex items-center justify-center gap-3">
              <span className="text-2xl">🐾</span>
              點擊村民卡片，開啟護照進行管理
              <span className="text-2xl">🐾</span>
            </p>
          </div>
        </main>
      </div>

      <footer className="mt-10 text-center text-[#8B8B8B] text-sm">
        <p className="flex items-center justify-center gap-2">
          <PawPrint size={16} className="text-[#A8D8B9]" />
          呼嚕嚕小鎮 Purr Purr Town v2.0 © 2026
          <PawPrint size={16} className="text-[#A8D8B9]" />
        </p>
      </footer>

      {selectedStudent && (
        <PassportModal
          student={selectedStudent}
          tasks={tasks}
          studentStatus={studentStatus}
          classId={classId}
          onClose={() => setSelectedStudent(null)}
          onToggleStatus={toggleStatus}
          onStudentUpdate={(updatedStudent) => {
            // 樂觀更新：立即更新 students state，不重新載入資料
            if (updatedStudent) {
              setStudents(prev => prev.map(s => 
                s.id === updatedStudent.id || s.uuid === updatedStudent.uuid 
                  ? updatedStudent 
                  : s
              ))
            }
            setSelectedStudent(null)
          }}
        />
      )}

      {showSettings && (
        <SettingsModal
          classId={classId}
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSave={(newSettings) => {
            setSettings(newSettings)
            setShowSettings(false)
          }}
        />
      )}

    </div>
  )
}

// ============================================
// 主應用程式
// ============================================

function App() {
  console.log('=== App 組件開始渲染 ===')
  
  const [selectedClass, setSelectedClass] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  console.log('App 狀態:', { selectedClass, loading, error })

  // 接收 classId, displayName 和 alias
  const handleSelectClass = (classId, displayName, alias) => {
    console.log('handleSelectClass 被調用:', { classId, displayName, alias })
    setSelectedClass({ 
      id: classId, 
      name: displayName || `班級 ${classId}`,
      alias: alias || null  // 別名 (Optional)
    })
  }

  const handleLogout = () => {
    console.log('handleLogout 被調用')
    setSelectedClass(null)
  }

  // 根據狀態顯示不同頁面
  if (!selectedClass) {
    console.log('顯示 LoginView')
    return (
      <LoginView
        onSelectClass={handleSelectClass}
        loading={loading}
        error={error}
      />
    )
  }

  console.log('顯示 DashboardView, classId:', selectedClass.id)
  return (
    <DashboardView
      classId={selectedClass.id}
      className={selectedClass.name}
      classAlias={selectedClass.alias}
      onLogout={handleLogout}
    />
  )
}

export default App
