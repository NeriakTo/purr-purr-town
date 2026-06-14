// 評語助手 Gemini API 服務
// 從 Meow-Comment-Helper 移植，封裝為 React 友好的模組

const FREE_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.5-flash']
const PAID_MODELS = ['gemini-2.5-pro', 'gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const MODEL_TIMEOUT_MS = 15000
const TOTAL_TIMEOUT_MS = 30000

function buildPrompt(name, rawComment, { lockedComment = false, lockedMotto = false } = {}) {
  let taskInstruction = '請同時生成 comment 與 motto。'
  if (lockedComment && !lockedMotto) {
    taskInstruction = '⚠️ 任務限制：使用者已鎖定「comment」欄位，請**僅生成 motto (八字箴言)**，comment 欄位請回傳空字串。'
  } else if (!lockedComment && lockedMotto) {
    taskInstruction = '⚠️ 任務限制：使用者已鎖定「motto」欄位，請**僅生成 comment (暖心評語)**，motto 欄位請回傳空字串。'
  }

  return `
角色設定：你現在身兼兩個角色。
1. 【給家長看】你是一位溫暖、正向的台灣國小導師。
2. 【給校方存檔】你是一位**客觀、嚴格、不帶感情**的教務處紀錄人員。

輸入資料：
- 學生姓名：${name}
- 觀察紀錄：${rawComment}

${taskInstruction}

任務：請根據「觀察紀錄」進行分析，並輸出 JSON 格式結果。

*** 關鍵邏輯 (Motto 生成規則) ***
請先在心裡對「觀察紀錄」進行評分 (Score 1-10)：
- 分數 1-4 (負面/需改進)：內容包含干擾上課、作業缺交、打架、無禮、粗心等。
- 分數 5-7 (普通/好壞參半)：有優點也有明顯缺點。
- 分數 8-10 (正面/優良)：絕大多數為正向描述。

嚴格執行以下對應 (不可混淆)：
- 若為【負面】：絕對禁止使用「活潑、開朗、聰明、潛力」等正向詞。必須使用**「糾正型」**詞彙，如：遵守校規、改進常規、專注學業、加強自律、端正品行。
- 若為【普通】：必須是「一個優點 + 一個建議」。
- 若為【正面】：才可以使用「品學兼優、熱心助人」等讚美詞。

輸出格式 (JSON)：
{
    "analysis": "請輸出你的判斷：(A)全優 / (B)半優半缺 / (C)多缺點",
    "comment": "給學生的暖心評語 (70-100字，三明治法，將缺點轉化為期待)",
    "motto": "給校方的八字箴言 (嚴格遵守上述邏輯，四字，四字)"
}

範例參考：
- 觀察紀錄："上課愛講話，作業隨便寫" -> 判定為(C) -> motto: "改進常規，端正態度" (❌不可寫：活潑健談)
- 觀察紀錄："很聰明但粗心" -> 判定為(B) -> motto: "反應靈敏，加強細心"
`.trim()
}

function parseGeminiResponse(text) {
  try {
    let jsonStr = text
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fenced) {
      jsonStr = fenced[1]
    }
    const parsed = JSON.parse(jsonStr.trim())
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('AI 回傳格式非有效物件')
    }
    return {
      analysis: parsed.analysis || '',
      comment: parsed.comment || '',
      motto: parsed.motto || '',
    }
  } catch (err) {
    throw new Error(`評語格式解析失敗: ${err.message}`)
  }
}

/**
 * 對單一學生產生評語
 * @param {object} params
 * @param {string} params.name 學生姓名
 * @param {string} params.rawComment 觀察紀錄
 * @param {string} params.keyTier "free" | "paid"
 * @param {string} params.apiKey Gemini API Key
 * @param {AbortSignal} [params.signal] 外部中斷信號（批次模式用）
 * @returns {Promise<{analysis: string, comment: string, motto: string, modelUsed: string}>}
 */
