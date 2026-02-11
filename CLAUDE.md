# CLAUDE.md - Purr Purr Town

## Project Overview

**呼嚕嚕小鎮 (Purr Purr Town)** v3.6.0 - Local-First 遊戲化班級經營系統
- React 19 + Vite 7 + Tailwind CSS 4 SPA
- LocalStorage 持久化，Google Apps Script 雲端備份
- 部署至 GitHub Pages (`/purr-purr-town/`)
- 授權: CC-BY-NC-SA-4.0

## Critical Rules

### 1. Code Organization
- Organize by feature/domain (components/, modals/, utils/, views/)
- Keep files focused and manageable
- Extract shared logic to utils/helpers.js or utils/constants.js

### 2. Code Style
- Immutability always - never mutate state objects directly, use spread operator
- All dates as `yyyy-MM-dd` string format
- Use existing patterns: `createTransaction()` for bank ops, `normalizeStatus()` for status
- Follow existing Chinese naming conventions in UI labels and comments
- Tailwind CSS 4 utility classes for styling (no separate CSS modules)

### 3. State Management
- DashboardView.jsx is the single state management hub (28+ useState)
- All child components receive data via props + callback functions
- No Redux, no Context API - pure prop drilling + callbacks
- Use `useMemo` for derived/computed values
- Use `useRef` for values needed inside closures (see `allLogsRef` pattern)

### 4. Data Persistence
- Auto-save via useEffect whenever state changes
- LocalStorage keys: `ppt_cache_class_{classId}`, `ppt_local_classes`
- Use `loadClassCache()` / `saveClassCache()` from helpers.js
- Bank transactions are NEVER physically deleted - use voided + correction entry

### 5. Security
- No hardcoded secrets in source code
- Verification Token for GAS backup is masked in UI (SettingsModal)
- Validate user inputs at form boundaries

## File Structure

```
src/
├── App.jsx               # Router: LoginView / DashboardView
├── main.jsx              # Entry point (StrictMode)
├── index.css             # Tailwind + CSS vars + animations
├── views/
│   ├── DashboardView.jsx # STATE HUB - all core state lives here
│   ├── LoginView.jsx     # Class selection entry
│   └── FocusView.jsx     # Projection mode (blackboard style)
├── components/
│   ├── common/           # Header, AvatarEmoji, IconPicker, LoadingScreen
│   ├── calendar/         # CalendarNav (react-calendar)
│   └── dashboard/        # TaskBoard, SquadGrid, VillagerCard, BulletinBoard
├── components/modals/    # All modal windows (9 total)
│   ├── PassportModal.jsx # Most complex - tasks/passbook/inventory
│   ├── SettingsModal.jsx # 6-tab config hub + cloud backup
│   ├── OrangeCatStoreModal.jsx
│   ├── TeamManagementModal.jsx
│   ├── TaskOverviewModal.jsx
│   ├── HistoryModal.jsx
│   ├── GadgetsModal.jsx
│   ├── AnnouncementModal.jsx
│   └── CreateClassModal.jsx
└── utils/
    ├── constants.js      # All defaults, enums, emoji libraries
    └── helpers.js        # Core logic: banking, currency, dates, avatars
```

## Key Patterns

### Currency System (Three-Tier)
```javascript
// Points (base) → Fish (rate:100) → Cookie (rate:1000)
// Use resolveCurrency(), formatCurrency(), toPoints() from helpers.js
// All prices stored as { price, priceUnit }, converted to points for comparison
```

### Banking Transactions
```javascript
// Always use createTransaction(bank, amount, reason)
// Returns: { id, date, amount, reason, balance }
// To undo: mark voided:true + append correction transaction
// NEVER delete transaction records
```

### Task Automation (v3.6.0 toggleStatus)
```javascript
// Three-phase process:
// Phase 1: UNDO old status effects (revoke penalties/bonuses)
// Phase 2: UPDATE status in allLogs
// Phase 3: APPLY new effects (setTimeout for closure safety via allLogsRef)
```

### Avatar System
```javascript
// Seed format: 's_{classSeed}_{studentNumber}'
// getAvatarMeta(seed) → { emoji, color }
// Deterministic: same seed always produces same avatar
```

## CSS Theme Variables
```css
--color-primary:      #A8D8B9  /* Mint green */
--color-primary-dark:  #7BC496
--color-warning:       #FFADAD  /* Pink */
--color-accent:        #FFD6A5  /* Apricot */
--color-text:          #5D5D5D
--color-bg:            #fdfbf7  /* Off-white */
```

## Environment & Build

```bash
npm run dev       # Start dev server
npm run build     # Production build
npm run deploy    # Deploy to GitHub Pages
```

- Vite config injects `__APP_VERSION__` globally
- Base path: `/purr-purr-town/`
- Tailwind 4 CSS-first config (no tailwind.config.js)

## Available Commands

- `/plan` - Create implementation plan before coding
- `/code-review` - Review code quality and security
- `/build-fix` - Fix build errors incrementally
- `/tdd` - Test-driven development workflow
- `/refactor-clean` - Identify and remove dead code

## Git Workflow

- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`
- Review changes before committing
- Keep commits focused and atomic
