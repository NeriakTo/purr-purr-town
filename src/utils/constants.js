// v3.4.0: 貨幣匯率 (所有金額以積分為基底儲存)
export const DEFAULT_CURRENCY_RATES = { fish: 100, cookie: 1000 }

// v3.4.0: 貨幣單位識別
export const CURRENCY_UNITS = { POINT: 'point', FISH: 'fish', COOKIE: 'cookie' }

// v3.4.0: 預設班級職務
export const DEFAULT_JOBS = [
  { id: 'job_class_leader', title: '班長', salary: 300, icon: '👑' },
  { id: 'job_health_leader', title: '衛生長', salary: 200, icon: '🧹' },
  { id: 'job_line_leader', title: '路隊長', salary: 100, icon: '🚶' },
]

// v3.4.0: 預設行為加扣分規則
export const DEFAULT_BEHAVIOR_RULES = [
  { id: 'rule_missing_hw', label: '作業缺交', amount: -200, type: 'fine', icon: '📕' },
  { id: 'rule_good_speak', label: '發表優良', amount: 100, type: 'bonus', icon: '🌟' },
]

// v3.4.0: 預設商店商品 (空，由老師自行上架)
export const DEFAULT_STORE_ITEMS = []

export const DEFAULT_SETTINGS = {
  taskTypes: ['作業', '訂正', '攜帶物品', '考試', '通知單', '回條'],
  groupAliases: {},
  announcements: [],
  jobs: DEFAULT_JOBS,
  behaviorRules: DEFAULT_BEHAVIOR_RULES,
  storeItems: DEFAULT_STORE_ITEMS,
  currencyRates: DEFAULT_CURRENCY_RATES,
}

export const STATUS_VALUES = {
  ON_TIME: 'on_time',
  LATE: 'late',
  MISSING: 'missing',
  LEAVE: 'leave',
  EXEMPT: 'exempt',
}

// 擴充至 30 種動物 (已排除豬)
export const AVATAR_EMOJIS = [
  '🐻', // Bear
  '🐱', // Cat
  '🐶', // Dog
  '🐰', // Rabbit
  '🦊', // Fox
  '🐼', // Panda
  '🐨', // Koala
  '🐯', // Tiger
  '🦁', // Lion
  '🐹', // Hamster
  '🐭', // Mouse
  '🦝', // Raccoon
  '🐮', // Cow
  '🐸', // Frog
  '🐔', // Chicken
  '🐧', // Penguin
  '🦉', // Owl
  '🦄', // Unicorn
  '🐺', // Wolf
  '🐴', // Horse
  '🦓', // Zebra (New)
  '🦒', // Giraffe (New)
  '🐘', // Elephant (New)
  '🦔', // Hedgehog (New)
  '🦦', // Otter (New)
  '🐢', // Turtle (New)
  '🦆', // Duck (New)
  '🦅', // Eagle (New)
  '🐵', // Monkey (New)
  '🦌'  // Deer (New)
]
export const AVATAR_COLORS = ['#FCE3E3', '#FDEBC8', '#E7F3D7', '#DDF1F8', '#E7E3FA', '#F8E6D8', '#FDE2F3', '#E2F0FF', '#E9F7F1', '#FFF1CC']

