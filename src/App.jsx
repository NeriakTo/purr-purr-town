import { useState } from 'react'
import LoginView from './views/LoginView'
import DashboardView from './views/DashboardView'
import { DEFAULT_SETTINGS } from './utils/constants'
import { getClassCacheKey, loadLocalClasses, saveClassCache, saveLocalClasses } from './utils/helpers'

function App() {
  const [localClasses, setLocalClasses] = useState(() => loadLocalClasses())
  const [selectedClass, setSelectedClass] = useState(null)

  const handleCreateLocalClass = (payload) => {
    const classId = `${payload.year}_${Math.floor(Math.random() * 1000)}`
    const studentCount = payload.studentCount || 10
    const newClass = {
      id: classId,
      year: payload.year,
      name: payload.className,
      teacher: payload.teacher,
      alias: payload.alias || '',
      status: 'active',
      studentCount
    }
    const nextClasses = [...localClasses, newClass]
    setLocalClasses(nextClasses)
    saveLocalClasses(nextClasses)

    const students = Array.from({ length: studentCount }).map((_, i) => ({
      uuid: `s_${classId}_${i + 1}`,
      id: `s_${classId}_${i + 1}`,
      number: i + 1,
      name: `${i + 1}號村民`,
      group: 'unassigned',
      gender: 'neutral',
      bank: { balance: 0, transactions: [] },
      inventory: [],
    }))
    saveClassCache(classId, {
      classId,
      students,
      logs: [],
      settings: DEFAULT_SETTINGS,
      updatedAt: new Date().toISOString()
    })
  }

  // v3.7.2: 從備份還原班級（雲端/檔案匯入），使用原始 classId 避免 ID 衝突
  const handleRestoreClass = (payload) => {
    const { classId, className: restoredName, data } = payload
    if (!classId || !data) return

    // 檢查是否已存在，若存在則更新（呼叫方已確認覆蓋）
    const existing = localClasses.find(c => c.id === classId)

    // 存入 LocalStorage
    saveClassCache(classId, {
      classId,
      students: data.students || [],
      logs: data.logs || [],
      settings: data.settings || DEFAULT_SETTINGS,
      updatedAt: data.updatedAt || new Date().toISOString()
    })

    if (!existing) {
      // 從備份資料推斷 class meta
      const yearMatch = classId.match(/^(\d+)_/)
      const newClass = {
        id: classId,
        year: yearMatch ? yearMatch[1] : '',
        name: restoredName || data.className || `班級 ${classId}`,
        teacher: data.teacher || '',
        alias: '',
        status: 'active',
        studentCount: (data.students || []).length
      }
      const nextClasses = [...localClasses, newClass]
      setLocalClasses(nextClasses)
      saveLocalClasses(nextClasses)
    }

    // 自動進入該班級
    const displayName = existing?.alias || existing?.name || restoredName || `班級 ${classId}`
    setSelectedClass({ id: classId, name: displayName, alias: existing?.alias || null })
  }

  const handleSelectClass = (classId, displayName, alias) => {
    setSelectedClass({ id: classId, name: displayName || `班級 ${classId}`, alias: alias || null })
  }

  // v3.7.3: 允許在村莊設定中更新村莊名稱、別名、村長姓名
  const handleUpdateClassInfo = (updates) => {
    if (!selectedClass) return
    const cid = selectedClass.id
    const nextClasses = localClasses.map(c =>
      c.id === cid ? { ...c, ...updates } : c
    )
    setLocalClasses(nextClasses)
    saveLocalClasses(nextClasses)
    const updated = nextClasses.find(c => c.id === cid)
    if (updated) {
      const displayName = updated.alias || updated.name || `班級 ${cid}`
      setSelectedClass({ id: cid, name: displayName, alias: updated.alias || null })
    }
  }

  const handleClearLocalClass = (classId) => {
    localStorage.removeItem(getClassCacheKey(classId))
    const next = loadLocalClasses().filter(c => c.id !== classId)
    setLocalClasses(next)
    saveLocalClasses(next)
    if (selectedClass?.id === classId) {
      setSelectedClass(null)
    }
  }

  if (!selectedClass) {
    return (
      <LoginView
        localClasses={localClasses}
        onCreateLocalClass={handleCreateLocalClass}
        onSelectClass={handleSelectClass}
        onRestoreClass={handleRestoreClass}
      />
    )
  }

  const classEntry = localClasses.find(c => c.id === selectedClass?.id) || null

  return (
    <DashboardView
      classId={selectedClass.id}
      className={selectedClass.name}
      classAlias={selectedClass.alias}
      classEntry={classEntry}
      onLogout={() => setSelectedClass(null)}
      onClearLocalClass={handleClearLocalClass}
      onUpdateClassInfo={handleUpdateClassInfo}
    />
  )
}

export default App
