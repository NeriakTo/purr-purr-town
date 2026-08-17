import { useEffect, useState, useMemo } from 'react'
import { X, Home, Calendar as CalendarIcon, School, User, Sparkles, Users, Loader2, Plus, Copy } from 'lucide-react'
import { loadClassCache } from '../../utils/helpers'
import { summarizeInheritance } from '../../utils/classInherit'

function CreateClassModal({ onClose, onSuccess, onCreateLocalClass, existingClasses = [] }) {
  const [formData, setFormData] = useState({
    year: '',
    className: '',
    teacher: '',
    alias: '',
    studentCount: '30'
  })
  const [sourceClassId, setSourceClassId] = useState('')
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)

  // 選定來源班級時，預覽會帶走哪些設定
  const inheritPreview = useMemo(() => {
    if (!sourceClassId) return []
    const cache = loadClassCache(sourceClassId)
    return cache?.settings ? summarizeInheritance(cache.settings) : []
  }, [sourceClassId])

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
        studentCount: parseInt(formData.studentCount.trim(), 10),
        sourceClassId: sourceClassId || null
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

            {existingClasses.length > 0 && (
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-[#5D5D5D] mb-2">
                  <Copy size={16} className="text-[#A0C4FF]" />帶入既有村莊設定 <span className="text-xs text-[#8B8B8B] font-normal">(選填)</span>
                </label>
                <select
                  value={sourceClassId}
                  onChange={(e) => setSourceClassId(e.target.value)}
                  disabled={submitting}
                  className="w-full px-4 py-3 rounded-2xl border-2 transition-all outline-none border-[#E8E8E8] focus:border-[#A8D8B9] bg-white text-[#5D5D5D]"
                >
                  <option value="">不帶入，使用預設設定</option>
                  {existingClasses.map(c => (
                    <option key={c.id} value={c.id}>{c.alias || c.name}</option>
                  ))}
                </select>
                {sourceClassId && (
                  <div className="mt-2 p-3 rounded-xl bg-[#F0F5FF] border border-[#A0C4FF]/30 text-xs text-[#5D5D5D] space-y-1">
                    <p className="font-medium">會帶走：</p>
                    {inheritPreview.length > 0
                      ? <ul className="list-disc list-inside text-[#6B7B8B] space-y-0.5">{inheritPreview.map((t, i) => <li key={i}>{t}</li>)}</ul>
                      : <p className="text-[#8B8B8B]">此村莊沒有可帶入的自訂設定。</p>}
                    <p className="text-[10px] text-[#8B8B8B] pt-1">學生名單、職務指派、座位、公告不會帶入，維持新班空白。</p>
                  </div>
                )}
              </div>
            )}

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

export default CreateClassModal
