import { useEffect, useRef } from 'react'

// Esc 關閉的層級堆疊：巢狀對話框時只有最上層響應，避免一次 Esc 關掉兩層
const escStack = []

/**
 * 對話框的共同行為：鎖住頁面捲動、開啟時把焦點移入、關閉後歸還焦點、Esc 關閉。
 * ModalShell 與 CompactDialog 共用，確保巢狀時 body lock 與 Esc 行為不互相打架。
 *
 * @param {{ onClose?: () => void, closeOnEsc?: boolean }} options
 * @returns {{ panelRef: import('react').RefObject<HTMLElement> }}
 */
export function useDialogChrome({ onClose, closeOnEsc = true } = {}) {
  const panelRef = useRef(null)
  // 放進 ref：Esc 的 effect 只在掛載時註冊一次，堆疊順序才等於實際開啟順序。
  // 若讓 effect 依賴 onClose，呼叫端傳行內箭頭函式時每次重繪都會重新入堆疊，
  // 底層彈窗可能因此排到最上層，一次 Esc 關錯視窗。
  const behaviorRef = useRef({ onClose, closeOnEsc })

  useEffect(() => {
    behaviorRef.current = { onClose, closeOnEsc }
  })

  useEffect(() => {
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()

    return () => {
      document.body.style.overflow = previousOverflow
      if (previousFocus instanceof HTMLElement) previousFocus.focus()
    }
  }, [])

  useEffect(() => {
    const token = {}
    escStack.push(token)

    const handleKeyDown = (e) => {
      if (e.key !== 'Escape') return
      if (escStack[escStack.length - 1] !== token) return

      const { onClose: handler, closeOnEsc: enabled } = behaviorRef.current
      // 最上層但不接受 Esc（阻斷式視窗）時吞掉事件，不讓它穿透去關底下的視窗
      if (!enabled || !handler) return
      handler()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      const index = escStack.indexOf(token)
      if (index >= 0) escStack.splice(index, 1)
    }
  }, [])

  return { panelRef }
}
