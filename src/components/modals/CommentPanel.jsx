import { useState, useMemo } from 'react'
import { Lock, Unlock, Loader2, AlertCircle, Sparkles } from 'lucide-react'
import { DEFAULT_COMMENT_TAGS, COMMENT_SUBJECTS, COMMENT_STATUS } from '../../utils/constants'
import { getAvatarMeta, initializeSemesterComment } from '../../utils/helpers'

function CommentPanel({ student, semester, onUpdateComment, onGenerate, isGenerating }) {
  const [selectedSubject, setSelectedSubject] = useState('一般導師')
  const avatarMeta = useMemo(() => getAvatarMeta(student.avatarSeed), [student.avatarSeed])

  const comments = student.comments || {}
  const semesterData = comments[semester] || {
    rawComment: '',
    polishedComment: '',
    motto: '',
    analysis: '',
    lockedComment: false,
    lockedMotto: false,
    status: COMMENT_STATUS.IDLE,
    errorMessage: '',
  }

  // 向後相容：舊版 locked 欄位映射為雙鎖定
  const isCommentLocked = semesterData.lockedComment ?? semesterData.locked ?? false
  const isMottoLocked = semesterData.lockedMotto ?? semesterData.locked ?? false
  const isBothLocked = isCommentLocked && isMottoLocked
  const status = semesterData.status || COMMENT_STATUS.IDLE
  const currentTags = DEFAULT_COMMENT_TAGS[selectedSubject] || DEFAULT_COMMENT_TAGS['一般導師']

  const updateSemesterData = (patch) => {
    const updated = initializeSemesterComment(comments, semester)
    onUpdateComment(student.id, {
      ...updated,
      [semester]: { ...updated[semester], ...patch, updatedAt: new Date().toISOString() },
    })
  }

  const handleRawCommentChange = (value) => {
    updateSemesterData({ rawComment: value })
  }

  const handlePolishedCommentChange = (value) => {
    if (isCommentLocked) return
    updateSemesterData({ polishedComment: value })
  }

  const handleMottoChange = (value) => {
    if (isMottoLocked) return
    updateSemesterData({ motto: value })
  }

  const handleToggleCommentLock = () => {
    updateSemesterData({ lockedComment: !isCommentLocked })
  }

  const handleToggleMottoLock = () => {
    updateSemesterData({ lockedMotto: !isMottoLocked })
  }

  const handleAddTag = (tag) => {
    const current = semesterData.rawComment || ''
    const separator = current && !current.endsWith('，') && !current.endsWith('、') && !current.endsWith('\n') && current.length > 0 ? '、' : ''
    handleRawCommentChange(current + separator + tag)
  }

  const handleGenerate = () => {
    if (isBothLocked || !semesterData.rawComment?.trim()) return
    onGenerate(student.id, semester)
  }

  const canGenerate = !isBothLocked && semesterData.rawComment?.trim() && status !== COMMENT_STATUS.GENERATING

  return (
    <div className="bg-white rounded-2xl border border-[#E8E8E8] p-4 space-y-3">
      {/* 學生資訊列 */}
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
          style={{ backgroundColor: avatarMeta.bg }}
        >
          {avatarMeta.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-[#5D5D5D]">
            {student.number}號 {student.name}
          </div>
          {semesterData.modelUsed && (
            <div className="text-xs text-[#B8B8B8]">模型：{semesterData.modelUsed}</div>
          )}
        </div>
      </div>

      {/* 觀察紀錄 */}
      <div>
        <label className="text-sm font-medium text-[#5D5D5D] mb-1 block">觀察紀錄</label>
        <textarea
          value={semesterData.rawComment || ''}
          onChange={(e) => handleRawCommentChange(e.target.value)}
          placeholder="輸入對學生的觀察，或點擊下方標籤快速插入..."
          className="w-full min-h-[80px] p-3 rounded-xl border border-[#E8E8E8] focus:border-[#A8D8B9] focus:ring-1 focus:ring-[#A8D8B9] outline-none resize-y text-sm text-[#5D5D5D] transition-colors"
        />
      </div>

      {/* 標籤快速插入 */}
      <div>
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          {COMMENT_SUBJECTS.map((subj) => (
            <button
              key={subj}
              onClick={() => setSelectedSubject(subj)}
              className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                selectedSubject === subj
                  ? 'bg-[#A8D8B9] text-white font-medium'
                  : 'bg-[#F0F0F0] text-[#8B8B8B] hover:bg-[#E8E8E8]'
              }`}
            >
              {subj}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {currentTags.map((tag) => (
            <button
              key={tag}
              onClick={() => handleAddTag(tag)}
              className="text-xs px-2.5 py-1 rounded-full bg-[#fdfbf7] border border-[#E8E8E8] text-[#5D5D5D] hover:bg-[#A8D8B9]/20 hover:border-[#A8D8B9] transition-colors"
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* 生成按鈕 */}
      <button
        onClick={handleGenerate}
        disabled={!canGenerate || isGenerating}
        className={`w-full py-2.5 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-colors ${
          canGenerate && !isGenerating
            ? 'bg-gradient-to-r from-[#A8D8B9] to-[#7BC496] text-white hover:from-[#7BC496] hover:to-[#5DAF7E] shadow-md'
            : 'bg-[#E8E8E8] text-[#B8B8B8] cursor-not-allowed'
        }`}
      >
        {status === COMMENT_STATUS.GENERATING || isGenerating ? (
          <><Loader2 size={16} className="animate-spin" /> 生成中...</>
        ) : isBothLocked ? (
          <>評語與箴言皆已鎖定</>
        ) : (
          <><Sparkles size={16} /> 幫我寫</>
        )}
      </button>

      {/* 錯誤訊息 */}
      {status === COMMENT_STATUS.ERROR && semesterData.errorMessage && (
        <div className="flex items-start gap-2 p-2.5 rounded-xl bg-[#FFADAD]/10 border border-[#FFADAD]/30">
          <AlertCircle size={16} className="text-[#D64545] shrink-0 mt-0.5" />
          <p className="text-xs text-[#D64545]">{semesterData.errorMessage}</p>
        </div>
      )}

      {/* 評語結果 */}
      {(semesterData.polishedComment || semesterData.motto || status === COMMENT_STATUS.DONE) && (
        <div className="space-y-3">
          {/* 八字箴言 */}
          <div className={`p-3 rounded-xl border ${isMottoLocked ? 'border-[#FFADAD]/50 bg-[#FFADAD]/5' : 'border-[#A8D8B9]/50 bg-[#A8D8B9]/5'}`}>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-[#5D5D5D]">八字箴言</label>
              <button
                onClick={handleToggleMottoLock}
                className={`p-1.5 rounded-lg transition-colors ${isMottoLocked ? 'bg-[#FFADAD]/20 text-[#D64545]' : 'text-[#B8B8B8] hover:bg-[#E8E8E8]'}`}
                title={isMottoLocked ? '已鎖定：AI 不會覆寫此欄位' : '未鎖定：AI 可覆寫此欄位'}
              >
                {isMottoLocked ? <Lock size={14} /> : <Unlock size={14} />}
              </button>
            </div>
            <input
              type="text"
              value={semesterData.motto || ''}
              onChange={(e) => handleMottoChange(e.target.value)}
              disabled={isMottoLocked}
              placeholder="等待生成或自行輸入..."
              className={`w-full px-3 py-2 rounded-lg border-none outline-none text-sm text-[#5D5D5D] ${isMottoLocked ? 'bg-[#F5F5F5] cursor-not-allowed' : 'bg-white'}`}
            />
          </div>

          {/* 評語 */}
          <div className={`p-3 rounded-xl border ${isCommentLocked ? 'border-[#FFADAD]/50 bg-[#FFADAD]/5' : 'border-[#A8D8B9]/50 bg-[#A8D8B9]/5'}`}>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-[#5D5D5D]">評語</label>
              <button
                onClick={handleToggleCommentLock}
                className={`p-1.5 rounded-lg transition-colors ${isCommentLocked ? 'bg-[#FFADAD]/20 text-[#D64545]' : 'text-[#B8B8B8] hover:bg-[#E8E8E8]'}`}
                title={isCommentLocked ? '已鎖定：AI 不會覆寫此欄位' : '未鎖定：AI 可覆寫此欄位'}
              >
                {isCommentLocked ? <Lock size={14} /> : <Unlock size={14} />}
              </button>
            </div>
            <textarea
              value={semesterData.polishedComment || ''}
              onChange={(e) => handlePolishedCommentChange(e.target.value)}
              disabled={isCommentLocked}
              placeholder="等待生成或自行輸入..."
              className={`w-full min-h-[60px] p-3 rounded-lg border-none outline-none resize-y text-sm text-[#5D5D5D] ${isCommentLocked ? 'bg-[#F5F5F5] cursor-not-allowed' : 'bg-white'}`}
            />
          </div>

          {semesterData.analysis && (
            <div className="text-xs text-[#8B8B8B]">分析判定：{semesterData.analysis}</div>
          )}
        </div>
      )}
    </div>
  )
}

export default CommentPanel
