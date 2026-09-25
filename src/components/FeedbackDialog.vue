<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-backdrop" @click.self="close">
      <div class="modal feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="fb-title">
        <header class="modal-head">
          <h3 id="fb-title">💌 意见反馈</h3>
          <button class="icon-btn" @click="close" aria-label="关闭">✕</button>
        </header>

        <div class="modal-body">
          <p class="intro">
            遇到 Bug？想要新功能？有其他建议？<br />
            {{ feedbackEmail ? '点「直接提交」即可（维护者在后台能看到）；也可以发邮件或复制内容。' : '点「直接提交」即可（维护者在后台能看到）；也可以复制或保存内容后自行发送。' }}
          </p>

          <div class="field">
            <label>反馈类型</label>
            <div class="cat-row">
              <button
                v-for="c in categories"
                :key="c.key"
                class="cat-btn"
                :class="{ active: category === c.key }"
                @click="category = c.key"
                type="button"
              >
                {{ c.icon }} {{ c.label }}
              </button>
            </div>
          </div>

          <div class="field">
            <label>标题 <span class="required">*</span></label>
            <input
              v-model="title"
              maxlength="80"
              :placeholder="titlePlaceholder"
              class="text-input"
            />
            <span class="char-count">{{ title.length }} / 80</span>
          </div>

          <div class="field">
            <label>详细描述 <span class="required">*</span></label>
            <textarea
              v-model="description"
              rows="6"
              maxlength="2000"
              :placeholder="descPlaceholder"
              class="text-input"
            ></textarea>
            <span class="char-count">{{ description.length }} / 2000</span>
          </div>

          <div class="field">
            <label>联系方式（可选）</label>
            <input
              v-model="contact"
              maxlength="60"
              placeholder="邮箱 / QQ / 微信 / GitHub ID"
              class="text-input"
            />
            <p class="hint">方便作者回复你；不填则不回复</p>
          </div>

          <div class="field">
            <label class="checkbox-label">
              <input type="checkbox" v-model="includeLogs" />
              <span>附加最近 100 行运行日志（强烈建议，便于排查 Bug）</span>
            </label>
            <label class="checkbox-label">
              <input type="checkbox" v-model="includeSystemInfo" />
              <span>附加系统信息（OS / 版本号）</span>
            </label>
          </div>

          <details v-if="previewMarkdown" class="preview-box">
            <summary>👁 预览反馈内容（Markdown 格式）</summary>
            <pre class="md-preview">{{ previewMarkdown }}</pre>
          </details>

          <div v-if="resultMsg" :class="['result', resultOk ? 'ok' : 'fail']">
            {{ resultMsg }}
          </div>
        </div>

        <footer class="modal-foot">
          <button class="btn-secondary" @click="close" :disabled="submitting">取消</button>
          <!-- 2026-09-25：主按钮改为「直接提交」——mailto 在手机上基本没人配邮件客户端（rabbit 原话「发邮件很多人不会用」）。
               提交走公开云函数 feedback，写好文案 + 联系方式的用户点一下就完事；邮件/复制/保存降级为备选通道。 -->
          <button class="btn-primary" @click="submitDirect" :disabled="!canSubmit || submitting">
            📮 直接提交
          </button>
          <button v-if="feedbackEmail" class="btn-secondary" @click="sendToEmail" :disabled="!canSubmit || submitting">
            📧 发送到邮箱
          </button>
          <button class="btn-secondary" @click="copyToClipboard" :disabled="!canSubmit || submitting">
            📋 复制到剪贴板
          </button>
          <button class="btn-secondary" @click="saveLocal" :disabled="!canSubmit || submitting">
            💾 保存到本地
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { toastSuccess, toastError } from '../utils/toast'
import { getRecentLogs, installLogCapture } from '../utils/log-buffer'

interface Props {
  visible: boolean
}
const props = defineProps<Props>()
const emit = defineEmits<{ (e: 'close'): void }>()

// 反馈收件地址：构建时从 .env 注入（VITE_FEEDBACK_EMAIL），源码与产物不含真实邮箱。
// 未配置时「发送到邮箱」按钮不渲染，只保留复制/下载两条通道。
const feedbackEmail = (import.meta.env.VITE_FEEDBACK_EMAIL as string) || ''

