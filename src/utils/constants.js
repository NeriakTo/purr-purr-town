// v3.4.0: 貨幣匯率 (所有金額以積分為基底儲存)
export const DEFAULT_CURRENCY_RATES = { fish: 100, cookie: 1000 }

// v3.4.0: 貨幣單位識別
export const CURRENCY_UNITS = { POINT: 'point', FISH: 'fish', COOKIE: 'cookie' }

// v3.4.2: 薪資發放週期
export const JOB_CYCLES = {
  weekly: '每週',
  monthly: '每月',
  semester: '每學期',
  once: '一次性',
}

// v3.4.0: 預設班級職務
export const DEFAULT_JOBS = [
  { id: 'job_class_leader', title: '班長', salary: 300, icon: '👑', cycle: 'weekly' },
  { id: 'job_health_leader', title: '衛生長', salary: 200, icon: '🧹', cycle: 'weekly' },
  { id: 'job_line_leader', title: '路隊長', salary: 100, icon: '🚶', cycle: 'weekly' },
]

// v3.4.4: 預設行為規範類別
export const DEFAULT_RULE_CATEGORIES = [
  { id: 'cat_homework', name: '作業', icon: '📚' },
  { id: 'cat_discipline', name: '秩序', icon: '📏' },
  { id: 'cat_class', name: '課堂表現', icon: '🎯' },
  { id: 'cat_hygiene', name: '整潔', icon: '🧹' },
]

// v3.4.0: 預設行為加扣分規則
export const DEFAULT_BEHAVIOR_RULES = [
  { id: 'rule_missing_hw', label: '作業缺交', amount: -200, type: 'fine', icon: '📕', category: '作業' },
  { id: 'rule_good_speak', label: '發表優良', amount: 100, type: 'bonus', icon: '🌟', category: '課堂表現' },
]

// v3.5.0: 預設商店商品
export const DEFAULT_SHOP_PRODUCTS = [
  { id: 'prod_homework_off', name: '減功課卡', icon: '📝', price: 1, priceUnit: 'cookie', stock: 10 },
  { id: 'prod_nap_free', name: '午休免睡卡', icon: '😴', price: 2, priceUnit: 'cookie', stock: 5 },
  { id: 'prod_nap_read', name: '午休閱讀卡', icon: '📖', price: 3, priceUnit: 'cookie', stock: 5 },
  { id: 'prod_nap_game', name: '午休桌遊卡', icon: '🎲', price: 4, priceUnit: 'cookie', stock: 3 },
  { id: 'prod_nap_camp', name: '午休露營卡', icon: '⛺', price: 5, priceUnit: 'cookie', stock: 1 },
  { id: 'prod_nap_tablet', name: '午休平板卡', icon: '📱', price: 6, priceUnit: 'cookie', stock: 1 },
]

// v3.5.0: 預設商店設定
export const DEFAULT_SHOP = {
  name: '橘喵商店',
  icon: '🐱',
  products: DEFAULT_SHOP_PRODUCTS,
}

export const DEFAULT_SETTINGS = {
  taskTypes: ['作業', '訂正', '攜帶物品', '考試', '通知單', '回條'],
  groupAliases: {},
  announcements: [],
  jobs: DEFAULT_JOBS,
  behaviorRules: DEFAULT_BEHAVIOR_RULES,
  shop: DEFAULT_SHOP,
  currencyRates: DEFAULT_CURRENCY_RATES,
  ruleCategories: DEFAULT_RULE_CATEGORIES,
  jobAssignments: {},
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

