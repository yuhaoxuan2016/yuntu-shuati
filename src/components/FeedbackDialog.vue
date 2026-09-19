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
            告诉我们，反馈会直接发到作者的 QQ 邮箱。
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
          <button class="btn-primary" @click="sendToQQMail" :disabled="!canSubmit || submitting">
            📧 发送到 QQ 邮箱
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

async function sendToQQMail() {
  const md = await buildPayload()
  if (!md) return
  // mailto URL 长度限制：约 2048 字符（IE/Outlook），Chrome/Edge/QQ 邮件客户端约 8192
  // 超长内容会被截断，所以同时复制到剪贴板
  const FEEDBACK_EMAIL = '2943663274@qq.com'
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
    await navigator.clipboard.writeText(`收件人: ${FEEDBACK_EMAIL}\n主题: ${subject}\n\n${md}`)
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
    `mailto:${FEEDBACK_EMAIL}` +
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
    `若没有反应，请把内容发送到 ${FEEDBACK_EMAIL}`
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
  align-items: center;
  justify-content: center;
  z-index: 9999;
  backdrop-filter: blur(2px);
}
.modal {
  background: var(--bg, #fff);
  color: var(--text, #222);
  border-radius: 12px;
  width: 90%;
  max-width: 640px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
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