const categories = [
  { key: 'bug', label: 'Bug 报告', icon: '🐛' },
  { key: 'feature', label: '功能建议', icon: '💡' },
  { key: 'question', label: '使用问题', icon: '❓' },
  { key: 'other', label: '其他', icon: '📝' },
]

const category = ref('bug')
const title = ref('')
const description = ref('')
const contact = ref('')
const includeLogs = ref(true)
const includeSystemInfo = ref(true)
const submitting = ref(false)
const resultMsg = ref('')
const resultOk = ref(false)
// 2026-09-15 修复(P2-19)：预览块此前是死代码——previewMarkdown 从未赋值，
// `<details v-if="previewMarkdown">` 永不显示。改为 computed：可提交时实时预览
// 将要发出的完整 Markdown（与 assembleMarkdown 同一数据源）。
const previewMarkdown = computed(() => (canSubmit.value ? assembleMarkdown() : ''))

const titlePlaceholder = computed(() => {
  const map: Record<string, string> = {
    bug: '一句话描述 bug，如：导入 PDF 时闪退',
    feature: '希望增加什么功能？',
    question: '不知道怎么操作...',
    other: '其他反馈',
  }
  return map[category.value] || ''
})

const descPlaceholder = computed(() => {
  const map: Record<string, string> = {
    bug: '详细描述：\n1. 操作步骤\n2. 预期结果\n3. 实际结果\n4. 出现频率（每次/偶尔）',
    feature: '希望解决什么问题？\n希望怎么实现？',
    question: '详细说明你卡在哪里',
    other: '想说的话',
  }
  return map[category.value] || ''
})

const canSubmit = computed(() => {
  return title.value.trim().length > 0 && description.value.trim().length > 0
})

watch(
  () => props.visible,
  (v) => {
    if (v) {
      // 2026-09-15 复审 MF-1：日志缓冲改为**首次打开本弹窗时**才安装（installLogCapture 幂等）。
      // 原先装在 main.ts 启动路径上，而本组件当前是孤儿（无人引用）⇒ 那份常驻包装没有可达的消费者。
      installLogCapture()
      // 打开时重置（previewMarkdown 已改为 computed，随输入自动更新，无需手动清）
      resultMsg.value = ''
      resultOk.value = false
    }
  }
)

async function buildPayload() {
  if (!canSubmit.value) {
    toastError('请填写标题和详细描述')
    return null
  }
  submitting.value = true
  try {
    // 2026-09-15 修复(P2-19)：原实现的正文只用标题/描述/联系方式拼装，**构建时从不读**这两个
    // 复选框的值（v-model 把状态接上了，但没人用它）⇒「附加最近 100 行运行日志（强烈建议，
    // 便于排查 Bug）」与「附加系统信息」都是假的。现在：
    //   · 日志：按 `includeLogs` 勾选状态真实附加（取自 utils/log-buffer.ts 的环形缓冲，
    //     由本组件首次打开时安装，见上面 watch）；
    //   · 系统信息：`navigator.userAgent`（OS/浏览器/版本）。
    // ⚠️ 复审 MF-6 更正一处措辞（原先写成「都按勾选状态真实附加」，不准确）：
    //    `includeSystemInfo` 那个复选框**原先是 `checked disabled`**——用户取消不了，属于「强制附带 + 标签写明」。
    //    **2026-09-15 用户裁定：改成可取消**（默认仍勾选，用户想不带就能不带；标签照旧写明会附带什么）。
    return assembleMarkdown()
  } finally {
    submitting.value = false
  }
}

// 组装完整反馈 Markdown（预览与三个发送动作共用同一数据源）
function assembleMarkdown(): string {
  const parts: string[] = [
    `# ${category.value}反馈：${title.value.trim()}`,
    '',
    '## 详细描述',
    description.value.trim(),
  ]
  if (contact.value.trim()) parts.push('', `## 联系方式\n${contact.value.trim()}`)
  if (includeSystemInfo.value) parts.push('', `## 系统信息\n${navigator.userAgent}`)
  if (includeLogs.value) {
    const logs = getRecentLogs()
    if (logs.length) parts.push('', `## 最近运行日志（最后 ${logs.length} 行）\n\`\`\`\n${logs.join('\n')}\n\`\`\``)
  }
  return parts.join('\n')
}

