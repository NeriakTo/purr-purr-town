import { useEffect, useState } from 'react'
import { Sparkles, X, Loader2 } from 'lucide-react'
import AvatarEmoji from '../common/AvatarEmoji'

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
                  onFocus={e => e.target.select()}
                  className="w-16 px-2 py-1.5 rounded-lg border-2 border-[#E8E8E8] text-center font-bold text-[#5D5D5D] focus:border-[#A8D8B9] focus:outline-none transition-colors"
                />
                <span className="text-sm font-bold text-[#5D5D5D]">分</span>
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={customSec}
                  onChange={e => setCustomSec(e.target.value)}
                  onFocus={e => e.target.select()}
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

export default GadgetsModal
