import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle, Clock, Users, Calendar as CalendarIcon, PawPrint } from 'lucide-react'
import Header from '../components/common/Header'
import LoadingScreen from '../components/common/LoadingScreen'
import CalendarNav from '../components/calendar/CalendarNav'
import TaskBoard from '../components/dashboard/TaskBoard'
import BulletinBoard from '../components/dashboard/BulletinBoard'
import SquadGrid from '../components/dashboard/SquadGrid'
import FocusView from './FocusView'
import SettingsModal from '../components/modals/SettingsModal'
import TeamManagementModal from '../components/modals/TeamManagementModal'
import TaskOverviewModal from '../components/modals/TaskOverviewModal'
import GadgetsModal from '../components/modals/GadgetsModal'
import HistoryModal from '../components/modals/HistoryModal'
import PassportModal from '../components/modals/PassportModal'
import AnnouncementModal from '../components/modals/AnnouncementModal'
import { DEFAULT_SETTINGS, STATUS_VALUES } from '../utils/constants'
import { formatDate, formatDateDisplay, getTodayStr, getTasksForDate, getTasksCreatedToday, makeTaskId, normalizeStatus, getTaskDueDate, parseDate, isDoneStatus, isCountedInDenominator, loadClassCache, saveClassCache } from '../utils/helpers'

