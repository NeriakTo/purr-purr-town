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

    const squadCount = payload.squadCount || 6
    const groupLetters = ['A', 'B', 'C', 'D', 'E', 'F'].slice(0, squadCount)
    const students = Array.from({ length: studentCount }).map((_, i) => ({
      uuid: `s_${classId}_${i + 1}`,
      id: `s_${classId}_${i + 1}`,
      number: i + 1,
      name: `${i + 1}號村民`,
      group: groupLetters[i % squadCount],
      gender: 'neutral'
    }))
    saveClassCache(classId, {
      classId,
      students,
      logs: [],
      settings: DEFAULT_SETTINGS,
      updatedAt: new Date().toISOString()
    })
  }

  const handleSelectClass = (classId, displayName, alias) => {
    setSelectedClass({ id: classId, name: displayName || `班級 ${classId}`, alias: alias || null })
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
      />
    )
  }

  return (
    <DashboardView
      classId={selectedClass.id}
      className={selectedClass.name}
      classAlias={selectedClass.alias}
      onLogout={() => setSelectedClass(null)}
      onClearLocalClass={handleClearLocalClass}
    />
  )
}

export default App
