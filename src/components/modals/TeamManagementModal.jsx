import { useEffect, useMemo, useState } from 'react'
import { X, Users, Save, GripVertical, UserPlus, Search, Plus, ChevronRight, ChevronLeft, Loader2 } from 'lucide-react'
import AvatarEmoji from '../common/AvatarEmoji'

function TeamManagementModal({ students, settings, onClose, onSave, onSettingsUpdate }) {
  const defaultGroups = ['A', 'B', 'C', 'D', 'E', 'F']
  
  // 鎖定背景捲軸
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])
  
  // 小隊分配狀態
  const [assignments, setAssignments] = useState(() => {
    const initial = {}
    students.forEach(s => {
      initial[s.id] = s.group || 'A'
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

  // 依小隊分組的學生
  const groupedStudents = useMemo(() => {
    const groups = {}
    defaultGroups.forEach(g => groups[g] = [])
    students.forEach(s => {
      const g = assignments[s.id] || 'A'
      if (groups[g]) groups[g].push(s)
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
      .filter(s => assignments[s.id] !== editingGroup)
      .filter(s => {
        if (!searchTerm) return true
        return s.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
               String(s.number).includes(searchTerm)
      })
      .sort((a, b) => (a.number || 0) - (b.number || 0))
  }, [students, assignments, editingGroup, searchTerm])

  // 獲取小隊顯示名稱
  const getGroupDisplayName = (group) => {
    return groupNames[group] || settings?.groupAliases?.[group] || `${group} 小隊`
  }

  // 將學生加入當前編輯的小隊
  const handleAddToGroup = (studentId) => {
    if (!editingGroup) return
    setAssignments(prev => ({ ...prev, [studentId]: editingGroup }))
  }

  // 將學生從當前小隊移除 (移到 A 隊作為預設)
  const handleRemoveFromGroup = (studentId) => {
    // 移到下一個小隊，如果是最後一個則移到第一個
    const currentGroup = assignments[studentId]
    const currentIdx = defaultGroups.indexOf(currentGroup)
    const nextGroup = defaultGroups[(currentIdx + 1) % defaultGroups.length]
    setAssignments(prev => ({ ...prev, [studentId]: nextGroup }))
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
      onClose()
    } catch (err) {
      console.error('儲存小隊失敗:', err)
    } finally {
      setSaving(false)
    }
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative bg-[#fdfbf7] rounded-3xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="h-3 bg-gradient-to-r from-[#FFD6A5] to-[#FF8A8A]" />
        
        {/* Header */}
        <div className="p-6 border-b border-[#E8E8E8] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#FFD6A5] to-[#FF8A8A] flex items-center justify-center">
              <Flag size={24} className="text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-[#5D5D5D]">小隊管理</h2>
              <p className="text-sm text-[#8B8B8B]">
                {editingGroup 
                  ? `正在編輯：${getGroupDisplayName(editingGroup)}` 
                  : '點選小隊卡片進行編輯'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {editingGroup && (
              <button 
                onClick={() => { setEditingGroup(null); setSearchTerm('') }}
                className="px-4 py-2 rounded-xl bg-[#E8E8E8] text-[#5D5D5D] font-medium hover:bg-[#D8D8D8] transition-colors flex items-center gap-2"
              >
                <ChevronLeft size={18} />
                返回列表
              </button>
            )}
            <button onClick={onClose} className="p-2 rounded-full hover:bg-[#E8E8E8] transition-colors">
              <X size={24} className="text-[#5D5D5D]" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 flex flex-col">
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
                      onClick={() => setEditingGroup(group)}
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
                  </h3>
                  <span className="text-sm px-3 py-1 rounded-full bg-[#E8E8E8] text-[#5D5D5D]">
                    {groupedStudents[editingGroup]?.length || 0} 人
                  </span>
                </div>
                
                <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1" style={{ scrollbarWidth: 'thin', overscrollBehavior: 'contain' }}>
                  {groupedStudents[editingGroup]?.length === 0 ? (
                    <div className="text-center py-8 bg-[#F9F9F9] rounded-xl">
                      <div className="text-4xl mb-2">🏠</div>
                      <p className="text-[#8B8B8B]">這個小隊還沒有成員</p>
                      <p className="text-sm text-[#B8B8B8]">從右側添加村民</p>
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

              {/* 右側：可添加的成員 */}
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
                    從其他小隊移入
                  </h3>
                  <span className="text-xs text-[#8B8B8B]">
                    點擊移入 {getGroupDisplayName(editingGroup)}
                  </span>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1" style={{ scrollbarWidth: 'thin', overscrollBehavior: 'contain' }}>
                  {availableStudents.length === 0 ? (
                    <div className="text-center py-8">
                      <div className="text-4xl mb-2">🎉</div>
                      <p className="text-[#8B8B8B]">
                        {searchTerm ? '找不到符合的村民' : '所有村民都已在此小隊中'}
                      </p>
                    </div>
                  ) : (
                    availableStudents.map(student => {
                      const currentGroup = assignments[student.id]
                      const currentColors = groupColors[currentGroup]
                      
                      return (
                        <div
                          key={student.id}
                          onClick={() => handleAddToGroup(student.id)}
                          className="flex items-center gap-3 p-3 rounded-xl bg-white border-2 border-transparent hover:border-[#A8D8B9] cursor-pointer transition-all hover:shadow-md group"
                        >
                          <div className="w-10 h-10 rounded-xl overflow-hidden shadow-sm">
                            <AvatarEmoji seed={student.uuid || student.id} className="w-full h-full rounded-xl text-lg" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-[#5D5D5D]">{student.number}. {student.name}</div>
                            <div className="flex items-center gap-1 text-xs text-[#8B8B8B]">
                              <span>目前在</span>
                              <span className={`px-1.5 py-0.5 rounded ${currentColors.light} font-medium`}>
                                {getGroupDisplayName(currentGroup)}
                              </span>
                            </div>
                          </div>
                          <div className="p-2 rounded-lg bg-[#A8D8B9]/0 group-hover:bg-[#A8D8B9]/20 transition-all">
                            <Plus size={18} className="text-[#7BC496]" />
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#E8E8E8] flex justify-between items-center">
          <div className="text-sm text-[#8B8B8B]">
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
        </div>
      </div>
    </div>
  )
}

// ============================================
// 任務總覽 Modal (新功能)
// ============================================

export default TeamManagementModal
