import { useState, useEffect, useRef } from 'react'
import { Cloud, CloudOff, LogIn, UserPlus, LogOut, RefreshCw, Check, AlertTriangle } from 'lucide-react'
import { isSyncEnabled, login, register, logout, restoreSession, pullSnapshot, pushSnapshotImmediate, syncClassToServer } from '../../../utils/syncService'
import { getMeta } from '../../../utils/storage'
import { saveClassCache, loadClassCache, loadLocalClasses } from '../../../utils/helpers'

export default function SyncSettingsTab({ classId }) {
  const [synced, setSynced] = useState(false)
  const [teacherName, setTeacherName] = useState('')
  const [mode, setMode] = useState('idle')
  const [formName, setFormName] = useState('')
  const [formPasscode, setFormPasscode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    async function checkSyncStatus() {
      const restored = await restoreSession()
      if (!mountedRef.current) return
      if (restored) {
        setSynced(true)
        const name = await getMeta('teacher_name')
        if (!mountedRef.current) return
        setTeacherName(name || '')
      }
    }
    checkSyncStatus()
    return () => { mountedRef.current = false }
  }, [])

  async function handleLogin() {
    if (!formName.trim() || !formPasscode.trim()) {
      setMessage({ type: 'error', text: '請輸入名稱與密碼' })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const res = await login(formName.trim(), formPasscode.trim())
      if (!mountedRef.current) return
      if (res?.success) {
        setSynced(true)
        setTeacherName(formName.trim())
        setMode('idle')
        setMessage({ type: 'success', text: '登入成功！資料將自動同步。' })
      }
    } catch (err) {
      if (!mountedRef.current) return
      setMessage({ type: 'error', text: err.message || '登入失敗' })
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  async function handleRegister() {
    if (!formName.trim() || !formPasscode.trim()) {
      setMessage({ type: 'error', text: '請輸入名稱與密碼' })
      return
    }
    if (formPasscode.trim().length < 6) {
      setMessage({ type: 'error', text: '密碼至少 6 位' })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const res = await register(formName.trim(), formPasscode.trim())
      if (!mountedRef.current) return
      if (res?.success) {
        setSynced(true)
        setTeacherName(formName.trim())
        setMode('idle')
        setMessage({ type: 'success', text: '註冊成功！資料將自動同步。' })
      }
    } catch (err) {
      if (!mountedRef.current) return
      setMessage({ type: 'error', text: err.message || '註冊失敗' })
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  async function handleLogout() {
    await logout()
    if (!mountedRef.current) return
    setSynced(false)
    setTeacherName('')
    setMessage({ type: 'success', text: '已登出，資料將只保存在本機。' })
  }

  async function handlePullFromServer() {
    if (!classId) {
      setMessage({ type: 'error', text: '請先選擇班級' })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const remote = await pullSnapshot(classId)
      if (!mountedRef.current) return
      if (remote && remote.payload) {
        saveClassCache(classId, remote.payload)
        setMessage({ type: 'success', text: '已從伺服器拉取最新資料，重新整理頁面即可生效。' })
      } else {
        setMessage({ type: 'info', text: '伺服器無此班級的備份資料。' })
      }
    } catch (err) {
      if (!mountedRef.current) return
      setMessage({ type: 'error', text: '拉取失敗：' + (err.message || '未知錯誤') })
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  async function handlePushToServer() {
    if (!classId) {
      setMessage({ type: 'error', text: '請先選擇班級' })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const local = loadClassCache(classId)
      if (!local) {
        if (mountedRef.current) {
          setMessage({ type: 'error', text: '本機無此班級資料' })
          setBusy(false)
        }
        return
      }
      // Ensure class exists on server first
      const classes = loadLocalClasses()
      const classMeta = classes.find(c => c.id === classId)
      if (classMeta) {
        await syncClassToServer(classId, classMeta)
      }
      // Push snapshot and wait for result
      const result = await pushSnapshotImmediate(classId, local)
      if (!mountedRef.current) return
      if (result) {
        setMessage({ type: 'success', text: '上傳成功！資料已同步到伺服器。' })
      } else {
        setMessage({ type: 'error', text: '上傳失敗，請稍後再試。' })
      }
    } catch (err) {
      if (!mountedRef.current) return
      setMessage({ type: 'error', text: '上傳失敗：' + (err.message || '未知錯誤') })
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-[#5D5D5D] flex items-center gap-2">
          {synced ? <Cloud size={16} className="text-[#7BC496]" /> : <CloudOff size={16} className="text-[#8B8B8B]" />}
          雲端同步
        </h3>
        <p className="text-xs text-[#8B8B8B]">
          登入後，班級資料會自動同步到伺服器，可在其他裝置存取。
        </p>
      </div>

      {message && (
        <div className={`p-3 rounded-xl text-sm flex items-center gap-2 ${
          message.type === 'error' ? 'bg-red-50 text-red-700' :
          message.type === 'success' ? 'bg-green-50 text-green-700' :
          'bg-blue-50 text-blue-700'
        }`}>
          {message.type === 'error' ? <AlertTriangle size={14} /> : <Check size={14} />}
          {message.text}
        </div>
      )}

      {synced ? (
        <div className="space-y-4">
          <div className="p-4 bg-[#F0F9F4] rounded-xl border border-[#A8D8B9]/30">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-[#5D5D5D]">已連線</p>
                <p className="text-xs text-[#8B8B8B]">老師：{teacherName}</p>
              </div>
              <Cloud size={20} className="text-[#7BC496]" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={handlePushToServer}
              disabled={busy}
              className="p-3 rounded-xl border border-[#A8D8B9] text-sm font-bold text-[#5D5D5D] hover:bg-[#F0F9F4] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
              上傳到伺服器
            </button>
            <button
              onClick={handlePullFromServer}
              disabled={busy}
              className="p-3 rounded-xl border border-[#A8D8B9] text-sm font-bold text-[#5D5D5D] hover:bg-[#F0F9F4] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
              從伺服器拉取
            </button>
          </div>

          <button
            onClick={handleLogout}
            className="w-full p-3 rounded-xl border border-[#FFADAD] text-sm font-bold text-[#E57373] hover:bg-red-50 transition-colors flex items-center justify-center gap-2"
          >
            <LogOut size={14} />
            登出同步帳號
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {mode === 'idle' && (
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setMode('login')}
                className="p-4 rounded-xl border border-[#A8D8B9] hover:bg-[#F0F9F4] transition-colors flex flex-col items-center gap-2"
              >
                <LogIn size={20} className="text-[#7BC496]" />
                <span className="text-sm font-bold text-[#5D5D5D]">登入</span>
                <span className="text-xs text-[#8B8B8B]">已有帳號</span>
              </button>
              <button
                onClick={() => setMode('register')}
                className="p-4 rounded-xl border border-[#FFD6A5] hover:bg-[#FFF8F0] transition-colors flex flex-col items-center gap-2"
              >
                <UserPlus size={20} className="text-[#FFBF69]" />
                <span className="text-sm font-bold text-[#5D5D5D]">註冊</span>
                <span className="text-xs text-[#8B8B8B]">建立新帳號</span>
              </button>
            </div>
          )}

          {(mode === 'login' || mode === 'register') && (
            <div className="space-y-3 p-4 bg-[#FAFAFA] rounded-xl border border-[#E8E8E8]">
              <h4 className="text-sm font-bold text-[#5D5D5D]">
                {mode === 'login' ? '登入同步帳號' : '建立同步帳號'}
              </h4>
              <input
                type="text"
                placeholder="老師名稱"
                value={formName}
                onChange={e => setFormName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#E8E8E8] text-sm focus:outline-none focus:border-[#A8D8B9]"
              />
              <input
                type="password"
                placeholder="密碼（至少 6 位）"
                value={formPasscode}
                onChange={e => setFormPasscode(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#E8E8E8] text-sm focus:outline-none focus:border-[#A8D8B9]"
                onKeyDown={e => { if (e.key === 'Enter') mode === 'login' ? handleLogin() : handleRegister() }}
              />
              <div className="flex gap-2">
                <button
                  onClick={mode === 'login' ? handleLogin : handleRegister}
                  disabled={busy}
                  className="flex-1 p-2.5 rounded-lg bg-[#A8D8B9] text-white font-bold text-sm hover:bg-[#7BC496] transition-colors disabled:opacity-50"
                >
                  {busy ? '處理中...' : (mode === 'login' ? '登入' : '註冊')}
                </button>
                <button
                  onClick={() => { setMode('idle'); setMessage(null) }}
                  className="px-4 py-2.5 rounded-lg border border-[#E8E8E8] text-sm text-[#8B8B8B] hover:bg-[#F5F5F5] transition-colors"
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="pt-4 border-t border-[#E8E8E8]">
        <p className="text-xs text-[#8B8B8B]">
          同步說明：資料在本機即時處理（不影響操作速度），背景自動同步至伺服器。
          即使網路斷線，資料仍安全保存在本機，待網路恢復後自動同步。
        </p>
      </div>
    </div>
  )
}
