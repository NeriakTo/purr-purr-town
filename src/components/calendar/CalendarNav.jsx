import Calendar from 'react-calendar'
import { format } from 'date-fns'
import { getTodayStr, formatDate } from '../../utils/helpers'
import 'react-calendar/dist/Calendar.css'

function CalendarNav({ currentDate, onDateChange }) {
  const todayStr = getTodayStr()
  const isToday = formatDate(currentDate) === todayStr

  return (
    <div className="react-calendar-container space-y-3">
      <Calendar
        calendarType="gregory"
        onChange={onDateChange}
        value={currentDate}
        className="!border-0 !bg-transparent w-full react-calendar-compact"
        showNeighboringMonth={false}
        tileClassName={({ date, view }) => {
          if (view === 'month') {
            const dateStr = formatDate(date)
            if (dateStr === todayStr) return 'react-calendar__tile--today'
          }
          return ''
        }}
        formatDay={(locale, date) => format(date, 'd')}
        formatShortWeekday={(locale, date) => ['日', '一', '二', '三', '四', '五', '六'][date.getDay()]}
        formatMonthYear={(locale, date) => format(date, 'yyyy年 M月')}
        navigationLabel={({ date }) => format(date, 'yyyy年 M月')}
        next2Label={null}
        prev2Label={null}
      />
      <div className={`transition-opacity ${isToday ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <button
          onClick={() => onDateChange(new Date())}
          className="w-full py-2 rounded-xl border-2 border-[#A8D8B9] text-[#A8D8B9] font-medium text-sm hover:bg-[#A8D8B9] hover:text-white transition-all flex items-center justify-center gap-2"
        >
          📅 回到今天
        </button>
      </div>
    </div>
  )
}

// ============================================
// 任務板
// ============================================

export default CalendarNav
