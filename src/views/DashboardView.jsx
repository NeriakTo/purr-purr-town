import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle, Clock, Users, Calendar as CalendarIcon, PawPrint, XCircle, Coffee } from 'lucide-react'
import Header from '../components/common/Header'
import LoadingScreen from '../components/common/LoadingScreen'
import CalendarNav from '../components/calendar/CalendarNav'
import TaskBoard from '../components/dashboard/TaskBoard'
import BulletinBoard from '../components/dashboard/BulletinBoard'
import SquadGrid from '../components/dashboard/SquadGrid'
import FocusView from './FocusView'
import SeatingView from './SeatingView'
import SettingsModal from '../components/modals/SettingsModal'
import TeamManagementModal from '../components/modals/TeamManagementModal'
import TaskOverviewModal from '../components/modals/TaskOverviewModal'
import GadgetsModal from '../components/modals/GadgetsModal'
import HistoryModal from '../components/modals/HistoryModal'
import PassportModal from '../components/modals/PassportModal'
import AnnouncementModal from '../components/modals/AnnouncementModal'
import OrangeCatStoreModal from '../components/modals/OrangeCatStoreModal'
import { DEFAULT_SETTINGS, DEFAULT_SEATING_CHART, DEFAULT_AUTOMATION, STATUS_VALUES } from '../utils/constants'
import { formatDate, getTodayStr, getNextDay, getTasksForDate, makeTaskId, normalizeStatus, getTaskDueDate, parseDate, isDoneStatus, isCountedInDenominator, isActiveStudent, loadClassCache, saveClassCache, ensureStudentBank, createTransaction, toPoints, generateId, resolveCurrency, getDailyQuestNetCount, shouldAutoExempt } from '../utils/helpers'