function DashboardView({ classId, className, classAlias, onLogout, onClearLocalClass }) {
  const [students, setStudents] = useState([])
  const [allLogs, setAllLogs] = useState([])
  const allLogsRef = useRef(allLogs)
  useEffect(() => { allLogsRef.current = allLogs }, [allLogs])
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [selectedStudent, setSelectedStudent] = useState(null)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [showSettings, setShowSettings] = useState(false)
  const [showTeamManagement, setShowTeamManagement] = useState(false)
  const [showTaskOverview, setShowTaskOverview] = useState(false)
  const [showFocus, setShowFocus] = useState(false)
  const [showGadgets, setShowGadgets] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showAnnouncements, setShowAnnouncements] = useState(false)

  const normalizeDate = useCallback((date) => {
    if (typeof date === 'string') {
      try { return formatDate(new Date(date)) } catch { return date.split('T')[0] }
    }
    return formatDate(date)
  }, [])

  useEffect(() => {
    if (!classId) return
    const cached = loadClassCache(classId)
    if (cached) {
      const normStudents = (cached.students || []).map((s, i) => ({ ...s, id: s.id || s.uuid || `student_${i}` }))
      const normLogs = (cached.logs || []).map(log => {
        const dateStr = normalizeDate(log.date)
        const tasks = (log.tasks || []).map((t, i) => ({ ...t, id: t.id || makeTaskId(dateStr, t, i) }))
        return { ...log, date: dateStr, tasks }
      })
      setStudents(normStudents)
      setAllLogs(normLogs)
      setSettings(cached.settings ? { ...DEFAULT_SETTINGS, ...cached.settings } : DEFAULT_SETTINGS)
      setLoading(false)
    }
  }, [classId, normalizeDate])

  // v3.0.1: 儀表板 - 顯示 dueDate === currentDate 的任務
  const { tasks, studentStatus } = useMemo(() => {
    const dateStr = formatDate(currentDate)
    const taskEntries = getTasksForDate(allLogs, dateStr, normalizeDate)

    const mergedTasks = taskEntries.map(({ task, logDate }) => ({
      ...task,
      id: task.id || `task_${Date.now()}`,
      _sourceLogDate: logDate,
    }))

    const mergedStatus = {}
    students.forEach(s => {
      mergedStatus[s.id] = {}
      taskEntries.forEach(({ task, logDate }) => {
        const log = allLogs.find(l => normalizeDate(l.date) === logDate)
        mergedStatus[s.id][task.id] = log?.status?.[s.id]?.[task.id]
      })
    })

    return { tasks: mergedTasks, studentStatus: mergedStatus }
  }, [allLogs, currentDate, normalizeDate, students])

  // v3.0.1: 投影模式 - 顯示 createdAt === 今天 的任務（聯絡簿）
  const focusTasks = useMemo(() => {
    const todayStr = getTodayStr()
    const entries = getTasksCreatedToday(allLogs, todayStr, normalizeDate)
    return entries.map(({ task }) => ({ ...task, id: task.id || `task_${Date.now()}` }))
  }, [allLogs, normalizeDate])

  // v3.0.1: 達成率 = (on_time + late) / (總人數 - leave - exempt)
  const completionRate = useMemo(() => {
    if (students.length === 0 || tasks.length === 0) return 0
    let numerator = 0
    let denominator = 0
    tasks.forEach(t => {
      let taskNum = 0
      let taskDenom = 0
      students.forEach(s => {
        const st = studentStatus[s.id]?.[t.id]
        const norm = normalizeStatus(st)
        if (norm === STATUS_VALUES.LEAVE || norm === STATUS_VALUES.EXEMPT) return
        taskDenom++
        if (norm === STATUS_VALUES.ON_TIME || norm === STATUS_VALUES.LATE) taskNum++
      })
      numerator += taskNum
      denominator += taskDenom
    })
    return denominator > 0 ? numerator / denominator : 0
  }, [students, tasks, studentStatus])

  useEffect(() => {
    if (!classId) return
    saveClassCache(classId, {
      classId,
      students,
      logs: allLogs,
      settings,
      updatedAt: new Date().toISOString()
    })
  }, [classId, students, allLogs, settings])

  // v3.0.1: 新增任務 - 存入今天 log (createdAt=今天, dueDate=明天)
  const handleAddTask = useCallback((newTask) => {
    const todayStr = getTodayStr()
    const normDate = normalizeDate(todayStr)
    setAllLogs(prev => {
      const idx = prev.findIndex(l => normalizeDate(l.date) === normDate)
      if (idx >= 0) {
        const newLogs = [...prev]
        newLogs[idx] = { ...newLogs[idx], tasks: [...(newLogs[idx].tasks || []), newTask] }
        return newLogs
      }
      return [...prev, { date: normDate, tasks: [newTask], status: {} }]
    })
  }, [normalizeDate])

  const handleDeleteTaskFromLog = useCallback((date, taskId) => {
    const normDate = normalizeDate(typeof date === 'string' ? date : formatDate(date))
    setAllLogs(prev => prev.map(log =>
      normalizeDate(log.date) === normDate
        ? { ...log, tasks: (log.tasks || []).filter(t => t.id !== taskId) }
        : log
    ))
  }, [normalizeDate])

  const handleDeleteTask = useCallback((taskId) => {
    const targetTask = tasks.find(task => task.id === taskId)
    if (!targetTask?._sourceLogDate) return
    handleDeleteTaskFromLog(targetTask._sourceLogDate, taskId)
  }, [handleDeleteTaskFromLog, tasks])

  const toggleStatus = useCallback((studentId, taskId, checked, dateOverride) => {
    // Status 2.0: normalize true → on_time
    let newValue = checked
    if (checked === true) newValue = STATUS_VALUES.ON_TIME

    // v2.2.0: Resolve the source log date (where the task was created)
    let targetLogDate
    if (dateOverride) {
      targetLogDate = typeof dateOverride === 'string' ? dateOverride : formatDate(dateOverride)
    } else {
      // Find which log contains this task by scanning for dueDate match
      const currentDateStr = formatDate(currentDate)
      const entries = getTasksForDate(allLogsRef.current, currentDateStr, normalizeDate)
      const entry = entries.find(e => e.task.id === taskId)
      targetLogDate = entry ? entry.logDate : currentDateStr
    }
    const normDate = normalizeDate(targetLogDate)

    setAllLogs(prev => {
      const idx = prev.findIndex(l => normalizeDate(l.date) === normDate)
      if (idx >= 0) {
        const newLogs = [...prev]
        const currentStatus = newLogs[idx].status || {}
        newLogs[idx] = { ...newLogs[idx], status: { ...currentStatus, [studentId]: { ...currentStatus[studentId], [taskId]: newValue } } }
        return newLogs
      }
      const log = prev.find(l => normalizeDate(l.date) === normDate)
      return [...prev, { date: normDate, tasks: log?.tasks || [], status: { [studentId]: { [taskId]: newValue } } }]
    })
  }, [currentDate, normalizeDate])

  const checkOverdue = useCallback((studentId) => {
    const todayStr = getTodayStr()
    const today = parseDate(todayStr)

    for (const log of allLogs) {
      const logDateStr = normalizeDate(log.date)
      const logTasks = log.tasks || []
      const logStatus = log.status?.[studentId] || {}

      for (const task of logTasks) {
        const dueDate = getTaskDueDate(task, logDateStr)
        if (parseDate(dueDate) >= today) continue
        if (!isDoneStatus(logStatus[task.id])) {
          return true
        }
      }
    }
    return false
  }, [allLogs, normalizeDate])

  const handleTeamSave = useCallback((assignments) => {
    setStudents(prev => prev.map(s => ({ ...s, group: assignments[s.id] || s.group })))
  }, [])

  const purrCount = students.filter(s => {
    if (tasks.length === 0) return false
    const effective = tasks.filter(t => isCountedInDenominator(studentStatus[s.id]?.[t.id]))
    return effective.length > 0 && effective.every(t => isDoneStatus(studentStatus[s.id]?.[t.id]))
  }).length
  const angryCount = students.filter(s => {
    if (tasks.length === 0) return false
    const effective = tasks.filter(t => isCountedInDenominator(studentStatus[s.id]?.[t.id]))
    return effective.some(t => !isDoneStatus(studentStatus[s.id]?.[t.id]))
  }).length

  if (loading) return <LoadingScreen message="正在進入村莊..." />

  return (
    <div className="h-screen 2xl:overflow-hidden p-4 md:p-6 lg:p-8 2xl:p-3 3xl:p-2 bg-[#fdfbf7] flex flex-col">
      <Header
        todayStr={formatDate(currentDate)}
        completionRate={completionRate}
        className={className}
        classAlias={classAlias}
        onLogout={onLogout}
        onOpenSettings={() => setShowSettings(true)}
        onOpenTeamManagement={() => setShowTeamManagement(true)}
        onOpenTaskOverview={() => setShowTaskOverview(true)}
        onOpenGadgets={() => setShowGadgets(true)}
        onOpenHistory={() => setShowHistory(true)}
      />
      
      <div className="flex flex-col lg:flex-row gap-4 2xl:gap-3 flex-1 min-h-0">
        {/* Column 1: 村莊日誌 (Calendar) */}
        <aside className="w-full lg:w-[260px] lg:shrink-0 flex flex-col min-h-0">
          <div className="flex-1 min-h-0 flex flex-col bg-white/60 backdrop-blur-sm rounded-3xl p-4 2xl:p-3 shadow-lg border border-white/50">
            <div className="shrink-0">
              <div className="flex items-center h-10 mb-2 shrink-0">
                <h2 className="text-base font-bold text-[#5D5D5D] flex items-center gap-2">
                  <CalendarIcon size={18} className="text-[#A8D8B9]" />村莊日誌
                </h2>
              </div>
              <CalendarNav currentDate={currentDate} onDateChange={setCurrentDate} />
            </div>
            <div className="flex-1 min-h-0 mt-3 2xl:mt-2">
              <BulletinBoard
                announcements={settings.announcements || []}
                onOpenAnnouncements={() => setShowAnnouncements(true)}
              />
            </div>
          </div>
          <footer className="mt-2 text-center text-[#8B8B8B] text-xs shrink-0 py-1">
            <p className="flex items-center justify-center gap-1.5">
              <PawPrint size={10} className="text-[#A8D8B9]" />
              呼嚕嚕小鎮 v3.2.1
              <PawPrint size={10} className="text-[#A8D8B9]" />
            </p>
          </footer>
        </aside>

        {/* Column 2: 任務布告欄 (TaskBoard) */}
        <aside className="w-full lg:w-[280px] lg:shrink-0 min-h-0">
          <div className="h-full max-h-full overflow-hidden flex flex-col bg-white/60 backdrop-blur-sm rounded-3xl p-4 2xl:p-3 shadow-lg border border-white/50">
            <div className="flex-1 min-h-0 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin', overscrollBehavior: 'contain' }}>
              <TaskBoard
                tasks={tasks}
                students={students}
                studentStatus={studentStatus}
                onAddTask={handleAddTask}
                onDeleteTask={handleDeleteTask}
                taskTypes={settings.taskTypes}
                onOpenFocus={() => setShowFocus(true)}
                currentDateStr={formatDate(currentDate)}
              />
            </div>
          </div>
        </aside>

        {/* Column 3: 村民廣場 (Squad Grid) */}
        <main className="flex-1 min-w-0 min-h-0 flex flex-col">
          <div className="bg-white/60 backdrop-blur-sm rounded-3xl p-4 2xl:p-3 shadow-lg border border-white/50 flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="flex items-center h-10 mb-2 shrink-0 justify-between">
              <h2 className="text-base font-bold text-[#5D5D5D] flex items-center gap-2">
                <Users size={18} className="text-[#A8D8B9]" />村民廣場
              </h2>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#A8D8B9]/15">
                  <CheckCircle size={14} className="text-[#7BC496]" />
                  <span className="text-xs font-bold text-[#4A7C59]">{purrCount}</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#FFADAD]/15">
                  <Clock size={14} className="text-[#FF8A8A]" />
                  <span className="text-xs font-bold text-[#D64545]">{angryCount}</span>
                </div>
              </div>
            </div>

            {students.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-[#8B8B8B]">目前沒有村民資料</p>
              </div>
            ) : (
              <SquadGrid
                students={students}
                tasks={tasks}
                studentStatus={studentStatus}
                settings={settings}
                onSelectStudent={setSelectedStudent}
                checkOverdue={checkOverdue}
              />
            )}
          </div>
        </main>
      </div>

      {/* Modals */}
      {selectedStudent && (
        <PassportModal
          student={selectedStudent}
          tasks={tasks}
          studentStatus={studentStatus}
          settings={settings}
          hasOverdue={checkOverdue(selectedStudent.id)}
          allLogs={allLogs}
          currentDateStr={formatDate(currentDate)}
          onClose={() => setSelectedStudent(null)}
          onToggleStatus={toggleStatus}
          onStudentUpdate={(updated) => {
            setStudents(p => p.map(s => s.id === updated.id ? updated : s))
            setSelectedStudent(null)
          }}
        />
      )}
      
      {showSettings && (
        <SettingsModal
          classId={classId}
          className={className}
          settings={settings}
          students={students}
          allLogs={allLogs}
          onClose={() => setShowSettings(false)}
          onSave={setSettings}
          onRestoreFromBackup={(restored) => {
            setStudents((restored.students || []).map((s, i) => ({ ...s, id: s.id || s.uuid || `student_${i}` })))
            setAllLogs((restored.logs || []).map(log => {
              const dateStr = normalizeDate(log.date)
              const tasks = (log.tasks || []).map((t, i) => ({ ...t, id: t.id || makeTaskId(dateStr, t, i) }))
              return { ...log, date: dateStr, tasks }
            }))
            setSettings(restored.settings ? { ...DEFAULT_SETTINGS, ...restored.settings } : DEFAULT_SETTINGS)
          }}
          onClearLocalClass={onClearLocalClass}
        />
      )}
      
      {showTeamManagement && (
        <TeamManagementModal
          students={students}
          settings={settings}
          onClose={() => setShowTeamManagement(false)}
          onSave={handleTeamSave}
          onSettingsUpdate={setSettings}
        />
      )}
      
      {showTaskOverview && (
        <TaskOverviewModal
          allLogs={allLogs}
          students={students}
          settings={settings}
          onClose={() => setShowTaskOverview(false)}
          onNavigateToDate={setCurrentDate}
          onToggleStatus={toggleStatus}
          onDeleteTask={handleDeleteTaskFromLog}
        />
      )}

      {showFocus && (
        <FocusView
          tasks={focusTasks}
          currentDateStr={getTodayStr()}
          onClose={() => setShowFocus(false)}
        />
      )}

      {showGadgets && (
        <GadgetsModal
          students={students}
          onClose={() => setShowGadgets(false)}
        />
      )}

      {showHistory && (
        <HistoryModal
          allLogs={allLogs}
          students={students}
          settings={settings}
          onClose={() => setShowHistory(false)}
          onToggleStatus={toggleStatus}
        />
      )}

      {showAnnouncements && (
        <AnnouncementModal
          announcements={settings.announcements || []}
          onClose={() => setShowAnnouncements(false)}
          onSave={(nextAnnouncements) => {
            setSettings(prev => ({ ...prev, announcements: nextAnnouncements }))
          }}
        />
      )}
    </div>
  )
}

// ============================================
// 主應用程式 (App)
// ============================================

export default DashboardView
