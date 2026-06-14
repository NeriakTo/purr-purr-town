import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X, Download, Lock, Unlock, Play, Square, ChevronDown, Check, Loader2, AlertCircle, Eye, EyeOff } from 'lucide-react'
import { COMMENT_STATUS } from '../../utils/constants'
import { getCurrentSemester, ensureStudentComments, initializeSemesterComment, isActiveStudent } from '../../utils/helpers'
import { generateComment, generateCommentsBatch } from '../../utils/commentService'
import { exportCommentsToExcel } from '../../utils/exportUtils'
import CommentPanel from './CommentPanel'

const LS_KEY_API = 'ppt_gemini_api_key'
const LS_KEY_TIER = 'ppt_gemini_key_tier'
const LS_KEY_PWD = 'ppt_comment_password'

function CommentModal({ students, settings, className, onClose, onUpdateStudents }) {
  // 密碼閘門
  const savedPassword = localStorage.getItem(LS_KEY_PWD)
  const [authenticated, setAuthenticated] = useState(!savedPassword)
  const [passwordInput, setPasswordInput] = useState('')
  const [passwordError, setPasswordError] = useState(false)

  // 學期
  const defaultSemester = settings.currentSemester || getCurrentSemester()
  const [semester, setSemester] = useState(defaultSemester)

  // API 設定
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(LS_KEY_API) || '')
  const [keyTier, setKeyTier] = useState(() => localStorage.getItem(LS_KEY_TIER) || 'free')
  const [showApiKey, setShowApiKey] = useState(false)
  const [showApiSettings, setShowApiSettings] = useState(false)

  // 收集所有已存在的學期 key
  const availableSemesters = useMemo(() => {
    const set = new Set([semester])
    students.forEach(s => {
      if (s.comments && typeof s.comments === 'object') {
        Object.keys(s.comments).forEach(k => set.add(k))
      }
    })
    return [...set].sort()
  }, [students, semester])

  // 展開的學生面板
  const [expandedStudentId, setExpandedStudentId] = useState(null)

  // 批次生成
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchProgress, setBatchProgress] = useState({ completed: 0, failed: 0, total: 0 })
  const abortRef = useRef(null)

  // 單一生成中的學生 ID
  const [generatingIds, setGeneratingIds] = useState(new Set())

  const activeStudents = useMemo(() =>
    students.filter(isActiveStudent).sort((a, b) => (a.number || 0) - (b.number || 0)),
    [students]
  )

  // 儲存 API key 到 localStorage
  useEffect(() => {
    if (apiKey) {
      localStorage.setItem(LS_KEY_API, apiKey)
    } else {
      localStorage.removeItem(LS_KEY_API)
    }
  }, [apiKey])

  useEffect(() => {
    localStorage.setItem(LS_KEY_TIER, keyTier)
  }, [keyTier])

  // 密碼驗證
  const handlePasswordSubmit = (e) => {
    e.preventDefault()
    if (passwordInput === savedPassword) {
      setAuthenticated(true)
      setPasswordError(false)
    } else {
      setPasswordError(true)
    }
  }

  // 更新學生評語
  const handleUpdateComment = useCallback((studentId, newComments) => {
    onUpdateStudents(prev => prev.map(s =>
      s.id === studentId ? { ...s, comments: newComments } : s
    ))
  }, [onUpdateStudents])

  // unmount 時中斷批次生成
  useEffect(() => {
    return () => { abortRef.current?.abort() }
  }, [])

  // 用 callback 方式更新生成結果，讀取最新 state 避免覆蓋使用者編輯
  const applyGenerationResult = useCallback((studentId, sem, updater) => {
    onUpdateStudents(prev => prev.map(s => {
      if (s.id !== studentId) return s
      const ensured = ensureStudentComments(s)
      const comments = initializeSemesterComment(ensured.comments, sem)
      const semData = comments[sem]
      return { ...s, comments: { ...comments, [sem]: updater(semData) } }
    }))
  }, [onUpdateStudents])

  // 單一學生生成
  const handleGenerateSingle = useCallback(async (studentId, sem) => {
    if (!apiKey) {
      setShowApiSettings(true)
      return
    }
    const student = students.find(s => s.id === studentId)
    if (!student) return

    const ensured = ensureStudentComments(student)
    const comments = initializeSemesterComment(ensured.comments, sem)
    const semData = comments[sem]
    if (semData.locked || !semData.rawComment?.trim()) return

    setGeneratingIds(prev => new Set(prev).add(studentId))

    // 標記生成中
    applyGenerationResult(studentId, sem, (sd) => ({
      ...sd, status: COMMENT_STATUS.GENERATING, errorMessage: '',
    }))

    try {
      const result = await generateComment({
        name: student.name,
        rawComment: semData.rawComment,
        keyTier,
        apiKey,
      })
      applyGenerationResult(studentId, sem, (sd) => ({
        ...sd,
        polishedComment: result.comment,
        motto: result.motto,
        analysis: result.analysis,
        modelUsed: result.modelUsed,
        status: COMMENT_STATUS.DONE,
        errorMessage: '',
        generatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }))
    } catch (err) {
      applyGenerationResult(studentId, sem, (sd) => ({
        ...sd,
        status: COMMENT_STATUS.ERROR,
        errorMessage: err.message,
        updatedAt: new Date().toISOString(),
      }))
    } finally {
      setGeneratingIds(prev => {
        const next = new Set(prev)
        next.delete(studentId)
        return next
      })
    }
  }, [apiKey, keyTier, students, applyGenerationResult])

  // 批次生成
  const handleBatchGenerate = useCallback(async () => {
    if (!apiKey) {
      setShowApiSettings(true)
      return
    }

    const pending = activeStudents.filter(s => {
      const ensured = ensureStudentComments(s)
      const comments = initializeSemesterComment(ensured.comments, semester)
      const sd = comments[semester]
      return !sd.locked && sd.rawComment?.trim() && sd.status !== COMMENT_STATUS.DONE
    }).map(s => ({
      id: s.id,
      name: s.name,
      rawComment: ensureStudentComments(s).comments[semester]?.rawComment || initializeSemesterComment(ensureStudentComments(s).comments, semester)[semester].rawComment,
    }))

    if (pending.length === 0) return

    const controller = new AbortController()
    abortRef.current = controller
    setBatchRunning(true)
    setBatchProgress({ completed: 0, failed: 0, total: pending.length })

    // 標記所有 pending 為 generating
    onUpdateStudents(prev => prev.map(s => {
      if (!pending.find(p => p.id === s.id)) return s
      const ensured = ensureStudentComments(s)
      const comments = initializeSemesterComment(ensured.comments, semester)
      return {
        ...s,
        comments: {
          ...comments,
          [semester]: { ...comments[semester], status: COMMENT_STATUS.GENERATING, errorMessage: '' },
        },
      }
    }))

    try {
      await generateCommentsBatch({
        students: pending,
        keyTier,
        apiKey,
        semester,
        signal: controller.signal,
        onProgress: (studentId, result) => {
          setBatchProgress(prev => ({
            ...prev,
            completed: result.success ? prev.completed + 1 : prev.completed,
            failed: result.success ? prev.failed : prev.failed + 1,
          }))

          if (result.success) {
            applyGenerationResult(studentId, semester, (sd) => ({
              ...sd,
              polishedComment: result.comment,
              motto: result.motto,
              analysis: result.analysis,
              modelUsed: result.modelUsed,
              status: COMMENT_STATUS.DONE,
              errorMessage: '',
              generatedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }))
          } else {
            applyGenerationResult(studentId, semester, (sd) => ({
              ...sd,
              status: COMMENT_STATUS.ERROR,
              errorMessage: result.error,
              updatedAt: new Date().toISOString(),
            }))
          }
        },
      })
    } finally {
      setBatchRunning(false)
      abortRef.current = null
    }
  }, [apiKey, keyTier, activeStudents, semester, applyGenerationResult])

  const handleStopBatch = () => {
    abortRef.current?.abort()
    setBatchRunning(false)
  }

  // 匯出
  const handleExport = useCallback(() => {
    const data = activeStudents.map(s => {
      const ensured = ensureStudentComments(s)
      const sd = ensured.comments[semester] || {}
      return {
        number: s.number,
        name: s.name,
        rawComment: sd.rawComment || '',
        polishedComment: sd.polishedComment || '',
        motto: sd.motto || '',
        analysis: sd.analysis || '',
        status: sd.status || COMMENT_STATUS.IDLE,
      }
    })
    exportCommentsToExcel(data, semester, className)
  }, [activeStudents, semester, className])

  // 統計
  const stats = useMemo(() => {
    let done = 0, hasRaw = 0, locked = 0
    activeStudents.forEach(s => {
      const sd = ensureStudentComments(s).comments[semester]
      if (!sd) return
      if (sd.status === COMMENT_STATUS.DONE) done++
      if (sd.rawComment?.trim()) hasRaw++
      if (sd.locked) locked++
    })
    return { done, hasRaw, locked, total: activeStudents.length }
  }, [activeStudents, semester])

  // --- 密碼閘門畫面 ---
  if (!authenticated) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
        <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6">
          <div className="text-center mb-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#A8D8B9] to-[#7BC496] flex items-center justify-center mx-auto mb-3 shadow-md">
              <Lock size={32} className="text-white" />
            </div>
            <h2 className="text-xl font-bold text-[#5D5D5D]">評語助手</h2>
            <p className="text-sm text-[#8B8B8B] mt-1">請輸入老師密碼</p>
            <p className="text-xs text-[#B8B8B8] mt-0.5">此密碼僅防誤觸，不防 DevTools</p>
          </div>
          <form onSubmit={handlePasswordSubmit}>
            <input
              type="password"
              value={passwordInput}
              onChange={(e) => { setPasswordInput(e.target.value); setPasswordError(false) }}
              placeholder="密碼"
              autoFocus
              className={`w-full px-4 py-3 rounded-xl border ${passwordError ? 'border-[#D64545] bg-[#FFADAD]/5' : 'border-[#E8E8E8]'} focus:border-[#A8D8B9] focus:ring-1 focus:ring-[#A8D8B9] outline-none text-center text-lg`}
            />
            {passwordError && (
              <p className="text-sm text-[#D64545] text-center mt-2">密碼錯誤，請重試</p>
            )}
            <button
              type="submit"
              className="w-full mt-4 py-3 rounded-xl bg-gradient-to-r from-[#A8D8B9] to-[#7BC496] text-white font-medium hover:from-[#7BC496] hover:to-[#5DAF7E] transition-colors shadow-md"
            >
              確認
            </button>
          </form>
          <button
            onClick={onClose}
            className="w-full mt-2 py-2 text-sm text-[#8B8B8B] hover:text-[#5D5D5D]"
          >
            取消
          </button>
        </div>
      </div>
    )
  }

  // --- 主畫面 ---
  const semesterDisplay = semester.replace('-', '學年 第') + '學期'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-[#fdfbf7] rounded-3xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="sticky top-0 bg-white/90 backdrop-blur-md px-6 py-4 border-b border-[#E8E8E8] shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold text-[#5D5D5D]">📝 評語助手</h2>
              <select
                value={semester}
                onChange={(e) => setSemester(e.target.value)}
                className="text-sm text-[#5D5D5D] bg-[#F0F0F0] px-3 py-1.5 rounded-full border-none outline-none cursor-pointer hover:bg-[#E8E8E8] transition-colors"
              >
                {availableSemesters.map(sem => (
                  <option key={sem} value={sem}>
                    {sem.replace('-', '學年 第')}學期
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleExport}
                className="p-2 rounded-xl bg-[#fdfbf7] hover:bg-[#A8D8B9]/20 transition-colors"
                title="匯出 Excel"
              >
                <Download size={20} className="text-[#5D5D5D]" />
              </button>
              <button onClick={onClose} className="p-2 rounded-xl hover:bg-[#F0F0F0] transition-colors">
                <X size={20} className="text-[#5D5D5D]" />
              </button>
            </div>
          </div>

          {/* 統計列 + API 設定 */}
          <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
            <div className="flex items-center gap-3 text-sm text-[#8B8B8B]">
              <span>已完成 <strong className="text-[#7BC496]">{stats.done}</strong>/{stats.total}</span>
              <span>已填紀錄 <strong className="text-[#5D5D5D]">{stats.hasRaw}</strong></span>
              <span>已鎖定 <strong className="text-[#D64545]">{stats.locked}</strong></span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowApiSettings(v => !v)}
                className={`text-xs px-3 py-1.5 rounded-full transition-colors ${apiKey ? 'bg-[#A8D8B9]/20 text-[#5D5D5D]' : 'bg-[#FFADAD]/20 text-[#D64545]'}`}
              >
                {apiKey ? '⚙️ API 已設定' : '⚠️ 請設定 API Key'}
              </button>
            </div>
          </div>

          {/* API 設定面板（摺疊） */}
          {showApiSettings && (
            <div className="mt-3 p-3 rounded-xl bg-[#F5F5F5] border border-[#E8E8E8] space-y-2">
              <div className="flex items-center gap-2">
                <label className="text-sm text-[#5D5D5D] shrink-0 w-20">API Key</label>
                <div className="flex-1 relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="貼上你的 Gemini API Key"
                    className="w-full px-3 py-2 pr-10 rounded-lg border border-[#E8E8E8] focus:border-[#A8D8B9] outline-none text-sm"
                  />
                  <button
                    onClick={() => setShowApiKey(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#8B8B8B] hover:text-[#5D5D5D]"
                  >
                    {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-[#5D5D5D] shrink-0 w-20">方案</label>
                <div className="flex gap-2">
                  {['free', 'paid'].map(tier => (
                    <button
                      key={tier}
                      onClick={() => setKeyTier(tier)}
                      className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                        keyTier === tier
                          ? 'bg-[#A8D8B9] text-white'
                          : 'bg-white border border-[#E8E8E8] text-[#8B8B8B] hover:bg-[#fdfbf7]'
                      }`}
                    >
                      {tier === 'free' ? '免費版' : '付費版'}
                    </button>
                  ))}
                </div>
                <span className="text-xs text-[#B8B8B8]">
                  {keyTier === 'free' ? '間隔 5 秒' : '間隔 2 秒'}
                </span>
              </div>
            </div>
          )}

          {/* 批次操作列 */}
          <div className="flex items-center gap-2 mt-3">
            {batchRunning ? (
              <>
                <button
                  onClick={handleStopBatch}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#FFADAD] text-white font-medium text-sm hover:bg-[#D64545] transition-colors"
                >
                  <Square size={14} /> 停止生成
                </button>
                <div className="flex-1 flex items-center gap-2">
                  <div className="flex-1 h-2 bg-[#E8E8E8] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#7BC496] rounded-full transition-all duration-300"
                      style={{ width: `${batchProgress.total > 0 ? ((batchProgress.completed + batchProgress.failed) / batchProgress.total) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="text-xs text-[#8B8B8B] shrink-0">
                    {batchProgress.completed + batchProgress.failed}/{batchProgress.total}
                  </span>
                </div>
              </>
            ) : (
              <button
                onClick={handleBatchGenerate}
                disabled={!apiKey || stats.hasRaw === 0}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm transition-colors ${
                  apiKey && stats.hasRaw > 0
                    ? 'bg-gradient-to-r from-[#A8D8B9] to-[#7BC496] text-white hover:from-[#7BC496] hover:to-[#5DAF7E] shadow-md'
                    : 'bg-[#E8E8E8] text-[#B8B8B8] cursor-not-allowed'
                }`}
              >
                <Play size={14} /> 全班一鍵生成
              </button>
            )}
          </div>
        </div>

        {/* 學生列表 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {activeStudents.length === 0 && (
            <div className="text-center py-12 text-[#B8B8B8]">
              <p className="text-lg mb-1">尚無學生資料</p>
              <p className="text-sm">請先在村莊設定中新增學生</p>
            </div>
          )}
          {activeStudents.map((student) => {
            const ensured = ensureStudentComments(student)
            const sd = ensured.comments[semester] || {}
            const status = sd.status || COMMENT_STATUS.IDLE
            const isExpanded = expandedStudentId === student.id

            return (
              <div key={student.id}>
                {/* 摘要列 */}
                <button
                  onClick={() => setExpandedStudentId(isExpanded ? null : student.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition-colors ${
                    isExpanded ? 'bg-white shadow-md border border-[#A8D8B9]/30' : 'bg-white/60 hover:bg-white border border-transparent'
                  }`}
                >
                  <span className="w-8 text-center text-sm font-bold text-[#8B8B8B]">{student.number}</span>
                  <span className="flex-1 font-medium text-[#5D5D5D] truncate">{student.name}</span>

                  {/* 觀察紀錄預覽 */}
                  <span className="hidden sm:block max-w-[120px] text-xs text-[#B8B8B8] truncate">
                    {sd.rawComment || '(未填)'}
                  </span>

                  {/* 狀態標記 */}
                  <span className="shrink-0">
                    {status === COMMENT_STATUS.DONE && <Check size={16} className="text-[#7BC496]" />}
                    {status === COMMENT_STATUS.GENERATING && <Loader2 size={16} className="text-[#FFBF69] animate-spin" />}
                    {status === COMMENT_STATUS.ERROR && <AlertCircle size={16} className="text-[#D64545]" />}
                  </span>

                  {/* 鎖定標記 */}
                  {sd.locked && <Lock size={14} className="text-[#D64545] shrink-0" />}

                  <ChevronDown
                    size={16}
                    className={`text-[#B8B8B8] shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  />
                </button>

                {/* 展開面板 */}
                {isExpanded && (
                  <div className="mt-2 ml-4 mr-1">
                    <CommentPanel
                      student={ensured}
                      semester={semester}
                      onUpdateComment={handleUpdateComment}
                      onGenerate={handleGenerateSingle}
                      isGenerating={generatingIds.has(student.id)}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default CommentModal