function DashboardView({ classId, className, classAlias, classEntry, onLogout, onClearLocalClass, onUpdateClassInfo }) {
  const [students, setStudents] = useState([])
  const [allLogs, setAllLogs] = useState([])
  const allLogsRef = useRef(allLogs)
  useEffect(() => { allLogsRef.current = allLogs }, [allLogs])
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [selectedStudentId, setSelectedStudentId] = useState(null)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [showSettings, setShowSettings] = useState(false)
  const [showTeamManagement, setShowTeamManagement] = useState(false)
  const [showTaskOverview, setShowTaskOverview] = useState(false)
  const [showFocus, setShowFocus] = useState(false)
  const [showGadgets, setShowGadgets] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showAnnouncements, setShowAnnouncements] = useState(false)
  const [showStore, setShowStore] = useState(false)
  const [showSeating, setShowSeating] = useState(false)

  // v3.4.0: 從 students array 派生 selectedStudent，避免快照過期
  const selectedStudent = useMemo(
    () => students.find(s => s.id === selectedStudentId) || null,
    [students, selectedStudentId]
  )

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
      const normStudents = (cached.students || []).map((s, i) => ensureStudentBank({ ...s, id: s.id || s.uuid || `student_${i}` }))
      const normLogs = (cached.logs || []).map(log => {
        const dateStr = normalizeDate(log.date)
        const tasks = (log.tasks || []).map((t, i) => ({ ...t, id: t.id || makeTaskId(dateStr, t, i) }))
        return { ...log, date: dateStr, tasks }
      })
      setStudents(normStudents)
      setAllLogs(normLogs)
      const loadedSettings = cached.settings ? { ...DEFAULT_SETTINGS, ...cached.settings } : DEFAULT_SETTINGS
      // v3.5.0: Migrate storeItems → shop.products
      if (!loadedSettings.shop && loadedSettings.storeItems) {
        loadedSettings.shop = { ...DEFAULT_SETTINGS.shop, products: loadedSettings.storeItems }
      }
      // v3.5.1: Migrate currencyRates → currency
      if (!cached.settings?.currency && cached.settings?.currencyRates) {
        loadedSettings.currency = resolveCurrency({ currencyRates: cached.settings.currencyRates })
      }
      setSettings(loadedSettings)
    }
    setLoading(false)
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

  // v3.8.1: 投影模式 - 左：隔日任務（dueDate=明天） 右：其餘已排定任務
  const { tomorrowTasks, upcomingTasks } = useMemo(() => {
    const todayStr = getTodayStr()
    const tomorrowStr = getNextDay(todayStr)
    const tomorrow = []
    const upcoming = []

    allLogs.forEach(log => {
      const logDate = normalizeDate(log.date)
      ;(log.tasks || []).forEach((task, i) => {
        const dueDate = normalizeDate(getTaskDueDate(task, logDate))
        const t = { ...task, id: task.id || makeTaskId(logDate, task, i), dueDate }
        if (dueDate === tomorrowStr) {
          tomorrow.push(t)
        } else if (dueDate > tomorrowStr) {
          upcoming.push(t)
        }
      })
    })

    upcoming.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    return { tomorrowTasks: tomorrow, upcomingTasks: upcoming }
  }, [allLogs, normalizeDate])

  // v3.7.1: 過濾在校生（排除在家自學學生）
  const activeStudents = useMemo(() => students.filter(isActiveStudent), [students])

  // v3.0.1: 達成率 = (on_time + late) / (總人數 - leave - exempt)
  const completionRate = useMemo(() => {
    if (activeStudents.length === 0 || tasks.length === 0) return 0
    let numerator = 0
    let denominator = 0
    tasks.forEach(t => {
      let taskNum = 0
      let taskDenom = 0
      activeStudents.forEach(s => {
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
  }, [activeStudents, tasks, studentStatus])

  useEffect(() => {
    if (!classId || loading) return  // 等待資料載入完成後才保存
    saveClassCache(classId, {
      classId,
      students,
      logs: allLogs,
      settings,
      updatedAt: new Date().toISOString()
    })
  }, [classId, students, allLogs, settings, loading])

  // v3.0.1: 新增任務 - 存入今天 log (createdAt=今天, dueDate=明天)
  // v3.8.0: 自動免交 — 符合規則的學生自動標記 exempt
  const handleAddTask = useCallback((newTask) => {
    const todayStr = getTodayStr()
    const normDate = normalizeDate(todayStr)
    setAllLogs(prev => {
      // 計算自動免交
      const autoExemptions = {}
      students.forEach(s => {
        if (shouldAutoExempt(s, newTask.title, newTask.type)) {
          autoExemptions[s.id] = { [newTask.id]: STATUS_VALUES.EXEMPT }
        }
      })

      const idx = prev.findIndex(l => normalizeDate(l.date) === normDate)
      if (idx >= 0) {
        const newLogs = [...prev]
        const mergedStatus = { ...(newLogs[idx].status || {}) }
        Object.entries(autoExemptions).forEach(([sid, ts]) => {
          mergedStatus[sid] = { ...mergedStatus[sid], ...ts }
        })
        newLogs[idx] = { ...newLogs[idx], tasks: [...(newLogs[idx].tasks || []), newTask], status: mergedStatus }
        return newLogs
      }
      return [...prev, { date: normDate, tasks: [newTask], status: autoExemptions }]
    })
  }, [normalizeDate, students])

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
    const automation = settings.automation || DEFAULT_AUTOMATION
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

    // v3.6.0: Smart Automation - Get Old Status
    const log = allLogsRef.current.find(l => normalizeDate(l.date) === normDate)
    const oldStatus = log?.status?.[studentId]?.[taskId]
    const normOld = normalizeStatus(oldStatus)
    const normNew = normalizeStatus(newValue)

    if (normOld === normNew) return // No change

    // --- Helper to execute bank transaction ---
    const runTransaction = (amt, reason) => {
      setStudents(prev => prev.map(s => {
        if (s.id !== studentId) return s
        const student = ensureStudentBank(s)
        const newBank = createTransaction(student.bank, amt, reason)
        return { ...student, bank: newBank }
      }))
    }

    // --- Phase 1: UNDO Old Status Effects ---
    if (normOld === STATUS_VALUES.LATE && automation.latePenalty) {
      runTransaction(Math.abs(automation.latePenalty), '更正：撤銷遲交扣分')
    }
    if (normOld === STATUS_VALUES.MISSING && automation.missingPenalty) {
      runTransaction(Math.abs(automation.missingPenalty), '更正：撤銷缺交扣分')
    }

    // Revoke Daily Quest if streak broken
    // v3.7.1: 使用 functional update 避免 stale closure，搭配淨計數避免重複回收
    if (normOld === STATUS_VALUES.ON_TIME && automation.dailyQuestBonus) {
      setStudents(currentStudents => {
        const s = currentStudents.find(x => x.id === studentId)
        if (!s) return currentStudents
        const todayStr = getTodayStr()
        const hasActiveBonus = getDailyQuestNetCount(s?.bank?.transactions, todayStr, normalizeDate) > 0
        if (hasActiveBonus) {
          const student = ensureStudentBank(s)
          const newBank = createTransaction(student.bank, -Math.abs(automation.dailyQuestBonus), '更正：未達成每日任務 (回收獎勵)')
          return currentStudents.map(curr => curr.id === studentId ? { ...curr, bank: newBank } : curr)
        }
        return currentStudents
      })
    }

    // --- Phase 2: UPDATE Status ---
    setAllLogs(prev => {
      const idx = prev.findIndex(l => normalizeDate(l.date) === normDate)
      if (idx >= 0) {
        const newLogs = [...prev]
        const currentStatus = newLogs[idx].status || {}
        newLogs[idx] = { ...newLogs[idx], status: { ...currentStatus, [studentId]: { ...currentStatus[studentId], [taskId]: newValue } } }
        return newLogs
      }
      const logItem = prev.find(l => normalizeDate(l.date) === normDate)
      return [...prev, { date: normDate, tasks: logItem?.tasks || [], status: { [studentId]: { [taskId]: newValue } } }]
    })

    // --- Phase 3: REDO New Status Effects ---
    // We need to wait for state update or calculate "future state".
    // Since setStudents is functional, we can chain calls or just run them.
    // However, for Daily Quest Check, we need to know the *new* full set of statuses.
    // We can simulate the new status map for the Daily Quest check.

    setTimeout(() => {
      // Execute penalties immediately
      if (normNew === STATUS_VALUES.LATE && automation.latePenalty) {
        runTransaction(automation.latePenalty, '作業遲交')
      }
      if (normNew === STATUS_VALUES.MISSING && automation.missingPenalty) {
        runTransaction(automation.missingPenalty, '作業缺交')
      }

      // Check Daily Quest Eligibility
      if (normNew === STATUS_VALUES.ON_TIME && automation.dailyQuestBonus) {
        // We need to fetch the latest logs to check all tasks
        // Use functional state or references to be safe, but since this is inside a component, references might be stale inside timeout?
        // Actually, allLogsRef.current is updated via useEffect, but might have slight delay.
        // Better: Calculate 'isPerfect' based on current knowledge + the change we just made.

        const dateTasks = getTasksForDate(allLogsRef.current, normalizeDate(currentDate), normalizeDate)
        // Check if ALL tasks for this student on this date are ON_TIME
        // We must override the *current* task status with our *newValue* because allLogsRef might not be updated yet.

        const isAllOnTime = dateTasks.every(({ task, logDate }) => {
          if (task.id === taskId) return normNew === STATUS_VALUES.ON_TIME
          const l = allLogsRef.current.find(lg => normalizeDate(lg.date) === logDate)
          const st = l?.status?.[studentId]?.[task.id]
          const norm = normalizeStatus(st)
          // Ignore exempt/leave? Usually Daily Quest means "All assigned duties done".
          // If exempt, it shouldn't block. If leave, shouldn't block.
          // Let's say: All *required* tasks must be ON_TIME.
          // If status is LEAVE/EXEMPT, we skip checking it?
          // Or strictly: Must be ON_TIME. 
          // Current logic: "All tasks... are on_time" implies strictness.
          // Let's stick to: count status. If not ON_TIME, fail. (Unless LEAVE/EXEMPT?)
          // User requirement: "All tasks on_time triggers bonus".
          // Let's assume LEAVE/EXEMPT tasks don't count towards "daily quest" or are neutral.
          // Actually, usually Daily Quest implies "You did everything you had to do".
          // If I have 3 tasks, 1 is ON_TIME, 2 are EXEMPT -> Did I finish my daily quest? Yes.
          if (norm === STATUS_VALUES.EXEMPT || norm === STATUS_VALUES.LEAVE) return true
          return norm === STATUS_VALUES.ON_TIME
        })

        if (isAllOnTime && dateTasks.length > 0) {
          // Check if already awarded today (to avoid double payment)
          // We need latest student state for this.
          // Accessing student state in timeout: risky if closed? No, closure captures current scope 'students' which is old.
          // Use a functional update to check inside? No, conditional logic inside setStudents is hard.
          // We can't easily check "latest" student transaction inside timeout without a ref or functional update hack.

          // v3.7.1: 使用淨計數判斷是否需要重新發放獎勵
          setStudents(currentStudents => {
            const s = currentStudents.find(x => x.id === studentId)
            if (!s) return currentStudents
            const todayStr = getTodayStr()
            const netCount = getDailyQuestNetCount(s.bank?.transactions, todayStr, normalizeDate)

            if (netCount <= 0) {
              const student = ensureStudentBank(s)
              const newBank = createTransaction(student.bank, automation.dailyQuestBonus, '每日任務完成 (Daily Quest)')
              return currentStudents.map(curr => curr.id === studentId ? { ...curr, bank: newBank } : curr)
            }
            return currentStudents
          })
        }
      }
    }, 0)

  }, [currentDate, normalizeDate, settings])

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

  // v3.4.0: 銀行交易 (行為加扣分 / 手動調整)
  const handleBankTransaction = useCallback((studentId, amount, reason) => {
    setStudents(prev => prev.map(s => {
      if (s.id !== studentId) return s
      const student = ensureStudentBank(s)
      const newBank = createTransaction(student.bank, amount, reason)
      return { ...student, bank: newBank }
    }))
  }, [])

  // v3.4.2: 撤銷交易（更正模式，保留審計軌跡）
  const handleUndoTransaction = useCallback((studentId, txId) => {
    setStudents(prev => prev.map(s => {
      if (s.id !== studentId) return s
      const student = ensureStudentBank(s)
      const originalTx = student.bank.transactions.find(tx => tx.id === txId)
      if (!originalTx || originalTx.voided) return s
      const updatedTransactions = student.bank.transactions.map(tx =>
        tx.id === txId ? { ...tx, voided: true } : tx
      )
      const correctionAmount = -originalTx.amount
      const newBalance = student.bank.balance + correctionAmount
      const correctionTx = {
        id: generateId('tx'),
        date: new Date().toISOString(),
        amount: correctionAmount,
        reason: `撤銷：${originalTx.reason}`,
        balance: newBalance,
        type: 'correction',
        correctedTxId: txId,
      }
      return { ...student, bank: { balance: newBalance, transactions: [...updatedTransactions, correctionTx] } }
    }))
  }, [])

  // v3.7.1: 手動修正單一筆交易（作廢原始交易 + 建立修正紀錄）
  const handleCorrectTransaction = useCallback((studentId, txId, newAmount, reason) => {
    setStudents(prev => prev.map(s => {
      if (s.id !== studentId) return s
      const student = ensureStudentBank(s)
      const originalTx = student.bank.transactions.find(tx => tx.id === txId)
      if (!originalTx || originalTx.voided) return s

      // 作廢原始交易
      const updatedTransactions = student.bank.transactions.map(tx =>
        tx.id === txId ? { ...tx, voided: true } : tx
      )

      // 淨修正金額 = 新金額 - 原始金額
      const correctionAmount = newAmount - originalTx.amount
      const newBalance = student.bank.balance + correctionAmount

      const correctionTx = {
        id: generateId('tx'),
        date: new Date().toISOString(),
        amount: correctionAmount,
        reason: reason || `修正：${originalTx.reason} (${originalTx.amount > 0 ? '+' : ''}${originalTx.amount} → ${newAmount > 0 ? '+' : ''}${newAmount})`,
        balance: newBalance,
        type: 'correction',
        correctedTxId: txId,
      }

      return {
        ...student,
        bank: {
          balance: newBalance,
          transactions: [...updatedTransactions, correctionTx],
        },
      }
    }))
  }, [])

  // v3.4.2: 批次發薪
  const handleProcessPayroll = useCallback((payrollEntries) => {
    setStudents(prev => {
      let updated = [...prev]
      payrollEntries.forEach(({ studentId, amount, reason }) => {
        updated = updated.map(s => {
          if (s.id !== studentId) return s
          const student = ensureStudentBank(s)
          const newBank = createTransaction(student.bank, amount, reason)
          return { ...student, bank: newBank }
        })
      })
      return updated
    })
  }, [])

  // v3.5.0: 商店購買
  const handlePurchase = useCallback((studentId, item) => {
    const currency = resolveCurrency(settings)
    const priceInPoints = toPoints(item.price, item.priceUnit, currency)

    setStudents(prev => prev.map(s => {
      if (s.id !== studentId) return s
      const student = ensureStudentBank(s)
      if (student.bank.balance < priceInPoints) return s
      const newBank = createTransaction(student.bank, -priceInPoints, `購買 ${item.name}`)
      const newInventory = [...(student.inventory || []), {
        itemId: item.id,
        name: item.name,
        icon: item.icon,
        purchasedAt: new Date().toISOString(),
      }]
      return { ...student, bank: newBank, inventory: newInventory }
    }))

    if (item.stock !== null && item.stock !== undefined && item.stock > 0) {
      setSettings(prev => ({
        ...prev,
        shop: {
          ...prev.shop,
          products: (prev.shop?.products || []).map(si =>
            si.id === item.id ? { ...si, stock: Math.max(0, (si.stock || 0) - 1) } : si
          ),
        },
      }))
    }
  }, [settings])

  // v3.5.0: 道具核銷
  const handleConsumeItem = useCallback((studentId, itemIndex) => {
    setStudents(prev => prev.map(s => {
      if (s.id !== studentId) return s
      const student = ensureStudentBank(s)
      const item = student.inventory?.[itemIndex]
      if (!item) return s
      const newInventory = student.inventory.filter((_, i) => i !== itemIndex)
      const newBank = createTransaction(student.bank, 0, `使用道具: ${item.name}`)
      return { ...student, bank: newBank, inventory: newInventory }
    }))
  }, [])

  const { purrCount, angryCount, lateCount, leaveCount } = useMemo(() => {
    if (tasks.length === 0) return { purrCount: 0, angryCount: 0, lateCount: 0, leaveCount: 0 }
    let purr = 0, angry = 0, late = 0, leave = 0
    activeStudents.forEach(s => {
      const effective = tasks.filter(t => isCountedInDenominator(studentStatus[s.id]?.[t.id]))
      if (effective.length > 0 && effective.every(t => isDoneStatus(studentStatus[s.id]?.[t.id]))) purr++
      if (effective.some(t => !isDoneStatus(studentStatus[s.id]?.[t.id]))) angry++
      if (tasks.some(t => normalizeStatus(studentStatus[s.id]?.[t.id]) === STATUS_VALUES.LATE)) late++
      if (tasks.every(t => normalizeStatus(studentStatus[s.id]?.[t.id]) === STATUS_VALUES.LEAVE)) leave++
    })
    return { purrCount: purr, angryCount: angry, lateCount: late, leaveCount: leave }
  }, [activeStudents, tasks, studentStatus])

  if (loading) return <LoadingScreen message="正在進入村莊..." />

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8 2xl:p-3 3xl:p-2 bg-[#fdfbf7] flex flex-col">
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
        onOpenStore={() => setShowStore(true)}
        onOpenSeating={() => setShowSeating(true)}
      />

      <div className="flex flex-col lg:flex-row gap-4 2xl:gap-3 flex-1 min-h-0">
        {/* Column 1: 村莊日誌 (Calendar) */}
        <aside className="w-full lg:w-[260px] lg:shrink-0 flex flex-col min-h-0">
          <div className="flex-1 min-h-0 flex flex-col bg-white/60 backdrop-blur-sm rounded-3xl p-4 2xl:p-3 shadow-lg border border-white/50">
            <div className="shrink-0">
              <div className="flex items-center h-10 mb-2 shrink-0">
                <h2 className="text-xl font-bold text-[#5D5D5D] flex items-center gap-2">
                  <CalendarIcon size={18} className="text-[#A0C4FF]" />村莊日誌
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
              {`呼嚕嚕小鎮 v${__APP_VERSION__}`}
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
                students={activeStudents}
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
          <div className="bg-white/60 backdrop-blur-sm rounded-3xl p-4 2xl:p-3 shadow-lg border border-white/50 flex-1 min-h-0 flex flex-col">
            <div className="flex items-center h-10 mb-2 shrink-0 justify-between">
              <h2 className="text-xl font-bold text-[#5D5D5D] flex items-center gap-2">
                <Users size={18} className="text-[#FFADAD]" />村民廣場
              </h2>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#A8D8B9]/15">
                  <CheckCircle size={14} className="text-[#7BC496]" />
                  <span className="text-xs font-bold text-[#4A7C59]">{purrCount}</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#FFD6A5]/20">
                  <Clock size={14} className="text-[#8B6914]" />
                  <span className="text-xs font-bold text-[#8B6914]">{lateCount}</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#FFADAD]/15">
                  <XCircle size={14} className="text-[#FF8A8A]" />
                  <span className="text-xs font-bold text-[#D64545]">{angryCount}</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#E8E8E8]/50">
                  <Coffee size={14} className="text-[#8B8B8B]" />
                  <span className="text-xs font-bold text-[#8B8B8B]">{leaveCount}</span>
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
                activeStudents={activeStudents}
                tasks={tasks}
                studentStatus={studentStatus}
                settings={settings}
                onSelectStudent={(s) => setSelectedStudentId(s.id)}
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
          onClose={() => setSelectedStudentId(null)}
          onToggleStatus={toggleStatus}
          onStudentUpdate={(updated) => {
            setStudents(p => p.map(s => s.id === updated.id ? updated : s))
          }}
          onBankTransaction={handleBankTransaction}
          onUndoTransaction={handleUndoTransaction}
          onCorrectTransaction={handleCorrectTransaction}
          onConsumeItem={handleConsumeItem}
        />
      )}

      {showSettings && (
        <SettingsModal
          classId={classId}
          className={className}
          classEntry={classEntry}
          settings={settings}
          students={students}
          allLogs={allLogs}
          onClose={() => setShowSettings(false)}
          onSave={setSettings}
          onUpdateClassInfo={onUpdateClassInfo}
          onRestoreFromBackup={(restored) => {
            setStudents((restored.students || []).map((s, i) => ensureStudentBank({ ...s, id: s.id || s.uuid || `student_${i}` })))
            setAllLogs((restored.logs || []).map(log => {
              const dateStr = normalizeDate(log.date)
              const tasks = (log.tasks || []).map((t, i) => ({ ...t, id: t.id || makeTaskId(dateStr, t, i) }))
              return { ...log, date: dateStr, tasks }
            }))
            setSettings(restored.settings ? { ...DEFAULT_SETTINGS, ...restored.settings } : DEFAULT_SETTINGS)
          }}
          onClearLocalClass={onClearLocalClass}
          onProcessPayroll={handleProcessPayroll}
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
          students={activeStudents}
          settings={settings}
          onClose={() => setShowTaskOverview(false)}
          onNavigateToDate={setCurrentDate}
          onToggleStatus={toggleStatus}
          onDeleteTask={handleDeleteTaskFromLog}
        />
      )}

      {showFocus && (
        <FocusView
          tomorrowTasks={tomorrowTasks}
          upcomingTasks={upcomingTasks}
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
          students={activeStudents}
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

      {showStore && (
        <OrangeCatStoreModal
          students={students}
          settings={settings}
          onClose={() => setShowStore(false)}
          onPurchase={handlePurchase}
        />
      )}

      {showSeating && (
        <SeatingView
          students={activeStudents}
          seatingChart={settings.seatingChart || DEFAULT_SEATING_CHART}
          className={className}
          onClose={() => setShowSeating(false)}
          onSave={(chart) => setSettings(prev => ({ ...prev, seatingChart: chart }))}
        />
      )}
    </div>
  )
}

// ============================================
// 主應用程式 (App)
// ============================================

export default DashboardView
