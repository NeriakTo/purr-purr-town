import { useId } from 'react'
import { useDialogChrome } from './useDialogChrome'

/**
 * 次級對話框：確認、驗證、警示用。高度一律隨內容，不套工作視窗的固定高度。
 * 用於巢狀在 ModalShell 之上的確認框（購買確認、交易修正、道具核銷）與前置驗證閘門。
 *
 * @param {Object} props
 * @param {'dialog'|'alertdialog'} [props.role] 破壞性或必須回應的確認用 alertdialog
 * @param {boolean} [props.nested] 疊在既有彈窗之上時為 true，改用較高層級
 */
function CompactDialog({
  title,
  role = 'alertdialog',
  nested = false,
  children,
  footer = null,
  onClose,
  closeOnEsc = true,
  panelClassName = '',
}) {
  const titleId = useId()
  const { panelRef } = useDialogChrome({ onClose, closeOnEsc })

  return (
    <div className={`fixed inset-0 ${nested ? 'z-[70]' : 'z-[60]'} flex items-center justify-center p-4`}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in" aria-hidden="true" />

      <div
        ref={panelRef}
        tabIndex={-1}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative w-full max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto
          rounded-2xl bg-white p-6 shadow-2xl outline-none animate-slide-up ${panelClassName}`}
      >
        <h3 id={titleId} className="text-lg font-bold text-[#5D5D5D] mb-3">{title}</h3>
        {children}
        {footer && <div className="mt-4 flex items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}

export default CompactDialog
