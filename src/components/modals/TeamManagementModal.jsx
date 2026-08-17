import { useMemo, useState } from 'react'
import { X, Users, Save, UserPlus, Search, Plus, ChevronRight, ChevronLeft, Loader2, Flag, Trash2 } from 'lucide-react'
import AvatarEmoji from '../common/AvatarEmoji'
import ModalShell from '../common/ModalShell'

function TeamManagementModal({ students, settings, onClose, onSave, onSettingsUpdate }) {
  const defaultGroups = ['A', 'B', 'C', 'D', 'E', 'F']

  // 小隊分配狀態
  const [assignments, setAssignments] = useState(() => {
    const initial = {}
    students.forEach(s => {
      initial[s.id] = s.group || 'unassigned'
    })
    return initial
  })

  // 小隊名稱狀態 (本地編輯用)
  const [groupNames, setGroupNames] = useState(() => ({
    ...settings?.groupAliases
  }))

  // 當前選中編輯的小隊
  const [editingGroup, setEditingGroup] = useState(null)

  // 搜尋詞 (用於添加成員時)
  const [searchTerm, setSearchTerm] = useState('')

  // 儲存狀態
  const [saving, setSaving] = useState(false)

  // 多選勾選狀態
  const [selectedAvailable, setSelectedAvailable] = useState(new Set())

  // 依小隊分組的學生
  const groupedStudents = useMemo(() => {
    const groups = {}
    defaultGroups.forEach(g => groups[g] = [])
    groups['unassigned'] = []
    students.forEach(s => {
      const g = assignments[s.id] || 'unassigned'
      if (!groups[g]) groups[g] = []
      groups[g].push(s)
    })
    // 按座號排序
    Object.keys(groups).forEach(g => {
      groups[g].sort((a, b) => (a.number || 0) - (b.number || 0))
    })
    return groups
  }, [students, assignments])

  // 不在當前編輯小隊的學生 (可添加的成員)
  const availableStudents = useMemo(() => {
    if (!editingGroup) return []
    return students
      .filter(s => assignments[s.id] === 'unassigned')
      .filter(s => {
        if (!searchTerm) return true
        return s.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
               String(s.number).includes(searchTerm)
      })
      .sort((a, b) => (a.number || 0) - (b.number || 0))
  }, [students, assignments, editingGroup, searchTerm])

  // 獲取小隊顯示名稱
  const getGroupDisplayName = (group) => {
    if (group === 'unassigned') return '待分配'
    return groupNames[group] || settings?.groupAliases?.[group] || `${group} 小隊`
  }

  // 批次將勾選的學生加入當前編輯的小隊
  const handleBatchAdd = () => {
    if (!editingGroup || selectedAvailable.size === 0) return
    setAssignments(prev => {
      const next = { ...prev }
      selectedAvailable.forEach(id => { next[id] = editingGroup })
      return next
    })
    setSelectedAvailable(new Set())
  }

  // 將學生從當前小隊移除 (移到預設隊伍)
  const handleRemoveFromGroup = (studentId) => {
    setAssignments(prev => ({ ...prev, [studentId]: 'unassigned' }))
  }

  // 清空當前小隊所有成員
  const handleClearGroup = () => {
    if (!editingGroup) return
    const members = groupedStudents[editingGroup] || []
    if (members.length === 0) return
    const confirmed = window.confirm(`確定要將「${getGroupDisplayName(editingGroup)}」的所有成員移出嗎？`)
    if (!confirmed) return
    setAssignments(prev => {
      const next = { ...prev }
      members.forEach(s => { next[s.id] = 'unassigned' })
      return next
    })
  }

  // 切換勾選狀態
  const toggleSelect = (studentId) => {
    setSelectedAvailable(prev => {
      const next = new Set(prev)
      if (next.has(studentId)) {
        next.delete(studentId)
      } else {
        next.add(studentId)
      }
      return next
    })
  }

  // 更新小隊名稱
  const handleGroupNameChange = (group, name) => {
    setGroupNames(prev => ({ ...prev, [group]: name }))
  }

  // 儲存所有變更
  const handleSave = async () => {
    try {
      setSaving(true)

      // 更新小隊名稱設定
      const newSettings = {
        ...settings,
        groupAliases: { ...settings?.groupAliases, ...groupNames }
      }

      // 回傳更新
      onSave(assignments)
      if (onSettingsUpdate) {
        onSettingsUpdate(newSettings)
      }

      // 若正在編輯特定小隊，返回列表；否則關閉 Modal
      if (editingGroup) {
        setEditingGroup(null)
        setSearchTerm('')
        setSelectedAvailable(new Set())
      } else {
        onClose()
      }
    } catch (err) {
      console.error('儲存小隊失敗:', err)
    } finally {
      setSaving(false)
    }
  }

  // 切換編輯小隊時重設勾選
  const handleEditGroup = (group) => {
    setEditingGroup(group)
    setSelectedAvailable(new Set())
    setSearchTerm('')
  }

  // 小隊卡片顏色
  const groupColors = {
    A: { bg: 'from-[#A8D8B9] to-[#7BC496]', light: 'bg-[#A8D8B9]/20', border: 'border-[#A8D8B9]' },
    B: { bg: 'from-[#FFD6A5] to-[#FFBF69]', light: 'bg-[#FFD6A5]/20', border: 'border-[#FFD6A5]' },
    C: { bg: 'from-[#FFADAD] to-[#FF8A8A]', light: 'bg-[#FFADAD]/20', border: 'border-[#FFADAD]' },
    D: { bg: 'from-[#A0C4FF] to-[#7EB0FF]', light: 'bg-[#A0C4FF]/20', border: 'border-[#A0C4FF]' },
    E: { bg: 'from-[#BDB2FF] to-[#9B8FFF]', light: 'bg-[#BDB2FF]/20', border: 'border-[#BDB2FF]' },
    F: { bg: 'from-[#FDFFB6] to-[#E8EB9C]', light: 'bg-[#FDFFB6]/20', border: 'border-[#FDFFB6]' },
  }

  return (
    <ModalShell
      size="L"
      scroll="caller"
      accentClass="from-[#FFD6A5] to-[#FF8A8A]"
      icon={
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#FFD6A5] to-[#FF8A8A] flex items-center justify-center">
          <Flag size={24} className="text-white" />
        </div>
      }
      title="小隊管理"
      subtitle={editingGroup ? `正在編輯：${getGroupDisplayName(editingGroup)}` : '點選小隊卡片進行編輯'}
      onClose={onClose}
      headerActions={editingGroup && (
        <button
          onClick={() => { setEditingGroup(null); setSearchTerm(''); setSelectedAvailable(new Set()) }}
          className="px-4 py-2 rounded-xl bg-[#E8E8E8] text-[#5D5D5D] font-medium hover:bg-[#D8D8D8] transition-colors flex items-center gap-2"
        >
          <ChevronLeft size={18} />
          返回列表
        </button>
      )}
      footer={
        <>
          <div className="flex-1 text-sm text-[#8B8B8B]">
            {editingGroup
              ? '修改完成後請點擊「儲存變更」'
              : '選擇要編輯的小隊，或直接儲存當前設定'}
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-6 py-2.5 rounded-xl bg-[#E8E8E8] text-[#5D5D5D] font-medium hover:bg-[#D8D8D8] transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#FFD6A5] to-[#FF8A8A] text-white font-medium shadow-md hover:shadow-lg transition-all flex items-center gap-2"
            >
              {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
              儲存變更
            </button>
          </div>
        </>
      }
    >
        {/* Content */}
        <div className="h-full flex flex-col">
          {!editingGroup ? (
            /* 小隊列表視圖 */
            <div className="p-6 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {defaultGroups.map(group => {
                  const colors = groupColors[group]
                  const members = groupedStudents[group] || []

                  return (
                    <div
                      key={group}
                      onClick={() => handleEditGroup(group)}
                      className={`bg-white rounded-2xl p-5 shadow-md border-2 border-transparent hover:border-[#FFD6A5] cursor-pointer transition-all hover:shadow-lg hover:-translate-y-1 group`}
                    >
                      {/* 小隊標題 */}
                      <div className="flex items-center gap-3 mb-4">
                        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${colors.bg} flex items-center justify-center shadow-md group-hover:scale-110 transition-transform`}>
                          <span className="text-white font-bold text-xl">{group}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-bold text-[#5D5D5D] truncate">
                            {getGroupDisplayName(group)}
                          </h3>
                          <p className="text-sm text-[#8B8B8B]">{members.length} 位成員</p>
                        </div>
                        <ChevronRight size={20} className="text-[#B8B8B8] group-hover:text-[#FFD6A5] transition-colors" />
                      </div>

                      {/* 成員預覽 */}
                      <div className="flex flex-wrap gap-1.5">
                        {members.slice(0, 8).map(s => (
                          <div
                            key={s.id}
                            className="w-8 h-8 rounded-full overflow-hidden border-2 border-white shadow-sm"
                            title={`${s.number}. ${s.name}`}
                          >
                            <AvatarEmoji seed={s.uuid || s.id} className="w-full h-full rounded-full text-sm" />
                          </div>
                        ))}
                        {members.length > 8 && (
                          <div className="w-8 h-8 rounded-full bg-[#E8E8E8] flex items-center justify-center text-xs font-medium text-[#5D5D5D]">
                            +{members.length - 8}
                          </div>
                        )}
                        {members.length === 0 && (
                          <span className="text-sm text-[#B8B8B8] italic">尚無成員</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
              {(groupedStudents['unassigned']?.length || 0) > 0 && (
                <div className="mt-4 p-4 rounded-xl bg-[#F9F9F9] border-2 border-dashed border-[#D8D8D8]">
                  <div className="flex items-center gap-2 text-[#8B8B8B]">
                    <Users size={18} />
                    <span className="font-bold">待分配村民</span>
                    <span className="text-sm">{groupedStudents['unassigned'].length} 人</span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* 小隊編輯視圖 */
            <div className="flex flex-1 min-h-0">
              {/* 左側：當前小隊成員 */}
              <div className="w-1/2 border-r border-[#E8E8E8] p-5 flex flex-col min-h-0">
                {/* 小隊名稱編輯 */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-[#5D5D5D] mb-2">
                    小隊名稱
                  </label>
                  <div className="flex gap-2">
                    <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${groupColors[editingGroup].bg} flex items-center justify-center shadow-md shrink-0`}>
                      <span className="text-white font-bold text-xl">{editingGroup}</span>
                    </div>
                    <input
                      type="text"
                      value={groupNames[editingGroup] || ''}
                      onChange={(e) => handleGroupNameChange(editingGroup, e.target.value)}
                      placeholder={`${editingGroup} 小隊`}
                      className="flex-1 px-4 py-2 rounded-xl border-2 border-[#E8E8E8] focus:border-[#FFD6A5] outline-none text-lg font-medium"
                    />
                  </div>
                </div>

                {/* 當前成員列表 */}
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-[#5D5D5D] flex items-center gap-2">
                    <Users size={18} className="text-[#A8D8B9]" />
                    目前成員
                    <span className="text-sm font-normal px-2 py-0.5 rounded-full bg-[#E8E8E8] text-[#5D5D5D]">
                      {groupedStudents[editingGroup]?.length || 0} 人
                    </span>
                  </h3>
                  {(groupedStudents[editingGroup]?.length || 0) > 0 && (
                    <button
                      onClick={handleClearGroup}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[#D64545] bg-[#FFADAD]/10 hover:bg-[#FFADAD]/25 transition-colors"
                    >
                      <Trash2 size={14} />
                      清空成員
                    </button>
                  )}
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1" style={{ scrollbarWidth: 'thin', overscrollBehavior: 'contain' }}>
                  {groupedStudents[editingGroup]?.length === 0 ? (
                    <div className="text-center py-8 bg-[#F9F9F9] rounded-xl">
                      <div className="text-4xl mb-2">🏠</div>
                      <p className="text-[#8B8B8B]">這個小隊還沒有成員</p>
                      <p className="text-sm text-[#B8B8B8]">從右側勾選村民後移入</p>
                    </div>
                  ) : (
                    groupedStudents[editingGroup]?.map(student => (
                      <div
                        key={student.id}
                        className={`flex items-center gap-3 p-3 rounded-xl bg-white border-2 ${groupColors[editingGroup].border} shadow-sm group`}
                      >
                        <div className="w-10 h-10 rounded-xl overflow-hidden shadow-sm">
                          <AvatarEmoji seed={student.uuid || student.id} className="w-full h-full rounded-xl text-lg" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-[#5D5D5D]">{student.number}. {student.name}</div>
                        </div>
                        <button
                          onClick={() => handleRemoveFromGroup(student.id)}
                          className="p-2 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-[#FFADAD]/20 transition-all"
                          title="移出小隊"
                        >
                          <X size={18} className="text-[#D64545]" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* 右側：可添加的成員 (Checkbox 多選) */}
              <div className="w-1/2 p-5 flex flex-col bg-[#F9F9F9] min-h-0">
                <div className="mb-4">
                  <label className="block text-sm font-medium text-[#5D5D5D] mb-2">
                    添加成員
                  </label>
                  <div className="relative">
                    <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#B8B8B8]" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="搜尋村民姓名或座號..."
                      className="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-[#E8E8E8] focus:border-[#A8D8B9] outline-none bg-white"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-[#5D5D5D] flex items-center gap-2">
                    <UserPlus size={18} className="text-[#FFD6A5]" />
                    待分配村民
                  </h3>
                  <span className="text-xs text-[#8B8B8B]">
                    勾選後點擊下方按鈕移入
                  </span>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1" style={{ scrollbarWidth: 'thin', overscrollBehavior: 'contain' }}>
                  {availableStudents.length === 0 ? (
                    <div className="text-center py-8">
                      <div className="text-4xl mb-2">🎉</div>
                      <p className="text-[#8B8B8B]">
                        {searchTerm ? '找不到符合的村民' : '所有村民都已分配到小隊'}
                      </p>
                    </div>
                  ) : (
                    availableStudents.map(student => {
                      const currentGroup = assignments[student.id]
                      const currentColors = groupColors[currentGroup] || { light: 'bg-[#E8E8E8]/30', border: 'border-[#E8E8E8]' }
                      const isSelected = selectedAvailable.has(student.id)

                      return (
                        <div
                          key={student.id}
                          onClick={() => toggleSelect(student.id)}
                          className={`flex items-center gap-3 p-2.5 rounded-xl border-2 cursor-pointer transition-all ${
                            isSelected
                              ? 'bg-[#A8D8B9]/10 border-[#A8D8B9] shadow-sm'
                              : 'bg-white border-transparent hover:border-[#E8E8E8]'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(student.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="w-4 h-4 rounded accent-[#7BC496] shrink-0"
                          />
                          <div className="w-8 h-8 rounded-lg overflow-hidden shadow-sm shrink-0">
                            <AvatarEmoji seed={student.uuid || student.id} className="w-full h-full rounded-lg text-sm" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm text-[#5D5D5D]">{student.number}. {student.name}</div>
                          </div>
                          <span className={`px-1.5 py-0.5 rounded text-xs ${currentColors.light} font-medium text-[#8B8B8B] shrink-0`}>
                            待分配
                          </span>
                        </div>
                      )
                    })
                  )}
                </div>

                {/* 批次移入確認按鈕 */}
                {availableStudents.length > 0 && (
                  <div className="mt-3 shrink-0">
                    <button
                      onClick={handleBatchAdd}
                      disabled={selectedAvailable.size === 0}
                      className={`w-full py-2.5 rounded-xl font-medium flex items-center justify-center gap-2 transition-all ${
                        selectedAvailable.size > 0
                          ? 'bg-gradient-to-r from-[#A8D8B9] to-[#7BC496] text-white shadow-md hover:shadow-lg'
                          : 'bg-[#E8E8E8] text-[#B8B8B8] cursor-not-allowed'
                      }`}
                    >
                      <Plus size={18} />
                      {selectedAvailable.size > 0
                        ? `移入 ${getGroupDisplayName(editingGroup)}（${selectedAvailable.size} 人）`
                        : '請先勾選要移入的村民'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
    </ModalShell>
  )
}

export default TeamManagementModal
