import { useState } from 'react'
import { X, ShoppingCart } from 'lucide-react'
import AvatarEmoji from '../common/AvatarEmoji'
import { formatCurrency, toPoints } from '../../utils/helpers'

function OrangeCatStoreModal({ students, settings, onClose, onPurchase }) {
  const [selectedStudent, setSelectedStudent] = useState(null)
  const [confirmItem, setConfirmItem] = useState(null)
  const [purchaseMsg, setPurchaseMsg] = useState(null)

  const rates = settings?.currencyRates || { fish: 100, cookie: 1000 }
  const shop = settings?.shop || { name: '橘喵商店', icon: '🐱', products: [] }
  const products = shop.products || []

  const handleConfirmPurchase = () => {
    if (!selectedStudent || !confirmItem) return
    const priceInPoints = toPoints(confirmItem.price, confirmItem.priceUnit, rates)
    const balance = selectedStudent.bank?.balance || 0
    if (balance < priceInPoints) {
      setPurchaseMsg('餘額不足！')
      setTimeout(() => setPurchaseMsg(null), 2000)
      setConfirmItem(null)
      return
    }
    onPurchase(selectedStudent.id, confirmItem)
    setPurchaseMsg(`${selectedStudent.name} 購買了 ${confirmItem.name}！`)
    setTimeout(() => setPurchaseMsg(null), 2000)
    setConfirmItem(null)
  }

  const unitLabel = (unit) => {
    if (unit === 'cookie') return '🍪'
    if (unit === 'fish') return '🐟'
    return 'pt'
  }

  // Refresh selectedStudent reference from students array
  const currentStudent = selectedStudent ? students.find(s => s.id === selectedStudent.id) || selectedStudent : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative bg-[#fdfbf7] rounded-3xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Orange theme top bar */}
        <div className="h-3 bg-gradient-to-r from-[#FFD6A5] to-[#FF8A8A] shrink-0" />

        {/* Header */}
        <div className="p-6 border-b border-[#E8E8E8] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#FFD6A5] to-[#FF8A8A] flex items-center justify-center text-2xl">
              {shop.icon || '🐱'}
            </div>
            <div>
              <h2 className="text-2xl font-bold text-[#5D5D5D]">{shop.name || '橘喵商店'}</h2>
              <p className="text-sm text-[#8B8B8B]">選擇村民後購買商品</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-[#E8E8E8] transition-colors">
            <X size={24} className="text-[#5D5D5D]" />
          </button>
        </div>

        {/* Success/Error message */}
        {purchaseMsg && (
          <div className={`mx-6 mt-4 px-4 py-2.5 rounded-xl text-sm font-medium text-center animate-fade-in ${
            purchaseMsg.includes('不足')
              ? 'bg-[#FFADAD]/20 border border-[#FFADAD] text-[#D64545]'
              : 'bg-[#E8F5E9] border border-[#A8D8B9] text-[#4A7C59]'
          }`}>
            {purchaseMsg}
          </div>
        )}

        {/* Shop View */}
        <div className="flex flex-1 min-h-0">
          {/* Left: Student selector */}
          <div className="w-48 border-r border-[#E8E8E8] p-4 overflow-y-auto shrink-0" style={{ scrollbarWidth: 'thin' }}>
            <h3 className="text-sm font-bold text-[#5D5D5D] mb-3">選擇村民</h3>
            <div className="space-y-1">
              {students.map(s => (
                <div
                  key={s.id}
                  onClick={() => setSelectedStudent(s)}
                  className={`flex items-center gap-2 p-2 rounded-xl cursor-pointer transition-all ${
                    currentStudent?.id === s.id
                      ? 'bg-[#FFD6A5]/30 border-2 border-[#FFD6A5]'
                      : 'hover:bg-[#F9F9F9] border-2 border-transparent'
                  }`}
                >
                  <AvatarEmoji seed={s.uuid || s.id} className="w-8 h-8 rounded-lg text-sm shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate text-[#5D5D5D]">{s.name}</div>
                    <div className="text-[10px] text-[#8B8B8B] truncate">
                      {formatCurrency(s.bank?.balance || 0, rates).display}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Store items grid */}
          <div className="flex-1 p-6 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
            {!currentStudent ? (
              <div className="text-center py-16">
                <div className="text-5xl mb-4">{shop.icon || '🐱'}</div>
                <p className="text-[#8B8B8B]">請先在左側選擇一位村民</p>
              </div>
            ) : products.length === 0 ? (
              <div className="text-center py-16">
                <div className="text-5xl mb-4">📦</div>
                <p className="text-[#8B8B8B] mb-2">商店空空如也</p>
                <p className="text-xs text-[#8B8B8B]">請在村莊設定的「商店設定」中新增商品</p>
              </div>
            ) : (
              <>
                {/* Selected student info bar */}
                <div className="flex items-center gap-3 mb-4 p-3 bg-[#FFD6A5]/10 rounded-xl border border-[#FFD6A5]/30">
                  <AvatarEmoji seed={currentStudent.uuid || currentStudent.id} className="w-10 h-10 rounded-xl text-lg" />
                  <div>
                    <div className="text-sm font-bold text-[#5D5D5D]">{currentStudent.name}</div>
                    <div className="text-xs text-[#8B6914]">
                      餘額：{formatCurrency(currentStudent.bank?.balance || 0, rates).display}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {products.map(item => {
                    const priceInPoints = toPoints(item.price, item.priceUnit, rates)
                    const canAfford = (currentStudent.bank?.balance || 0) >= priceInPoints
                    const inStock = item.stock > 0

                    return (
                      <div
                        key={item.id}
                        className={`bg-white rounded-2xl p-4 border-2 transition-all ${
                          canAfford && inStock
                            ? 'border-[#FFD6A5] hover:shadow-lg cursor-pointer hover:-translate-y-1'
                            : 'border-[#E8E8E8] opacity-60'
                        }`}
                        onClick={() => {
                          if (canAfford && inStock) setConfirmItem(item)
                        }}
                      >
                        <div className="text-4xl text-center mb-2">{item.icon || '🎁'}</div>
                        <h4 className="font-bold text-[#5D5D5D] text-center text-sm">{item.name || '未命名商品'}</h4>
                        <div className="text-center mt-2 font-bold text-[#8B6914]">
                          {item.price} {unitLabel(item.priceUnit)}
                        </div>
                        <div className={`text-xs text-center mt-1 ${inStock ? 'text-[#8B8B8B]' : 'text-[#D64545] font-bold'}`}>
                          {inStock ? `剩餘: ${item.stock}` : '售完'}
                        </div>
                        {!canAfford && inStock && <div className="text-xs text-center text-[#D64545] mt-1">餘額不足</div>}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Purchase confirmation overlay */}
        {confirmItem && currentStudent && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center z-10 animate-fade-in">
            <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl">
              <div className="text-5xl text-center mb-3">{confirmItem.icon || '🎁'}</div>
              <h3 className="text-lg font-bold text-center text-[#5D5D5D] mb-1">確認購買</h3>
              <p className="text-center text-[#8B8B8B] text-sm mb-1">
                {currentStudent.name} 購買「{confirmItem.name}」
              </p>
              <p className="text-center text-[#8B6914] font-bold mb-4">
                花費 {confirmItem.price} {unitLabel(confirmItem.priceUnit)}
                {confirmItem.priceUnit !== 'point' && (
                  <span className="text-xs font-normal text-[#8B8B8B] ml-1">
                    ({toPoints(confirmItem.price, confirmItem.priceUnit, rates)} pt)
                  </span>
                )}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmItem(null)}
                  className="flex-1 py-2.5 rounded-xl bg-[#E8E8E8] text-[#5D5D5D] font-medium hover:bg-[#D8D8D8] transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleConfirmPurchase}
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-[#FFD6A5] to-[#FF8A8A] text-white font-bold shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2"
                >
                  <ShoppingCart size={16} /> 確認購買
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default OrangeCatStoreModal
