// v3.7.0: 座位表工具列
import { Eye, EyeOff, Printer, Download, X, RotateCcw } from 'lucide-react'

function SeatingToolbar({
  rows, cols,
  perspective,
  onRowsChange, onColsChange,
  onPerspectiveChange,
  onClearAll,
  onExport,
  onPrint,
  onClose,
}) {
  return (
    <div className="shrink-0 bg-white/90 backdrop-blur-sm border-b border-[#E8E8E8] px-4 py-3 flex flex-wrap items-center gap-3 print:hidden">
      {/* 標題 */}
      <h2 className="text-lg font-bold text-[#5D5D5D] mr-2">座位表</h2>

      {/* 行列設定 */}
      <div className="flex items-center gap-1.5 text-sm">
        <label className="text-[#8B8B8B]">行</label>
        <input
          type="number"
          min={1} max={12}
          value={rows}
          onChange={(e) => onRowsChange(Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
          className="w-12 px-2 py-1 rounded-lg border border-[#E8E8E8] text-center text-sm focus:border-[#A8D8B9] focus:outline-none"
        />
        <span className="text-[#ABABAB]">×</span>
        <label className="text-[#8B8B8B]">列</label>
        <input
          type="number"
          min={1} max={12}
          value={cols}
          onChange={(e) => onColsChange(Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
          className="w-12 px-2 py-1 rounded-lg border border-[#E8E8E8] text-center text-sm focus:border-[#A8D8B9] focus:outline-none"
        />
      </div>

      {/* 分隔線 */}
      <div className="w-px h-6 bg-[#E8E8E8]" />

      {/* 視角切換 */}
      <button
        onClick={() => onPerspectiveChange(perspective === 'teacher' ? 'student' : 'teacher')}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-colors
          ${perspective === 'student'
            ? 'bg-[#A8D8B9] text-white'
            : 'bg-[#fdfbf7] text-[#5D5D5D] hover:bg-[#A8D8B9]/20'}`}
        title={perspective === 'teacher' ? '切換為學生視角' : '切換為老師視角'}
      >
        {perspective === 'teacher' ? <Eye size={16} /> : <EyeOff size={16} />}
        {perspective === 'teacher' ? '老師視角' : '學生視角'}
      </button>

      {/* 彈性空間 */}
      <div className="flex-1" />

      {/* 清空 */}
      <button
        onClick={onClearAll}
        className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-sm text-[#5D5D5D] bg-[#fdfbf7] hover:bg-[#FFADAD]/20 transition-colors"
        title="清空座位"
      >
        <RotateCcw size={14} />
        清空
      </button>

      {/* 匯出 */}
      <button
        onClick={onExport}
        className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-sm text-[#5D5D5D] bg-[#fdfbf7] hover:bg-[#A8D8B9]/20 transition-colors"
        title="下載 Excel"
      >
        <Download size={14} />
        Excel
      </button>

      {/* 列印 */}
      <button
        onClick={onPrint}
        className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-sm text-[#5D5D5D] bg-[#fdfbf7] hover:bg-[#A8D8B9]/20 transition-colors"
        title="列印"
      >
        <Printer size={14} />
        列印
      </button>

      {/* 關閉 */}
      <button
        onClick={onClose}
        className="p-2 rounded-xl bg-[#fdfbf7] hover:bg-[#FFADAD]/20 transition-colors"
        title="關閉座位表"
      >
        <X size={18} className="text-[#5D5D5D]" />
      </button>
    </div>
  )
}

export default SeatingToolbar
