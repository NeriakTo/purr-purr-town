import { useState } from 'react'
import { PawPrint, Plus, Home, Users, Sparkles, ListTodo, Trophy, School, ChevronRight } from 'lucide-react'
import CreateClassModal from '../components/modals/CreateClassModal'

function LoginView({ onSelectClass, localClasses, onCreateLocalClass }) {
  const [showCreateModal, setShowCreateModal] = useState(false)

  const classes = localClasses || []

  const handleCreateSuccess = () => {
    setShowCreateModal(false)
  }

  const features = [
    { icon: ListTodo, title: '任務管理', desc: '輕鬆發布每日作業與通知，一鍵追蹤繳交進度', color: '#A8D8B9' },
    { icon: Sparkles, title: '課堂法寶', desc: '隨機抽籤、計時器等實用小工具，讓課堂更有趣', color: '#FFD6A5' },
    { icon: Trophy, title: '小隊競賽', desc: '分組管理與即時排名，激發團隊合作精神', color: '#FFADAD' },
  ]

  return (
    <div className="min-h-screen bg-[#fdfbf7] flex flex-col relative overflow-hidden">
      {/* Decorative background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -right-32 w-96 h-96 bg-[#A8D8B9]/8 rounded-full animate-float" style={{ animationDuration: '6s', animationDelay: '0s' }} />
        <div className="absolute -bottom-24 -left-24 w-80 h-80 bg-[#FFD6A5]/8 rounded-full animate-float" style={{ animationDuration: '7s', animationDelay: '2s' }} />
        <div className="absolute top-1/3 right-1/4 w-48 h-48 bg-[#FFADAD]/5 rounded-full animate-float" style={{ animationDuration: '5s', animationDelay: '1.5s' }} />
        <div className="absolute top-[15%] left-[8%] w-32 h-32 bg-[#BDB2FF]/6 rounded-full animate-float" style={{ animationDuration: '4s', animationDelay: '0.5s' }} />
        <div className="absolute bottom-[20%] right-[10%] w-56 h-56 bg-[#A0C4FF]/6 rounded-full animate-float" style={{ animationDuration: '5.5s', animationDelay: '3s' }} />
        <div className="absolute top-[60%] left-[45%] w-24 h-24 bg-[#FDE2F3]/10 rounded-full animate-float" style={{ animationDuration: '4.5s', animationDelay: '1s' }} />
      </div>

      <div className="flex-1 p-6 md:p-10 relative z-10">
        <div className="max-w-4xl mx-auto">
          {/* Hero Section */}
          <div className="text-center pt-8 md:pt-12 mb-6">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="w-14 h-14 md:w-16 md:h-16 rounded-2xl shadow-lg bg-gradient-to-br from-[#A8D8B9] to-[#7BC496] flex items-center justify-center">
                <PawPrint size={32} className="text-white" />
              </div>
              <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-[#5D5D5D] via-[#7BC496] to-[#FFBF69] bg-clip-text text-transparent">呼嚕嚕小鎮</h1>
            </div>
            <p className="text-lg text-[#8B8B8B] mb-1">歡迎回到小鎮！</p>
            <p className="text-sm text-[#B8B8B8]">用最溫暖的方式，陪伴每個孩子的學習旅程</p>
          </div>

          {/* Feature Showcase */}
          <div className="grid grid-cols-3 gap-4 max-w-2xl mx-auto mb-10">
            {features.map((f) => {
              const Icon = f.icon
              return (
                <div key={f.title} className="text-center px-3 py-4 rounded-2xl bg-white/50 backdrop-blur-sm border border-white/60">
                  <div className="w-10 h-10 mx-auto rounded-xl flex items-center justify-center mb-2" style={{ backgroundColor: `${f.color}20` }}>
                    <Icon size={20} style={{ color: f.color }} />
                  </div>
                  <h4 className="text-sm font-bold text-[#5D5D5D] mb-1">{f.title}</h4>
                  <p className="text-xs text-[#8B8B8B] leading-relaxed">{f.desc}</p>
                </div>
              )
            })}
          </div>

          {/* Village Selection */}
          <div className="max-w-3xl mx-auto">
            <h2 className="text-sm font-bold text-[#8B8B8B] uppercase tracking-wider mb-4 flex items-center gap-2">
              <Home size={14} />
              {classes.length === 0 ? '開始使用' : '選擇村莊'}
            </h2>

            {classes.length === 0 ? (
              <div className="max-w-sm mx-auto text-center py-12 px-6 bg-white/60 backdrop-blur-sm rounded-3xl border border-white/70 shadow-sm">
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
                      className="group bg-white/80 backdrop-blur-sm rounded-2xl p-5 shadow-md border border-white/70 hover:shadow-2xl hover:border-[#A8D8B9]/60 hover:bg-white transition-all hover:-translate-y-1.5 text-left"
                    >
                      <div className="flex items-start gap-4 mb-4">
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 group-hover:scale-110 group-hover:rotate-3 transition-transform shadow-md" style={{ background: `linear-gradient(135deg, ${gradients[index % gradients.length]})` }}>
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
                      <div className="flex items-center gap-1 text-sm text-[#A8D8B9] font-bold group-hover:gap-2.5 transition-all">
                        <span>進入村莊</span><ChevronRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
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
      </div>

      {/* Footer */}
      <footer className="text-center py-6 relative z-10">
        <p className="flex items-center justify-center gap-2 text-[#B8B8B8] text-xs">
          <PawPrint size={12} />
          Purr Purr Town v3.2.1
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

export default LoginView