// 2026-09-25：直接提交（走公开云函数 feedback，不需要口令、也不需要用户配过云同步）。
// 「附加日志」「附加系统信息」两个勾选框与其它通道**同一口径**——勾了就真带上（这两条历史上假过，
// 见 buildPayload 里 P2-19/MF-6 的注释）。联系方式走独立字段，后台一眼能看到该怎么回人。
async function submitDirect() {
  if (!canSubmit.value) { toastError('请填写标题和详细描述'); return }
  submitting.value = true
  resultMsg.value = ''
  try {
    const logs = includeLogs.value ? getRecentLogs() : []
    const bodyParts = [description.value.trim()]
    if (logs.length) bodyParts.push(`---\n最近运行日志（最后 ${logs.length} 行）\n${logs.join('\n')}`)
    const mod = await import('../lib/cloud')
    const res = await mod.submitFeedback({
      category: category.value,
      title: title.value.trim(),
      body: bodyParts.join('\n\n'),
      contact: contact.value.trim(),
      page: String(location.hash || ''),
      ua: includeSystemInfo.value ? navigator.userAgent : '',
    })
    if (res.ok) {
      resultOk.value = true
      resultMsg.value = res.notified === true ? '✓ 已提交，维护者会收到通知' : '✓ 已提交，维护者会在后台看到'
      toastSuccess('反馈已提交')
    } else {
      resultOk.value = false
      resultMsg.value = `✗ ${res.message || '提交失败'}（可改用「复制到剪贴板」发我）`
      toastError('提交失败')
    }
  } catch (e) {
    resultOk.value = false
    resultMsg.value = '✗ 提交失败：' + (e instanceof Error ? e.message : String(e))
  } finally {
    submitting.value = false
  }
}

