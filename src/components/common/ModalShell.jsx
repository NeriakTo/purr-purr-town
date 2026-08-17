import { useId } from 'react'
import { X } from 'lucide-react'
import { useDialogChrome } from './useDialogChrome'

// 三級寬度與兩種高度策略——2026-08-18 三喵會議定案，不要在個別彈窗覆寫
const WIDTH = { S: 'max-w-lg', M: 'max-w-3xl', L: 'max-w-5xl' }
const HEIGHT = {
  fixed: 'h-[85dvh] max-h-[48rem]',
  auto: 'h-auto max-h-[calc(100dvh-2rem)]',
}
const LAYER = { base: 'z-50', blocking: 'z-[60]' }
// shell：外框負責唯一的內容捲動；caller：彈窗自己管多層捲動區（分頁、雙欄工作區）
const SCROLL = { shell: 'overflow-y-auto', caller: 'overflow-hidden' }

/**
 * 全系統彈窗共用外框。負責尺寸、頁首、底部動作列、遮罩與無障礙語意。
 *
 * @param {Object} props
 * @param {'S'|'M'|'L'} [props.size] 寬度級距
 * @param {'fixed'|'auto'} [props.height] 固定 85dvh 或隨內容
 * @param {'shell'|'caller'} [props.scroll] 捲動責任歸屬
 * @param {'dialog'|'alertdialog'} [props.role] 一般視窗或阻斷式視窗
 */
function ModalShell({
  size = 'M',
  height = 'fixed',
  scroll = 'shell',
  role = 'dialog',
  layer = 'base',
  icon = null,
  title,
  subtitle = null,
  headerActions = null,
  accentClass = 'from-[#A8D8B9] to-[#FFD6A5]',
  showAccent = true,
  footer = null,
  overlay = null,
  children,
  onClose,
  showClose = true,
  closeOnEsc = true,
  headerClassName = '',
  contentClassName = '',
  footerClassName = '',
}) {
  const titleId = useId()
  const { panelRef } = useDialogChrome({ onClose, closeOnEsc })

  return (
    <div className={`fixed inset-0 ${LAYER[layer]} flex items-center justify-center p-4`}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in" aria-hidden="true" />

      <section
        ref={panelRef}
        tabIndex={-1}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative w-full ${WIDTH[size]} ${HEIGHT[height]} flex flex-col overflow-hidden
          rounded-3xl bg-[#fdfbf7] shadow-2xl outline-none animate-slide-up`}
      >
        {showAccent && <div className={`h-3 shrink-0 bg-gradient-to-r ${accentClass}`} />}

        <header className={`shrink-0 flex items-center justify-between gap-3 p-6 ${headerClassName}`}>
          <div className="flex items-center gap-3 min-w-0">
            {icon}
            <div className="min-w-0">
              <h2 id={titleId} className="text-2xl font-bold text-[#5D5D5D] truncate">{title}</h2>
              {subtitle && <p className="text-sm text-[#8B8B8B] truncate">{subtitle}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {headerActions}
            {showClose && onClose && (
              <button
                onClick={onClose}
                className="p-2 rounded-full hover:bg-[#E8E8E8] transition-colors"
                aria-label="關閉"
              >
                <X size={24} className="text-[#5D5D5D]" />
              </button>
            )}
          </div>
        </header>

        <div className={`flex-1 min-h-0 ${SCROLL[scroll]} ${contentClassName}`}>
          {children}
        </div>

        {footer && (
          <footer className={`shrink-0 border-t border-[#E8E8E8] px-6 py-4 flex items-center justify-end gap-3 ${footerClassName}`}>
            {footer}
          </footer>
        )}

        {/* 狀態覆蓋層：必須是面板的直接子層，放進內容區會跟著捲動、蓋不住頁首與動作列 */}
        {overlay}
      </section>
    </div>
  )
}

export default ModalShell