export async function generateComment({ name, rawComment, keyTier, apiKey, signal, lockedComment = false, lockedMotto = false }) {
  if (!apiKey) throw new Error('未設定 Gemini API Key')
  if (!rawComment?.trim()) throw new Error('觀察紀錄不能為空')

  const candidateModels = keyTier === 'paid' ? PAID_MODELS : FREE_MODELS
  const prompt = buildPrompt(name, rawComment, { lockedComment, lockedMotto })
  let lastError = ''

  const totalStart = Date.now()

  for (const model of candidateModels) {
    if (signal?.aborted) throw new DOMException('已中斷', 'AbortError')

    const elapsed = Date.now() - totalStart
    if (elapsed >= TOTAL_TIMEOUT_MS) {
      throw new Error(`整體超過 ${TOTAL_TIMEOUT_MS / 1000} 秒未完成。最後錯誤：${lastError}`)
    }
    const remainingMs = TOTAL_TIMEOUT_MS - elapsed
    const perModelMs = Math.min(MODEL_TIMEOUT_MS, remainingMs)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), perModelMs)

    if (signal) {
      signal.addEventListener('abort', () => controller.abort(), { once: true })
    }

    try {
      const res = await fetch(`${API_BASE}/${model}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        const errMsg = errBody?.error?.message || res.statusText

        if (res.status === 429) {
          throw new Error('API 使用次數超過限制，請等待 1 分鐘後再試')
        }

        lastError = `${model}: ${res.status} ${errMsg}`
        console.warn(`Model ${model} HTTP ${res.status}:`, errMsg)
        continue
      }

      const data = await res.json()
      const content = data?.candidates?.[0]?.content?.parts?.[0]?.text
      if (!content) {
        lastError = `${model}: 回應無內容`
        continue
      }

      const result = parseGeminiResponse(content)
      return { ...result, modelUsed: model }
    } catch (e) {
      clearTimeout(timeoutId)

      if (e.name === 'AbortError') {
        if (signal?.aborted) throw new DOMException('已中斷', 'AbortError')
        lastError = `${model}: 超時未回應`
        console.warn(`Model ${model} timed out.`)
        continue
      }

      if (e.message?.includes('API 使用次數')) throw e

      lastError = `${model}: ${e.message}`
      console.warn(`Model ${model} error:`, e.message)
      continue
    }
  }

  throw new Error(`所有模型皆失敗。最後錯誤：${lastError}`)
}

/**
 * 批次產生評語（帶節流）
 * @param {object} params
 * @param {Array<{id: string, name: string, rawComment: string}>} params.students 待生成的學生列表
 * @param {string} params.keyTier "free" | "paid"
 * @param {string} params.apiKey
 * @param {string} params.semester 學期 key（如 "114-2"）
 * @param {function} params.onProgress 每完成/失敗一位呼叫 (studentId, result|error, index)
 * @param {AbortSignal} [params.signal] 中斷信號
 * @returns {Promise<{completed: number, failed: number, total: number}>}
 */
export async function generateCommentsBatch({ students, keyTier, apiKey, semester, onProgress, signal }) {
  const intervalMs = keyTier === 'paid' ? 2000 : 5000
  let completed = 0
  let failed = 0

  for (let i = 0; i < students.length; i++) {
    if (signal?.aborted) break

    const student = students[i]
    let progressPayload = null
    try {
      const result = await generateComment({
        name: student.name,
        rawComment: student.rawComment,
        keyTier,
        apiKey,
        signal,
        lockedComment: student.lockedComment,
        lockedMotto: student.lockedMotto,
      })
      completed++
      progressPayload = { success: true, ...result, semester }
    } catch (e) {
      if (e.name === 'AbortError') break
      failed++
      progressPayload = { success: false, error: e.message, semester }
      // 429 限速：中斷整個批次，避免連續轟炸 API
      if (e.message?.includes('API 使用次數')) {
        onProgress?.(student.id, progressPayload, i)
        break
      }
    }

    if (progressPayload) {
      onProgress?.(student.id, progressPayload, i)
    }

    if (i < students.length - 1 && !signal?.aborted) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, intervalMs)
        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timer)
            resolve()
          }, { once: true })
        }
      })
    }
  }

  return { completed, failed, total: students.length }
}

export { FREE_MODELS, PAID_MODELS }