async function copyToClipboard() {
  const md = await buildPayload()
  if (!md) return
  try {
    await navigator.clipboard.writeText(md)
    toastSuccess('已复制到剪贴板，去 GitHub 粘贴即可')
    resultOk.value = true
    resultMsg.value = '✓ 已复制 Markdown 到剪贴板'
  } catch (e) {
    // 降级：使用 execCommand
    try {
      const ta = document.createElement('textarea')
      ta.value = md
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      toastSuccess('已复制到剪贴板')
      resultOk.value = true
      resultMsg.value = '✓ 已复制 Markdown 到剪贴板'
    } catch (e2) {
      toastError('复制失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }
}

async function sendToEmail() {
  const md = await buildPayload()
  if (!md) return
  // mailto URL 长度限制：约 2048 字符（IE/Outlook），Chrome/Edge/QQ 邮件客户端约 8192
  // 超长内容会被截断，所以同时复制到剪贴板
  const categoryLabel = {
    bug: '[Bug]',
    feature: '[建议]',
    question: '[问题]',
    other: '[其他]',
  }[category.value] || '[' + category.value + ']'
  const subject = `小兔错题本意见反馈 ${categoryLabel} ${title.value.trim()}`

  // 2026-09-18 修复（重审 B-13）：`window.location.href = mailto:` **永不抛错**——没注册邮件客户端时
  //   它只是静默什么都不做，所以原来那个 try/catch 判不出成败，手机上什么都没发生也照样报
  //   「✓ 已唤起系统默认邮件客户端（QQ 邮箱）」。同时长文分支的剪贴板写入被 `catch {}` 吞掉，
  //   复制失败时文案仍宣称「已自动复制到剪贴板」。⇒ 用户以为发出去了，其实内容也没落剪贴板。
  // 改法：① 剪贴板**无条件**写一次并如实记录成败——它是这条链上唯一可验证的通道；
  //      ② mailto 仍尝试（跨平台最稳），但**只陈述「已尝试」**，成功与否交给用户判断，
  //         并明确说出「没反应时怎么办」，不再给一个探测不到的绿勾。
  let copied = false
  try {
    await navigator.clipboard.writeText(`收件人: ${feedbackEmail}\n主题: ${subject}\n\n${md}`)
    copied = true
  } catch { copied = false }

  let body = md
  // mailto URL 有长度限制（IE/Outlook 约 2048，Chrome/Edge/QQ 约 8192），超长会被截断 ⇒ body 放前 800 字 + 说明
  if (md.length > 1500) {
    body =
      `用户反馈内容较长，正文已截断。\n\n` +
      (copied
        ? `完整内容已复制到剪贴板，请在邮件编辑页按 Ctrl+V 粘贴。\n\n`
        : `注意：本次未能写入剪贴板，请手动复制完整内容。\n\n`) +
      `----------\n` +
      md.slice(0, 800) +
      `\n\n...(内容过长已截断)...`
  }

  const mailtoUrl =
    `mailto:${feedbackEmail}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`

  // 用 window.location 触发 mailto 协议（跨平台最稳）；但**赋值成功 ≠ 邮件客户端打开了**，
  // 所以下面只把「尝试过」当作事实陈述，不当作成功信号。
  let mailAttempted = true
  try {
    window.location.href = mailtoUrl
  } catch { mailAttempted = false }

  resultOk.value = true
  resultMsg.value =
    (mailAttempted ? '已尝试唤起系统邮件客户端。' : '无法唤起系统邮件客户端。') +
    (copied ? '反馈内容已复制到剪贴板，可直接粘贴。' : '未能写入剪贴板，请手动复制内容。') +
    `若没有反应，请把内容发送到 ${feedbackEmail}`
}

async function saveLocal() {
  const md = await buildPayload()
  if (!md) return
  try {
    // PWA 版：下载为文件
    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `反馈_${new Date().toISOString().slice(0, 10)}.md`
    a.click()
    URL.revokeObjectURL(url)
    toastSuccess('反馈内容已下载为文件')
    resultOk.value = true
    resultMsg.value = '✓ 已下载，可将文件内容粘贴到项目 GitHub Issues'
  } catch (e) {
    toastError('保存失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

function close() {
  emit('close')
}
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  /* align-items 用 flex-start 而不是 center：配合面板的 margin:auto —— 放得下时居中，
     放不下时从顶部排布、由遮罩滚动（center 会在两头都切掉内容且滚不到） */
  align-items: flex-start;
  justify-content: center;
  z-index: 9999;
  backdrop-filter: blur(2px);
  /* 2026-09-25 修复（rabbit 手机截图：底栏那一排按钮被切在屏幕外）：
     手机上 100vh 是**地址栏收起后**的高度，比眼前看得见的区域高；面板按 vh 定高又垂直居中，
     底部就被推到屏幕外——而遮罩自己不滚、页面又被 position:fixed 钉住 ⇒ 那排按钮永远够不着。
     ⇒ 遮罩自己当滚动容器（留 12px 边距 + 底部安全区），面板 margin:auto。 */
  overflow-y: auto;
  padding: 12px;
  padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
}
.modal {
  background: var(--bg, #fff);
  color: var(--text, #222);
  border-radius: 12px;
  width: 90%;
  max-width: 640px;
  max-height: 90vh;
  max-height: 90dvh; /* 动态视口高：跟着地址栏/工具条收缩，才是移动端「看得见的高度」；不支持的浏览器用上一行 */
  margin: auto;      /* 与遮罩的 align-items:flex-start 配合：放得下居中、放不下可滚 */
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  /* 2026-09-25：全局移动端块给 .modal-body 强行加了 `width:100% !important`，而它默认是 content-box
     ⇒ 296 的面板里量出 336 的正文（padding 20×2 加在外面），内容被切在屏幕右缘。
     border-box 让 width:100% 把 padding 算进去，与「面板多宽正文就多宽」的意图一致。 */
  box-sizing: border-box;
}
/* 全局移动端块（style.css ≤768px）是按「.modal=遮罩 / .modal-body=面板」的命名写的（HomeView 那套），
   本组件命名相反 ⇒ 会被它加上面板内边距与圆角，看上去像面板里又套了两个框。
   这里用组件自身作用域（优先级更高）把那两处修饰复位。 */
@media (max-width: 768px) {
  .modal {
    padding: 0;
    width: 100%;
    /* 手机档把上限收到 84：真机地址栏/工具条一般占 5~8% 高，收到 84 后**即使浏览器不支持 dvh、
       退回 vh（=地址栏收起时的高度）也还留得住余量**，不至于又把底栏顶出屏幕。
       支持的浏览器用 84dvh，直接按「看得见的高度」算。 */
    max-height: 84vh;
    max-height: 84dvh;
  }
  .modal-body {
    padding: 16px;
    border-radius: 0;
  }
}
.feedback-dialog {
  max-width: 720px;
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}
.modal-head h3 {
  margin: 0;
  font-size: 18px;
}
.icon-btn {
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: var(--text-muted, #888);
  padding: 4px 8px;
  border-radius: 6px;
}
.icon-btn:hover {
  background: rgba(0, 0, 0, 0.05);
}
.modal-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
  box-sizing: border-box;
}
.modal-foot {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 12px 20px;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  flex-wrap: wrap;
}
.intro {
  color: var(--text-muted, #666);
  font-size: 13px;
  margin: 0 0 16px;
  line-height: 1.5;
}
.field {
  margin-bottom: 14px;
}
.field label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 6px;
}
.required {
  color: var(--color-danger-strong);
}
.text-input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid rgba(0, 0, 0, 0.15);
  border-radius: 6px;
  font-size: 13px;
  font-family: inherit;
  background: var(--input-bg, #fff);
  color: var(--text, #222);
  box-sizing: border-box;
  resize: vertical;
}
.text-input:focus {
  outline: none;
  border-color: var(--color-info-strong);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
}
textarea.text-input {
  min-height: 100px;
  font-family: 'Consolas', 'Monaco', monospace;
}
.char-count {
  display: block;
  text-align: right;
  font-size: 11px;
  color: var(--text-muted, #999);
  margin-top: 2px;
}
.cat-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.cat-btn {
  flex: 1;
  min-width: 110px;
  padding: 8px 10px;
  border: 1px solid rgba(0, 0, 0, 0.15);
  border-radius: 6px;
  background: var(--input-bg, #fff);
  color: var(--text, #222);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}
.cat-btn:hover {
  border-color: var(--color-info-strong);
}
.cat-btn.active {
  background: var(--color-info-strong);
  color: #fff;
  border-color: var(--color-info-strong);
}
.checkbox-label {
  display: flex !important;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: normal !important;
  margin-bottom: 4px;
  cursor: pointer;
}
.checkbox-label input {
  cursor: pointer;
}
.hint {
  font-size: 11px;
  color: var(--text-muted, #999);
  margin: 4px 0 0;
}
.preview-box {
  margin-top: 12px;
  background: rgba(0, 0, 0, 0.03);
  padding: 10px;
  border-radius: 6px;
}
.preview-box summary {
  cursor: pointer;
  font-size: 13px;
  color: var(--text-muted, #666);
  margin-bottom: 8px;
}
.md-preview {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
  overflow-y: auto;
  background: var(--input-bg, #fff);
  padding: 8px;
  border-radius: 4px;
  margin: 0;
  border: 1px solid rgba(0, 0, 0, 0.08);
}
.result {
  margin-top: 10px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
}
.result.ok {
  background: rgba(34, 197, 94, 0.1);
  color: var(--color-success-strong);
  border: 1px solid rgba(34, 197, 94, 0.3);
}
.result.fail {
  background: rgba(239, 68, 68, 0.1);
  color: var(--color-danger-strong);
  border: 1px solid rgba(239, 68, 68, 0.3);
}
.btn-primary {
  background: var(--color-info-strong);
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}
.btn-primary:hover:not(:disabled) {
  background: var(--color-info-deep);
}
.btn-primary:disabled {
  background: var(--color-info-strong);
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-secondary {
  background: transparent;
  color: var(--text, #222);
  border: 1px solid rgba(0, 0, 0, 0.15);
  padding: 8px 14px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.btn-secondary:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.05);
}
.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
