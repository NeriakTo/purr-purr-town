import { PawPrint, Loader2 } from 'lucide-react'

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
        <span className="text-sm font-medium">{`呼嚕嚕小鎮 v${__APP_VERSION__}`}</span>
        <PawPrint size={20} />
      </div>

    </div>
  )
}

export default LoadingScreen
