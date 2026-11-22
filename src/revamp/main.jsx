import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// 只有 --mode test 的建置會執行這段。正式建置時條件是常數 false，
// 整段連同動態載入的測試入口模組都會在建置時移除（test/build/revamp-build.test.js 驗證）。
if (__PPT_TEST_HOOKS__) {
  import('./testing/install.js')
    .then(({ installTestHooks }) => installTestHooks(window))
    .catch(error => {
      console.error('測試入口載入失敗', error)
    })
}
