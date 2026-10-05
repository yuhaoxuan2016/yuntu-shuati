<template>
  <div class="settings">
    <h2>设置</h2>

    <section>
      <h3>外观</h3>
      <label>主题
        <select v-model="theme" @change="saveTheme">
          <option value="system">跟随系统</option>
          <option value="light">亮色</option>
          <option value="dark">暗色</option>
        </select>
      </label>
      <label>字号
        <select v-model="fontSize" @change="saveFontSize">
          <option value="small">小</option>
          <option value="medium">中（默认）</option>
          <option value="large">大</option>
        </select>
      </label>
      <p class="hint">字号调整界面整体大小，方便不同视力需求</p>
      <label>主题色</label>
      <div class="theme-color-row">
        <button v-for="c in themeColorList"
          :key="c.id + (c.id === 'cloud' ? `-s${cloudShakeSeq}` : '')"
          class="swatch" :class="{ active: themeColor === c.id, 'swatch-cloud': c.id === 'cloud', 'swatch-shake': c.id === 'cloud' && cloudShakeSeq > 0 }"
          :style="{ background: c.bg, color: c.fg, borderColor: themeColor === c.id ? c.bg : 'transparent' }"
          @click="onSwatchClick(c)" :title="c.name">
          <span v-if="themeColor === c.id" class="swatch-check">✓</span>
          <span class="swatch-name">{{ c.name }}</span>
          <span v-if="c.id === 'cloud'" class="cloud-hint">咦？</span>
          <template v-if="c.id === 'cloud' && cloudLaunchSeq > 0">
            <span v-for="(p, pi) in ['☁️', '✨', '⭐']" :key="`${cloudLaunchSeq}-${pi}`" class="cloud-particle" :style="{ '--dx': (pi - 1) * 14 + 'px', animationDelay: pi * 0.12 + 's' }">{{ p }}</span>
          </template>
        </button>
      </div>
    </section>

    <section>
      <h3>AI 识别引擎</h3>
      <label>API Key <input v-model="apiKey" @blur="save('ai_api_key', apiKey)" type="password" placeholder="粘贴你的 API Key" /></label>
      <p class="hint">没有 Key？去以下平台注册后自行获取（各家活动、价格与模型随时可能调整，以平台现价为准）：</p>
      <div class="key-links">
        <a href="https://opencode.ai/auth" target="_blank">OpenCode → 官方订阅：Go（订阅制，DeepSeek/Kimi/GLM 等开源模型）/ Zen（按量，Claude/GPT/Gemini 等）</a>
        <a href="https://cloud.siliconflow.cn/i/TPL3Ne7Z" target="_blank">硅基流动（SiliconFlow）→ 模型聚合平台，一个 Key 用 DeepSeek 等多个模型【推荐】</a>
        <a href="https://platform.deepseek.com/" target="_blank">DeepSeek 官方 → 直连官方 API</a>
      </div>
      <label>Base URL <input v-model="baseUrl" @blur="save('ai_base_url', baseUrl)" /></label>
      <label>模型 <input v-model="model" @blur="save('ai_model', model)" /></label>
      <div class="model-tips">
        <p class="hint">推荐模型（点击可直接填入；下面这组 ID 于 2026-09-19 核对过，平台会随时增删）：</p>
        <div class="model-list">
          <button class="model-pick" @click="pickModel('deepseek-flash', 'https://api.deepseek.com/v1')">
            <strong>deepseek-flash</strong> <span class="tag fast">极速·低价</span> DeepSeek 官方现役极速档（日常首选）
          </button>
          <button class="model-pick" @click="pickModel('deepseek-v4-pro', 'https://api.deepseek.com/v1')">
            <strong>deepseek-v4-pro</strong> <span class="tag fast">旗舰</span> DeepSeek 官方旗舰（复杂推理，更贵更慢）
          </button>
          <button class="model-pick" @click="pickModel('deepseek-v4-flash', 'https://opencode.ai/zen/go/v1')">
            <strong>OpenCode Go</strong> <span class="tag fast">订阅制</span> 一个订阅用 DeepSeek/Kimi/GLM 等开源模型
          </button>
          <button class="model-pick" @click="pickModel('claude-sonnet-5', 'https://opencode.ai/zen/v1')">
            <strong>OpenCode Zen</strong> <span class="tag fast">按量</span> 官方托管，Claude/GPT/Gemini 等
          </button>
        </div>
        <p class="warn">⚠ 上表只是「点击自动填入」的示例：模型 ID 由各平台随时增删，填入已下线的 ID 会直接报 model not found——以平台文档为准</p>
      </div>
      <div class="test-row">
        <button class="test-btn" :disabled="testing" @click="testConnection">
          {{ testing ? '测试中...' : '测试连接' }}
        </button>
        <span v-if="testResult" class="test-result" :class="testResult.ok ? 'ok' : 'fail'">
          {{ testResult.ok ? '✓ 连接成功' : '✗ ' + testResult.msg }}
        </span>
      </div>
    </section>

    <section>
      <h3>练习</h3>
      <label>错题自动掌握
        <select v-model="wrongAutoMaster" @change="saveWrongAutoMaster">
          <option value="0">关闭（仅手动标记已掌握）</option>
          <option value="2">连续答对 2 次</option>
          <option value="3">连续答对 3 次（默认）</option>
          <option value="5">连续答对 5 次</option>
        </select>
      </label>
      <p class="hint">错题本中的题目在练习时连续答对指定次数，会自动移入「已掌握」；中途答错则重新计数。</p>
    </section>

    <section>
      <h3>更新</h3>
      <p class="hint">当前版本：<b>{{ currentVersion }}</b></p>
      <p class="hint">这个数字是<b>真正在跑的构建</b>（构建时注入）。有新版本时首页会自动弹提示，点它即更新；也可以直接点下面的按钮强制刷新</p>
      <div class="data-actions">
        <button class="data-btn" @click="manualCheckUpdate">
          🔄 刷新页面
        </button>
        <button class="data-btn" @click="showUpdateLog = !showUpdateLog">📜 更新日志</button>
        <button class="data-btn" @click="replayTour">👋 重看新手引导</button>
      </div>
      <div v-if="showUpdateLog" class="update-log">
        <h4>更新日志</h4>
        <div v-for="entry in visibleChangelog" :key="entry.ver" class="log-entry">
          <span class="log-version">{{ entry.ver }}</span>
          <!-- eslint-disable-next-line vue/no-v-html -- 内容为本仓库作者维护的受控静态 HTML（见 lib/changelog.ts 头部） -->
          <div class="log-body" v-html="entry.html"></div>
        </div>
        <button
          v-if="!logExpanded && hiddenChangelogCount > 0"
          class="log-more"
          @click="logExpanded = true"
        >查看更早的更新（{{ hiddenChangelogCount }} 条）</button>
        <button
          v-if="logExpanded && hiddenChangelogCount > 0"
          class="log-more"
          @click="logExpanded = false"
        >收起</button>
      </div>
    </section>

    <section>
      <h3>数据</h3>
      <!-- 云同步 -->
      <div class="cloud-box">
        <div class="cloud-header">
          <div class="cloud-title">
            <span class="cloud-icon">☁️</span>
            <div>
              <div class="cloud-name">腾讯云同步</div>
              <div class="cloud-desc">同浏览器云端备份 · 公共题库可跨设备共享</div>
            </div>
          </div>
          <label class="switch">
            <input type="checkbox" v-model="cloudEnabled" @change="onCloudToggle" />
            <span class="slider"></span>
          </label>
        </div>
        <div v-if="cloudEnabled" class="cloud-config">
          <div class="cloud-row">
            <label>环境 ID（envId）</label>
            <input v-model="cloudEnvId" :placeholder="DEFAULT_CLOUD_ENV_ID || '请输入环境 ID'" class="dir-input" />
          </div>
          <div class="cloud-row">
            <label>名字</label>
            <input v-model="syncNickname" @blur="saveSyncNickname" maxlength="32" placeholder="随便起、可重名（只是网名）" class="dir-input" />
          </div>
          <!-- 2026-10-04：找回码 —— 换设备 / 清浏览器数据后凭它回到同一身份（含小程序打通态）。
               8 位、服务端登记（只存 HMAC）；码丢了找不回，所以复制 / 下载两个出口都给。 -->
          <div class="cloud-row">
            <label>我的找回码</label>
            <div class="recover-code-box">
              <template v-if="recoverCode">
                <code class="recover-code">{{ recoverCode }}</code>
                <button class="data-btn slim" @click="copyRecoverCode">复制</button>
                <button class="data-btn slim" @click="downloadRecoverCode">下载</button>
                <!-- 2026-10-04：换码（码疑似泄露时用）——旧码立即作废并重发新码；已登录设备不受影响 -->
                <button class="data-btn slim" title="码疑似泄露时用：旧码立即作废，生成新码（记得重新下载保存）" @click="doRotateRecoverCode">🔄 换码</button>
              </template>
              <span v-else class="hint">{{ recoverCodeHint }}</span>
            </div>
          </div>
          <div v-if="showCodePrompt" class="code-prompt">
            <p><b>这是你的找回码，请先存好</b>（复制 / 下载都行）——换设备、清了浏览器数据时，就靠它把全部数据找回来。<b>码丢了找不回</b>。</p>
            <div class="code-prompt-actions">
              <button class="data-btn" @click="copyRecoverCode">复制</button>
              <button class="data-btn" @click="downloadRecoverCode">下载</button>
              <button class="data-btn" @click="showCodePrompt = false">我存好了</button>
            </div>
          </div>
          <!-- 2026-10-03：自动同步开关（默认开）——打开页面自动拉取；做题后自动回传进度 -->
          <div class="cloud-row">
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;">
              <input type="checkbox" v-model="autoSync" @change="onAutoSyncToggle" />
              <span>自动同步（打开页面自动拉取；做题后自动回传进度）· 与小程序打通后默认开，未打通需手动开</span>
            </label>
          </div>
          <div class="cloud-actions">
            <button class="data-btn" :disabled="!cloudEnvId.trim() || cloudSyncing" @click="saveCloudConfig">{{ cloudSyncing ? '☁️ 同步中...' : '☁️ 连接并同步' }}</button>
            <!-- 2026-09-24（rabbit）：一个「同步」说不清方向 → 拆成上传/下载/双向三件，与小程序端对齐。
                 上传＝只推（本地 → 云端）；下载＝只拉（云端 → 本地，按 updated_at 合并，不覆盖本地）；
                 双向＝先推后拉（老行为）。各自结果单独报，别让用户猜刚才发生了什么。 -->
            <button class="data-btn" :disabled="!cloudSaved || cloudSyncing" @click="doUpload">{{ syncAction === 'up' ? '⬆️ 上传中...' : '⬆️ 上传（本地 → 云端）' }}</button>
            <!-- 2026-09-27：强制重新上传。旧版 pushDoc 会把"推送失败"也标成已同步 ⇒ 那些行永远不再推
                 （rabbit 实测：点了一下午「上传」始终"推送 0 条"）。此入口先清本地同步标记、再全量推。 -->
            <button class="data-btn" :disabled="!cloudSaved || cloudSyncing" @click="doForceResync">🔄 强制重新上传</button>
            <button class="data-btn" :disabled="!cloudSaved || cloudSyncing" @click="doDownload">{{ syncAction === 'down' ? '⬇️ 下载中...' : '⬇️ 下载（云端 → 本地）' }}</button>
            <!-- 2026-09-28：本机进度出问题时的兜底（清本机进度键 → 以云端为准重算换算） -->
            <button class="data-btn" :disabled="!cloudSaved || cloudSyncing" @click="doRestoreFromCloud">🛟 以云端为准恢复进度</button>
            <button class="data-btn" :disabled="!cloudSaved || cloudSyncing" @click="doSync">{{ syncAction === 'both' ? '🔁 同步中...' : '🔁 双向同步' }}</button>
          </div>
          <p class="hint cloud-tip">① 名字只是<b>网名</b>：随便改、可重名，<b>别填真实姓名等个人信息</b>；找回数据靠上方的<b>找回码</b>。② <b>上传</b>＝本机 → 云端；<b>下载</b>＝云端 → 本机（按修改时间合并，不覆盖本机较新的数据）；拿不准就点<b>双向同步</b>。③ 本机<b>删掉</b>的题库/题目，上传时云端也会删掉；之后下载不会再把它拉回来。④ 换设备 / 清了浏览器数据：在新的设备上填<b>找回码</b>即可回到同一身份（含与小程序打通的状态）。</p>
          <p v-if="syncNicknameMsg" class="hint warn">{{ syncNicknameMsg }}</p>
          <p v-if="cloudStatusText" class="hint" :class="{ warn: cloudError }">{{ cloudStatusText }}</p>

          <!-- 跨设备找回 / 与小程序打通（2026-10-04：同一输入框吃 8 位找回码与小程序 6/16 位码） -->
          <div class="bind-box">
            <div class="bind-title">🔗 跨设备找回 · 与小程序打通{{ bound ? '（已绑定）' : '' }}</div>
            <p class="hint">
              <b>找回</b>：换设备 / 清了数据时，填你的 <b>8 位找回码</b>，数据与「已打通」状态一起回来。
              <b>打通</b>：在小程序「我的 → 与网页版打通」生成 <b>6 位临时码</b>（10 分钟内有效）或 <b>16 位长期身份码</b>，
              填在这里两端即共用同一账号，错题与进度自动互通。
            </p>
            <div v-if="!bound" class="bind-row">
              <input v-model="bindCodeInput" class="bind-input" placeholder="找回码 8 位 / 绑定码 6 或 16 位" maxlength="16" @input="bindCodeInput = bindCodeInput.toUpperCase()" />
              <button class="data-btn" :disabled="binding || !canSubmitCode" @click="doBind">
                {{ binding ? '处理中...' : '找回 / 绑定' }}
              </button>
            </div>
            <div v-else class="bind-row">
              <span class="bind-ok">✅ 已与小程序共用账号</span>
              <button class="data-btn" @click="doUnbind">解除绑定</button>
            </div>
            <p v-if="bindMsg" class="hint" :class="{ warn: bindError }">{{ bindMsg }}</p>
          </div>
        </div>
      </div>
      <!-- 2026-08-16：移除「数据库位置/备份目录」占位行（桌面版 Tauri 遗留，网页版 IndexedDB 无文件系统概念），保留备份/恢复按钮 -->
      <div class="data-actions">
        <button class="data-btn" @click="backupDb">💾 立即备份</button>
        <button class="data-btn" :disabled="restoring" @click="triggerRestore">📥 导入恢复</button>
        <input ref="restoreInput" type="file" accept="application/json,.json" style="display:none" @change="onRestoreFile" />
      </div>
      <details class="backup-guide">
        <summary>📖 备份 / 恢复怎么用？（点开看）</summary>
        <ol>
          <li><b>备份</b>：点「💾 立即备份」→ 浏览器会下载一个 <code>小兔错题本备份_日期.json</code> 文件 → 把它保存到网盘 / 电脑 / 微信传输助手等安全位置（重要数据建议定期备份）</li>
          <li><b>恢复</b>：点「📥 导入恢复」→ 选择之前保存的 .json 备份 → 数据会<b>覆盖式</b>恢复（替换当前全部数据：题库、题目、进度、错题、收藏、设置）</li>
          <li><b>换设备迁移</b>：在新设备的浏览器打开小兔错题本 → 设置页点「导入恢复」选备份文件 → 题库、进度、错题、收藏等全部数据完整迁移（比云同步更全；出于安全，AI 密钥与自定义接口地址不写入备份、也不会被备份文件覆盖）</li>
          <!-- 2026-09-25（rabbit 开放给团队后要求）：本机存储提醒。网页版数据全在浏览器里，清缓存就没了。
               2026-10-04：口径随「名字/找回码」拆分更新——兜底靠云同步＋找回码（名字不再承担身份）。 -->
          <li>⚠️ <b>数据默认只在本机浏览器里</b>：清缓存、换浏览器、换电脑都会丢。开<b>云同步</b>并把<b>找回码</b>存好就稳了；也可以用这份备份文件兜底</li>
          <li>⚠️ 备份文件包含你的题库与学习数据，<b>不要发给别人</b>；恢复前建议先备份当前数据，避免被旧备份覆盖</li>
        </ol>
      </details>
      <p v-if="restoreStatus" class="hint" :class="{ warn: restoreError }">{{ restoreStatus }}</p>
    </section>

    <!-- 管理员面板（云函数 admin-api；2026-09-16 起不再依赖本机服务） -->
    <section class="admin-section">
      <h3>🛡 管理员面板</h3>
      <p class="hint">管理云端数据（删除公共考试 / 公共题库 / 个人数据）。走云函数 <code class="data-path">admin-api</code>：
        口令只用于向云端校验这一次请求，不在浏览器里保存；口令由站长管理，连续输错会被临时锁定。
      </p>
      <div class="admin-row">
        <label>管理员口令
          <input v-model="adminPassword" type="password" class="dir-input" placeholder="输入管理员口令（仅保存在内存）" @keyup.enter="adminConnect" />
        </label>
      </div>
      <div class="data-actions">
        <button class="data-btn primary" :disabled="adminConnecting || !adminPassword" @click="adminConnect">
          {{ adminConnecting ? '连接中...' : '🔑 连接并加载考试' }}
        </button>
        <button class="data-btn" :disabled="!adminConnected || adminBusy" @click="adminLoadBanks">📚 加载题库</button>
        <button class="data-btn" :disabled="!adminConnected || adminBusy" @click="adminLoadFeedback">📨 加载意见反馈</button>
      </div>
      <p v-if="adminStatusText" class="hint" :class="{ warn: adminStatusError }">{{ adminStatusText }}</p>

      <template v-if="adminConnected">
        <div class="admin-list">
          <h4>考试列表（{{ adminExams?.length || 0 }}）</h4>
          <div v-if="adminExams && adminExams.length" class="admin-item">
            <div v-for="e in adminExams" :key="e._id" class="admin-item-row">
              <div class="admin-item-info">
                <div class="admin-item-title">{{ e.title }}</div>
                <div class="admin-item-meta">
                  <span class="tag" :class="e.visibility === 'public' ? 'tag-pub' : 'tag-pri'">{{ e.visibility === 'public' ? '公共' : '私有' }}</span>
                  <span>{{ e.question_count }} 题</span>
                  <span v-if="e.creator_name">· {{ e.creator_name }}</span>
                </div>
              </div>
              <!-- 2026-09-27：管理员归档（可归档/取消归档任意考试，含别人建的公共考试）-->
              <button class="data-btn" :disabled="adminBusy" @click="adminArchiveExam(e)">
                {{ e.archived ? '取消归档' : '归档' }}
              </button>
              <button class="data-btn danger" :disabled="adminBusy" @click="adminDeleteExam(e)">删除</button>
            </div>
          </div>
          <p v-else class="hint">暂无考试</p>
        </div>

        <div class="admin-list">
          <h4>题库列表（{{ adminBanks?.length || 0 }}）</h4>
          <div v-if="adminBanks && adminBanks.length" class="admin-item">
            <div v-for="b in adminBanks" :key="b._id" class="admin-item-row">
              <div class="admin-item-info">
                <div class="admin-item-title">{{ b.name }}</div>
                <div class="admin-item-meta">
                  <span class="tag" :class="b.visibility === 'public' ? 'tag-pub' : 'tag-pri'">{{ b.visibility === 'public' ? '公共' : '私有' }}</span>
                  <span>{{ b.question_count }} 题</span>
                </div>
              </div>
              <button class="data-btn danger" :disabled="adminBusy" @click="adminDeleteBank(b)">删除</button>
            </div>
          </div>
          <p v-else class="hint">点「📚 加载题库」查看公共题库</p>
        </div>

        <!-- 2026-09-25：意见反馈。写入端是公开云函数 feedback（网页/小程序提交都进这里），
             本面板只负责看与删。id_source='claim' 表示「身份是客户端自报的、不可信」——
             用来判断同一台设备的连续反馈，不当作可靠身份。 -->
        <div class="admin-list">
          <h4>意见反馈（{{ adminFeedback?.length || 0 }}）</h4>
          <div v-if="adminFeedback && adminFeedback.length" class="admin-item">
            <div v-for="f in adminFeedback" :key="f._id" class="admin-item-row">
              <div class="admin-item-info">
                <div class="admin-item-title">{{ f.category_label || f.category }}：{{ f.title }}</div>
                <div class="admin-item-meta">
                  <span>{{ (f.created_at || '').replace('T', ' ').slice(0, 16) }}</span>
                  <span v-if="f.contact">· 联系方式：{{ f.contact }}</span>
                  <span v-if="f.version">· v{{ f.version }}</span>
                  <span v-if="f.id_source === 'claim'" title="身份由客户端自报，不可信">· 自报身份</span>
                  <span v-if="f.push_error" title="钉钉推送失败原因">· 推送未达</span>
                </div>
                <div class="admin-item-body">{{ f.body }}</div>
              </div>
              <button class="data-btn danger" :disabled="adminBusy" @click="adminDeleteFeedback(f)">删除</button>
            </div>
          </div>
          <p v-else class="hint">点「📨 加载意见反馈」查看（最多 100 条，新→旧）</p>
        </div>

        <div class="admin-danger">
          <h4>⚠ 危险操作（需二次确认）</h4>
          <div class="data-actions">
            <button class="data-btn danger" :disabled="adminBusy" @click="adminDeleteAllExams">🗑 删除全部公共考试</button>
            <button class="data-btn danger" :disabled="adminBusy" @click="adminDeleteAllBanks">🗑 删除全部公共题库</button>
            <button class="data-btn danger" :disabled="adminBusy" @click="adminClearPersonal">🧹 清理全部个人数据</button>
          </div>
        </div>
      </template>
    </section>

    <!-- 开源信息 -->
    <section class="oss-section">
      <h3>ℹ️ 关于本项目</h3>
      <div class="oss-card">
        <div class="oss-row">
          <span class="oss-label">原作者</span>
          <span class="oss-value">MYT6666</span>
        </div>
        <div class="oss-row">
          <span class="oss-label">原项目</span>
          <a class="oss-value link" href="https://github.com/MYT6666/shuati-bao" target="_blank" rel="noopener">
            github.com/MYT6666/shuati-bao ↗
          </a>
        </div>
        <div class="oss-row">
          <span class="oss-label">网页版源码</span>
          <a class="oss-value link" href="https://github.com/yuhaoxuan2016/shuati-pwa" target="_blank" rel="noopener">
            github.com/yuhaoxuan2016/shuati-pwa ↗
          </a>
        </div>
        <div class="oss-row">
          <span class="oss-label">开源协议</span>
          <span class="oss-value">MIT License</span>
        </div>
        <div class="oss-row">
          <span class="oss-label">修改人</span>
          <span class="oss-value">rabbit</span>
        </div>
        <div class="oss-row">
          <span class="oss-label">意见反馈</span>
          <!-- 2026-09-15（用户裁定）：此前 FeedbackDialog 全仓零引用、用户永远打不开，这个入口把它接上 -->
          <span class="oss-value link" @click="showFeedback = true">点此提交问题或建议 ↗</span>
        </div>
        <div class="oss-divider"></div>
        <div class="oss-ai-note">
          🤖 本网页版在原作者 MIT 开源项目基础上由 AI 辅助修改生成，
          新增功能包括：抽题考试、综合抽题、多人考试、限时开放、查询码回看错题等。
        </div>
      </div>
    </section>

    <!-- 免责声明（2026-09-07） -->
    <section class="disclaimer-section">
      <h3>📜 免责声明</h3>
      <div class="disclaimer-card">
        <p>1. 本网站为个人自用的非经营性学习工具，不提供任何商业服务，不以任何形式收取费用。</p>
        <p>2. 站内题目为个人学习整理，仅供学习交流参考，不构成任何考试或职业资格认证的权威依据。</p>
        <p>3. <b>本网站不向公众提供生成式人工智能服务</b>：站内可选的「AI 解析」功能需用户自行配置个人第三方大模型 API 密钥方可使用，网站本身不内置任何 AI 服务，不直接向公众提供 AI 生成内容。</p>
        <p>4. AI 解析内容由第三方大模型生成，仅供参考，请以官方教材和标准答案为准。</p>
        <p>5. 用户自行导入的题库及相关内容由用户本人负责，请在遵守版权法规的前提下使用学习资料；如涉及版权问题请联系站长处理。</p>
      </div>
    </section>

    <!-- 2026-09-15（用户裁定）：意见反馈弹窗。可见性由「关于本项目」卡片里的入口控制 -->
    <FeedbackDialog :visible="showFeedback" @close="showFeedback = false" />

    <!-- 重看新手引导（2026-09-28）：key 递增强制重挂，保证连点也能重新显示 -->
    <OnboardingTour v-if="showTourAgain" :key="tourSeq" />
  </div>
</template>

<script setup lang="ts">
// P2-4 的 refreshBoundState 与 cloud.ts 的其余调用一样走**动态 import**（保持 SDK 不进主包），
// 故此处不静态导入它——静态导入会多出一条 TS6133「已声明未使用」，也会把 cloud.ts 静态拉进本视图 chunk。
import { redeemBindCode, unbindMiniProgram, isBoundToMiniProgram, ensureRecoverCode, getRecoverCode, isValidRecoverCodeInput, needsRecoverCodePrompt, markRecoverCodePrompted, pushNicknameSetting, recoverByIdentityCode, rotateRecoverCode } from '../lib/cloud'
// 2026-09-15（用户裁定「挂上入口」）：意见反馈弹窗自 Initial commit 起就在仓库里却**没有任何调用点**
// （全仓 grep 零引用），用户永远打不开它；P2-19 已把它的「附加最近 100 行运行日志」修成真的。
// 现在从设置页「关于本项目」卡片挂一个入口进来。日志缓冲由该组件首次打开时自行安装（复审 MF-1）。
import FeedbackDialog from '../components/FeedbackDialog.vue'
import OnboardingTour from '../components/OnboardingTour.vue'
import { isTrustedAiHost } from '../lib/ai'
import { computed, ref, onMounted } from 'vue'
import { api } from '../utils/api'
import { toastSuccess, toastError, toast } from '../utils/toast'
import { updateAppearanceCache } from '../lib/theme'
import { formatSyncDetail, type SyncDetail } from '../lib/sync-format'
import { CHANGELOG, RECENT_COUNT } from '../lib/changelog'

// 真实版本：构建时由 vite 的 define 注入（读 package.json，见 vite.config.ts）。
// 此前这里是写死的 '1.2.48-web'（桌面版时代的遗留），线上跑 1.2.53 也照样显示 1.2.48 ——
// 拿它判断「我跑的是哪版」必然误判（2026-09-25 rabbit 就被它带偏过一次）。
const currentVersion = ref(typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev')
const checkingUpdate = ref(false)
const showUpdateLog = ref(false)
// 更新日志默认只渲染前 RECENT_COUNT 条（惰性展开），展开后渲染全部（2026-10-05）。
const logExpanded = ref(false)
const visibleChangelog = computed(() => (logExpanded.value ? CHANGELOG : CHANGELOG.slice(0, RECENT_COUNT)))
const hiddenChangelogCount = computed(() => Math.max(0, CHANGELOG.length - RECENT_COUNT))
// 意见反馈弹窗的开关（2026-09-15 用户裁定新增入口）
const showFeedback = ref(false)
// 重看新手引导（2026-09-28）：key 递增让连点也能重新弹出
const showTourAgain = ref(false)
const tourSeq = ref(0)
function replayTour () { showTourAgain.value = true; tourSeq.value += 1 }

const apiKey = ref('')
const baseUrl = ref('https://api.deepseek.com/v1')
const model = ref('deepseek-v4-flash')
const testing = ref(false)
const testResult = ref<{ ok: boolean; msg: string } | null>(null)
const theme = ref('system')
const fontSize = ref('medium')
const themeColor = ref('green')

const themeColorList = [
  { id: 'green',  name: '翠绿', bg: '#42b883', fg: '#fff' },
  { id: 'blue',   name: '晴蓝', bg: '#3b82f6', fg: '#fff' },
  { id: 'purple', name: '紫罗兰', bg: '#7c3aed', fg: '#fff' },
  { id: 'pink',   name: '樱花粉', bg: '#ec4899', fg: '#fff' },
  { id: 'orange', name: '暖橙', bg: '#f59e0b', fg: '#fff' },
  { id: 'teal',   name: '湖青', bg: '#14b8a6', fg: '#fff' },
  { id: 'tech',   name: '科技蓝', bg: '#6366f1', fg: '#fff' },
  { id: 'forest', name: '森林', bg: '#16a34a', fg: '#fff' },
  { id: 'space',  name: '太空', bg: '#8b5cf6', fg: '#fff' },
  { id: 'cloud',  name: '云朵', bg: '#38bdf8', fg: '#fff' },
]
const dbInfo = ref<{ path: string; size_bytes: number; backups_dir: string; backup_count: number } | null>(null)

// 云同步
// 默认环境 ID 直接预填显示，保存后存在 localStorage 回显
// 来源：构建时由 .env 的 VITE_DEFAULT_CLOUD_ENV_ID 注入（不进 git 仓库）
const DEFAULT_CLOUD_ENV_ID = (import.meta.env.VITE_DEFAULT_CLOUD_ENV_ID as string) || ''
const cloudEnabled = ref(false)
const cloudEnvId = ref(DEFAULT_CLOUD_ENV_ID)
const cloudSaved = ref(false)
const cloudSyncing = ref(false)
const cloudError = ref(false)
const cloudStatusText = ref('')
const autoSync = ref(true)
const syncNickname = ref('')
const wrongAutoMaster = ref('3')

// 错题自动掌握阈值（0=关闭；默认 3 = 连续答对 3 次）
async function saveWrongAutoMaster() {
  try {
    await api.setSetting('wrong_auto_master_threshold', wrongAutoMaster.value)
    toastSuccess(wrongAutoMaster.value === '0' ? '已关闭错题自动掌握' : `已设为连续答对 ${wrongAutoMaster.value} 次自动掌握`)
  } catch { /* ignore */ }
}

// 与小程序打通（自定义登录）：绑定后网页版与小程序共用同一 uid
// P2-4（T10b）：首帧仍用 localStorage 缓存（同步可读），onMounted 再用真实登录态校正一次。
const bound = ref(isBoundToMiniProgram())
const bindCodeInput = ref('')
const binding = ref(false)
const bindMsg = ref('')
const bindError = ref(false)

async function doBind() {
  const raw = bindCodeInput.value.trim().toUpperCase()
  // 2026-10-04：同一个输入框吃两类——8 位（可带「兔子_」前缀）＝找回码；6 / 16 位＝小程序绑定码。
  const isRecover = isValidRecoverCodeInput(raw)
  if (!isRecover && raw.length !== 6 && raw.length !== 16) {
    bindError.value = true
    bindMsg.value = '填 8 位找回码，或小程序生成的 6 / 16 位绑定码'
    return
  }
  if (isRecover) {
    if (!confirm('将切换到该找回码对应的账号，并把云端数据拉回本机（本机现有数据会合并保留）。继续？')) return
  }
  binding.value = true
  bindMsg.value = ''
  bindError.value = false
  try {
    if (isRecover) {
      const r = await recoverByIdentityCode(raw)
      if (r.ok) {
        bindCodeInput.value = ''
        bindMsg.value = '找回成功！正在刷新并自动拉取数据…'
        toastSuccess('已找回账号')
        setTimeout(() => location.reload(), 900)
      } else {
        bindError.value = true
        bindMsg.value = r.msg || '找回失败'
        toastError(r.msg || '找回失败')
      }
      return
    }
    const r = await redeemBindCode(raw)
    if (r.ok) {
      bound.value = true
      bindCodeInput.value = ''
      bindError.value = false
      // 2026-09-27：绑定后必须提示「刷新页面」—— redeemBindCode 内部虽已把 authedUid 换成新身份，
      // 但页面里其它已加载的模块（云同步状态、IndexedDB 命名空间等）仍挂在旧 uid 上 ⇒ 不刷新时
      // 点「同步数据」会按旧身份查空（rabbit 实测：绑定成功但下载拉取 0 条、两端不互通）。
      bindMsg.value = '绑定成功！请刷新一次页面让新身份生效，然后点「同步数据」拉取小程序端的错题与进度'
      toastSuccess('已与小程序共用账号')
    } else {
      bindError.value = true
      bindMsg.value = r.msg || '绑定失败'
      toastError(r.msg || '绑定失败')
    }
  } catch (e: any) {
    bindError.value = true
    bindMsg.value = '失败：' + (e?.message || String(e))
  } finally {
    binding.value = false
  }
}

async function doUnbind() {
  if (!confirm('解除绑定后将回到匿名身份，本机看不到小程序端数据（云端数据不会删除，可重新绑定找回）。确定解除？')) return
  const ok = await unbindMiniProgram()
  if (ok) {
    bound.value = false
    bindMsg.value = '已解除绑定，刷新页面后使用匿名身份'
    bindError.value = false
    toastSuccess('已解除绑定')
    // 2026-10-04：解绑后当前是新的匿名身份，为它领一枚新找回码（旧码仍指向小程序身份，留着「回去」的路）
    void refreshRecoverCode(true, true)
  } else {
    toastError('解除失败')
  }
}

// 名字（网名）：2026-10-04 与找回码拆分后只做底线校验（非空/长度/字符集），可重名。
const syncNicknameMsg = ref('')
function saveSyncNickname() {
  try {
    import('../lib/cloud').then(m => {
      const r = m.setSyncKey(syncNickname.value.trim())
      syncNickname.value = r.key  // 校验失败时回显当前实际生效的名字（未被改动）
      syncNicknameMsg.value = r.ok ? '' : (r.msg || '名字无效')
      if (r.ok) {
        toastSuccess('名字已保存')
        void pushNicknameSetting()   // 顺手推给云端（best-effort，失败静默）
      } else {
        toastError(r.msg || '名字无效')
      }
    })
  } catch { /* ignore */ }
}

// ===== 2026-10-04：找回码 =====
// 有云配置时自动登记（老用户「兔子_XXXXXXXX」的尾段由服务端自动转正）；码存本机，可复制/下载。
// 码丢了找不回——所以「首次拿到码」弹一次保存提示（不做永久关闭；提示本身只出一次）。
const recoverCode = ref(getRecoverCode())
const recoverCodeHint = ref('连接云同步后自动生成')
const showCodePrompt = ref(false)
async function refreshRecoverCode(announce = false, force = false) {
  try {
    const r = await ensureRecoverCode(force)
    if (r.ok && r.code) {
      recoverCode.value = r.code
      recoverCodeHint.value = ''
      if (needsRecoverCodePrompt()) { showCodePrompt.value = true; markRecoverCodePrompted() }
      if (announce && r.state === 'issued') toastSuccess('已生成你的找回码')
      if (announce && r.state === 'adopted') toastSuccess('已把旧名字里的尾段转正为找回码')
    } else if (r.ok && r.state === 'existing') {
      recoverCode.value = ''
      recoverCodeHint.value = '本机未存码：请用你此前保存过的那枚码在新设备找回'
    } else if (announce && r.msg) {
      toastError('找回码登记失败：' + r.msg)
    }
  } catch { /* 静默：不阻断设置页 */ }
}
async function copyRecoverCode() {
  if (!recoverCode.value) return
  try {
    await navigator.clipboard.writeText(recoverCode.value)
    toastSuccess('已复制找回码')
  } catch {
    toastError('复制失败，请手动选择复制')
  }
}
/** 换码：确认 → 服务端吊销全部旧码并重发；成功后刷显示并弹一次「请存好」提示。
 *  文案只需说清「旧码作废」；「已发登录会话不吊销」是安全边界，写进 confirm 的第二句。 */
async function doRotateRecoverCode() {
  const okGo = window.confirm('换码后，旧码立即作废（不能再凭它登录/找回）；已经登录着的设备不受影响。\n换完记得立刻「下载」或「复制」新码存好——码丢了找不回。\n\n确定换码？')
  if (!okGo) return
  const r = await rotateRecoverCode()
  if (!r.ok || !r.code) {
    toastError('换码失败：' + (r.msg || '未知错误'))
    return
  }
  recoverCode.value = r.code
  recoverCodeHint.value = ''
  showCodePrompt.value = true
  toastSuccess('已换码，旧码已失效')
}
function downloadRecoverCode() {
  if (!recoverCode.value) return
  const who = (syncNickname.value || '兔子').replace(/[\\/:*?"<>|\s]/g, '')
  const text = `小兔错题本 · 我的找回码\n\n名字：${syncNickname.value}\n找回码：${recoverCode.value}\n\n用途：换设备或清除了浏览器数据后，在新的设备上填这枚码即可找回全部数据（题库、进度、错题、收藏，含与小程序打通的状态）。\n请妥善保存、不要发给他人；码丢了无法找回。\n导出日期：${new Date().toISOString().slice(0, 10)}\n`
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `小兔错题本找回码_${who}.txt`
  a.click()
  URL.revokeObjectURL(a.href)
}
const canSubmitCode = computed(() => {
  const raw = bindCodeInput.value.trim().toUpperCase()
  return isValidRecoverCodeInput(raw) || raw.length === 6 || raw.length === 16
})

function formatSize(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(2)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
}

onMounted(async () => {
  try {
    apiKey.value = (await api.getSetting('ai_api_key')) || ''
    baseUrl.value = (await api.getSetting('ai_base_url')) || baseUrl.value
    model.value = (await api.getSetting('ai_model')) || model.value
    // 读取主题/字号设置
    theme.value = (await api.getSetting('ui_theme')) || 'system'
    fontSize.value = (await api.getSetting('ui_font_size')) || 'medium'
    themeColor.value = (await api.getSetting('ui_theme_color')) || 'green'
    wrongAutoMaster.value = (await api.getSetting('wrong_auto_master_threshold')) || '3'
    applyTheme()
    applyFontSize()
    // 读取真实数据库信息（不再依赖 db_path 设置项）
    try {
      dbInfo.value = await api.getDbInfo()
    } catch (e) {
    console.error('获取数据库信息失败：', e)
    }
    // 读取应用版本（构建时注入的真值；此处不再覆盖，避免又退回写死）
    currentVersion.value = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
    // 读取云同步配置
    loadCloudConfig()
    // 读取名字（网名）
    try {
      const m = await import('../lib/cloud')
      syncNickname.value = m.getSyncKey()
    } catch { /* ignore */ }
    // 2026-10-04：有云配置则自动登记找回码（老用户尾段自动转正；失败静默、不阻断设置页）
    try {
      const cfgRaw = localStorage.getItem('cloudbase_config')
      const cfg = cfgRaw ? JSON.parse(cfgRaw) : null
      if (cfg && cfg.enabled && cfg.envId) void refreshRecoverCode(false)
    } catch { /* ignore */ }
    // P2-4（T10b）：用真实登录态校正「与小程序打通」的绑定显示——
    // 只读 localStorage 标记时，换浏览器（标记没了）或会话已换回匿名（标记还在）都会显示错。
    // 返回 null = 无法判定（未连云端/拿不到会话）→ 保持缓存显示，不误报。
    try {
      const mod = await import('../lib/cloud')
      const real = await mod.refreshBoundState()
      if (real !== null) {
        if (bound.value !== real) {
          bindMsg.value = real
            ? '已检测到与小程序共用的账号身份'
            : '未检测到小程序绑定身份（本地标记已失效，可重新绑定）'
          bindError.value = !real
        }
        bound.value = real
      }
    } catch { /* ignore */ }
  } catch (e) {
    toastError('加载设置失败：' + (e instanceof Error ? e.message : String(e)))
  }
})

// 2026-10-03：自动同步开关（默认开）——本机行为；关掉后打开页面不再自动拉、答题后不再自动推
async function onAutoSyncToggle() {
  try {
    const mod = await import('../lib/cloud')
    await mod.setAutoSyncEnabled(autoSync.value)
    toastSuccess(autoSync.value ? '已开启自动同步' : '已关闭自动同步')
  } catch (e) {
    toastError('设置失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

// === 云同步逻辑 ===
async function loadCloudConfig() {
  try {
    const mod = await import('../lib/cloud')
    autoSync.value = await mod.getAutoSyncEnabled()
    const cfgRaw = localStorage.getItem('cloudbase_config')
    if (cfgRaw) {
      const cfg = JSON.parse(cfgRaw)
      cloudEnabled.value = !!cfg.enabled
      cloudEnvId.value = cfg.envId || DEFAULT_CLOUD_ENV_ID
      cloudSaved.value = !!cfg.envId && !!cfg.enabled
    }
    const st = mod.getCloudStatus()
    cloudStatusText.value = st.authed
      ? `已连接云端，最近同步：${st.lastSyncAt ? new Date(st.lastSyncAt).toLocaleString() : '未同步'}`
      : st.error || (st.enabled ? '待同步' : '')
    cloudError.value = !!st.error
  } catch (e) { /* ignore */ }
}

async function onCloudToggle() {
  if (!cloudEnabled.value) {
    try {
      const mod = await import('../lib/cloud')
      mod.setCloudConfig(cloudEnvId.value || '', false)
      cloudSaved.value = false
      cloudStatusText.value = '已关闭云同步'
      cloudError.value = false
      toastSuccess('云同步已关闭')
    } catch (e) { toastError('关闭失败：' + (e instanceof Error ? e.message : String(e))) }
    return
  }
  // 开启：要求有 envId
  if (!cloudEnvId.value.trim()) {
    toastError('请先填写环境 ID（envId）')
    cloudEnabled.value = false
    return
  }
  await saveCloudConfig()
}

async function saveCloudConfig() {
  cloudSyncing.value = true
  try {
    const mod = await import('../lib/cloud')
    mod.setCloudConfig(cloudEnvId.value.trim(), true)
    cloudSaved.value = true
    // 保存后立即同步
    const res = await mod.syncAll()
    const st = mod.getCloudStatus()
    // P1-19（T10b）：拉取命中分页上限时如实标注，别让用户以为「全部数据都下来了」
    const truncTip = res.truncated ? ' · ⚠️ 有集合超出单次同步上限，本次未同步完整' : ''
    // 2026-09-18 修复（重审 A-03）：把「客户端无权写的公共内容」如实报出来。
    //   原先这些条目被计进「推送 N 条」里，用户以为改动已上云，其实永远不会——本地改动只在本机生效。
    const skipTip = res.skipped ? ` · 跳过 ${res.skipped} 条（公共内容客户端无权改，仅本地生效）` : ''
    const ledgerTip = suppressedTip(res.suppressed)
    // #36（2026-09-15 复审 MUST-FIX 3）：全域只有两个 syncAll 调用点，另一个是 doSync（已按 st.error 分流）。
    // 这里原先只看 `st.authed` ⇒ 云端**部分失败**（st.error 非空）时状态行仍显示绿色「✓ 已连接云端」，
    // 与 doSync 的诚实口径不一致。现改为同口径；「配置已保存」仍如实告知（那件事确实成功了），
    // 但同步没完成时另给一条失败提示，不让绿字掩盖问题。
    if (st.authed && !st.error) {
      cloudStatusText.value = `✓ 已连接云端 · 推送 ${res.pushed} 条 · 拉取 ${res.pulled} 条${truncTip}${skipTip}${ledgerTip}`
      toastSuccess('云同步配置已保存')
      void refreshRecoverCode(true)   // 2026-10-04：连接成功顺手登记找回码，首次拿到会弹保存提示
    } else {
      cloudStatusText.value = st.error || '未连接云端'
      toastSuccess('云同步配置已保存')
      toastError('但同步未完成：' + (st.error || '云端未授权'))
    }
  } catch (e) {
    cloudError.value = true
    cloudStatusText.value = '配置失败：' + (e instanceof Error ? e.message : String(e))
    toastError('云同步配置失败')
  } finally {
    cloudSyncing.value = false
  }
}

// ===== 三个同步动作（2026-09-24）=====
// 原先是单个「🔄 同步数据」（= 先推后拉），用户看不出方向：「我点的是上传还是下载？」
// 现在拆成 上传 / 下载 / 双向 三件。**共用同一套结果文案**，口径与失败分流跟老 doSync 一致。
const syncAction = ref<'' | 'up' | 'down' | 'both'>('')

// 「本机删过、这次没下载」的提示。不是错误、也不该藏着：用户删过的东西不再回来是**预期**，
// 但得让他知道「确实跳过了 N 条」，而不是以为数据丢了。
function suppressedTip (n?: number): string {
  return n ? ` · 已跳过 ${n} 条（本机删过的，不再下载回来）` : ''
}

function truncTipOf (truncated: boolean, action: 'up' | 'down' | 'both'): string {
  if (!truncated) return ''
  const how = action === 'up' ? '' : '（可再点一次「下载」续拉）'
  return ` · ⚠️ 有集合超出单次同步上限，本次未同步完整${how}`
}

function skipTipOf (skipped: number): string {
  return skipped ? ` · 跳过 ${skipped} 条（公共内容客户端无权改，仅本地生效）` : ''
}

// 每次动作结束都按「两侧真实结果」更新状态行与提示（未授权 / 推送部分失败 / 拉取截断 / 删除账本跳过）
function reportSyncResult (
  action: 'up' | 'down' | 'both',
  res: { pushed: number; pulled: number; failed: number; skipped: number; truncated: boolean; suppressed: number; cleaned?: number; pushDetail?: SyncDetail; pullDetail?: SyncDetail },
  st: { authed: boolean; error: string | null },
  okToast: string,
) {
  cloudError.value = !!st.error
  // 2026-09-28：加上「清理 N 条错位记录」（跨设备映射自愈的产出）与分类明细
  const cleanedTip = res.cleaned ? ` · 已清理 ${res.cleaned} 条错位记录` : ''
  const tips = truncTipOf(res.truncated, action) + skipTipOf(res.skipped) + suppressedTip(res.suppressed) + cleanedTip
  if (!st.authed || st.error) {
    cloudStatusText.value = st.error || '云端未授权'
    toastError('同步未完成：' + (st.error || '云端未授权'))
    return
  }
  if (action === 'up') cloudStatusText.value = `✓ 已上传 · ${formatSyncDetail(res.pushDetail)}${tips}`
  else if (action === 'down') cloudStatusText.value = `✓ 已下载 · ${formatSyncDetail(res.pullDetail)}${tips}`
  else cloudStatusText.value = `✓ 同步完成 · ⬆ ${formatSyncDetail(res.pushDetail)} · ⬇ ${formatSyncDetail(res.pullDetail)}${tips}`
  toastSuccess(okToast)
}

// 上传：只推（本地 → 云端）
// 2026-09-27：**强制重新上传** —— 先清掉本地所有同步标记（`synced_at`），再走一次上传。
// 为什么需要：旧版 `pushDoc` 无条件 return true ⇒ 推送失败也把行标成"已同步" ⇒ 那些行**永远不再推**
// （rabbit 实测：点了一下午「上传」始终"推送 0 条"）。修了 pushDoc 之后，仍需显式入口捞回旧标记。
async function doForceResync() {
  if (!cloudSaved.value) { toastError('请先保存配置'); return }
  if (syncAction.value) return
  syncAction.value = 'up'
  cloudSyncing.value = true
  try {
    const mod = await import('../lib/cloud')
    const { api } = await import('../utils/api')
    const n = await api.forceResync()
    toast('info', `已清 ${n} 条本地同步标记，正在重新上传…`)
    const res = await mod.pushToCloud()
    const st = mod.getCloudStatus()
    reportSyncResult('up', { ...res, pulled: 0, truncated: false, suppressed: 0, pushDetail: res.detail }, st, '强制重新上传完成')
  } catch (e) {
    cloudError.value = true
    cloudStatusText.value = '强制上传失败：' + (e instanceof Error ? e.message : String(e))
    toastError('强制上传失败')
  } finally {
    cloudSyncing.value = false
    syncAction.value = ''
  }
}

async function doUpload() {
  if (!cloudSaved.value) { toastError('请先保存配置'); return }
  if (syncAction.value) return
  syncAction.value = 'up'
  cloudSyncing.value = true
  try {
    const mod = await import('../lib/cloud')
    const res = await mod.pushToCloud()
    const st = mod.getCloudStatus()
    reportSyncResult('up', { ...res, pulled: 0, truncated: false, suppressed: 0, pushDetail: res.detail }, st, '上传完成')
  } catch (e) {
    cloudError.value = true
    cloudStatusText.value = '上传失败：' + (e instanceof Error ? e.message : String(e))
    toastError('上传失败')
  } finally {
    cloudSyncing.value = false
    syncAction.value = ''
  }
}

// 下载：只拉（云端 → 本地，按 updated_at 合并）
async function doDownload() {
  if (!cloudSaved.value) { toastError('请先保存配置'); return }
  if (syncAction.value) return
  syncAction.value = 'down'
  cloudSyncing.value = true
  try {
    const mod = await import('../lib/cloud')
    const res = await mod.syncFromCloud()
    const st = mod.getCloudStatus()
    reportSyncResult('down', { pushed: 0, failed: 0, skipped: 0, ...res, pullDetail: res.detail }, st, '下载完成')
  } catch (e) {
    cloudError.value = true
    cloudStatusText.value = '下载失败：' + (e instanceof Error ? e.message : String(e))
    toastError('下载失败')
  } finally {
    cloudSyncing.value = false
    syncAction.value = ''
  }
}

// 2026-09-28（rabbit 批准）：以云端为准恢复进度 —— 清掉本机所有题库进度键，再拉一次云端
// （下载侧会自动做「来源题号 → 本机题号」换算）。用于本机进度被异常状态顶掉时的兜底。
async function doRestoreFromCloud() {
  if (!cloudSaved.value) { toastError('请先保存配置'); return }
  if (syncAction.value) return
  syncAction.value = 'down'
  cloudSyncing.value = true
  try {
    const { idb } = await import('../lib/db')
    const all = await idb.getAllSettings()
    let n = 0
    for (const k of Object.keys(all)) {
      if (k.startsWith('practice_progress')) { await idb.setSetting(k, ''); n++ }   // idb 无删除 API：置空即失效
    }
    toast('info', n ? `已重置 ${n} 个本机进度，正在按云端恢复…` : '本机没有进度记录，直接拉取云端…')
    const mod = await import('../lib/cloud')
    const res = await mod.syncFromCloud()
    const st = mod.getCloudStatus()
    reportSyncResult('down', { pushed: 0, failed: 0, skipped: 0, ...res, pullDetail: res.detail }, st, '已按云端版本恢复进度')
  } catch (e) {
    cloudError.value = true
    cloudStatusText.value = '恢复失败：' + (e instanceof Error ? e.message : String(e))
    toastError('恢复失败')
  } finally {
    cloudSyncing.value = false
    syncAction.value = ''
  }
}

async function doSync() {
  if (!cloudSaved.value) {
    toastError('请先保存配置')
    return
  }
  if (syncAction.value) return
  syncAction.value = 'both'
  cloudSyncing.value = true
  try {
    const mod = await import('../lib/cloud')
    const res = await mod.syncAll()
    const st = mod.getCloudStatus()
    // 2026-09-15 修复(P2-21)：原实现只要 syncAll() 不抛就无条件 toastSuccess('同步完成')——
    // 用户会同时看到红色失败状态行和绿色「同步完成」toast，误以为数据已备份。按 st.error / st.authed 分流。
    // 2026-09-15 T10b 已闭环**推送侧**（#36，控制端从 T8a 复审转来）：原先 `pushToCloud` 写好
    //    `cloudState.error` 之后，`syncAll` 紧接着调 `syncFromCloud`，而后者首句是 `cloudState.error = null`
    //    ⇒ 回到本函数时推送侧的失败已被抹掉，「推送部分失败」仍会走到上面的成功分支。
    //    修法在 `cloud.ts` 的 `syncAll`：进入拉取前先记下推送侧 error，拉取结束后若没有新的 error 就放回去
    //    （等价于「不在拉取开头清掉推送侧 error」），并把 failed / truncated / error 一并返回。
    // ⇒ 现在**三支都诚实**：未授权、拉取侧失败、推送侧部分失败（及其条数）。
    // 另：P1-19 的 truncated 只在成功分支附加提示（截断不是失败，不该让状态行变红）。
    // 2026-09-24：这段分流与三条提示搬进了 `reportSyncResult`（上传/下载/双向共用一套口径，
    //   否则三个动作各写一份，迟早只有一处被修）。新增的 suppressed（删除账本跳过）也走那里。
    reportSyncResult('both', res, st, '同步完成')
  } catch (e) {
    cloudError.value = true
    cloudStatusText.value = '同步失败：' + (e instanceof Error ? e.message : String(e))
    toastError('同步失败')
  } finally {
    cloudSyncing.value = false
    syncAction.value = ''
  }
}

// 手动刷新（网页版没有独立的更新检查：页面本身就是最新版，刷新即生效）
function manualCheckUpdate() {
  checkingUpdate.value = true
  try {
    location.reload()
  } finally {
    checkingUpdate.value = false
  }
}

function applyTheme() {
  const html = document.documentElement
  if (theme.value === 'light') {
    html.setAttribute('data-theme', 'light')
  } else if (theme.value === 'dark') {
    html.setAttribute('data-theme', 'dark')
  } else {
    html.removeAttribute('data-theme')
  }
  // 主题色：始终挂属性，默认 green
  html.setAttribute('data-theme-color', themeColor.value || 'green')
  // 2026-09-07：同步外观缓存（App 启动时先读缓存即时恢复，避免依赖设置页挂载）
  updateAppearanceCache({ theme: theme.value, themeColor: themeColor.value || 'green' })
}

function applyFontSize() {
  document.documentElement.setAttribute('data-font-size', fontSize.value)
  updateAppearanceCache({ fontSize: fontSize.value || 'medium' })
}

async function saveTheme() {
  applyTheme()
  await api.setSetting('ui_theme', theme.value)
}

async function saveFontSize() {
  applyFontSize()
  await api.setSetting('ui_font_size', fontSize.value)
}

async function setThemeColor(id: string) {
  themeColor.value = id
  applyTheme()
  await api.setSetting('ui_theme_color', id)
  toastSuccess(`主题色已切换为「${themeColorList.find(c => c.id === id)?.name || id}」`)
}

// ===== 云朵彩蛋（2026-09-07）：hover 小字 / 单击抖动 / 连点 3 次触发「启动」 =====
const CLOUD_EGG_KEY = 'cloud_egg_triggered'
const cloudShakeSeq = ref(0)
const cloudLaunchSeq = ref(0)
const cloudTaps = ref(0)
let cloudTapTimer: ReturnType<typeof setTimeout> | null = null

async function onSwatchClick(c: { id: string; name: string }) {
  if (c.id !== 'cloud') { setThemeColor(c.id); return }
  // 抖动：key 序号 +1 → 按钮重挂载 → animation 重放
  cloudShakeSeq.value++

  // 连点计数（2.5 秒内 ≥3 次触发）
  cloudTaps.value++
  if (cloudTapTimer) clearTimeout(cloudTapTimer)
  cloudTapTimer = setTimeout(() => { cloudTaps.value = 0 }, 2500)
  if (cloudTaps.value >= 3) {
    cloudTaps.value = 0
    cloudLaunchSeq.value++
    localStorage.setItem(CLOUD_EGG_KEY, '1')
    toastSuccess('☁️ 云·小兔错题本，启动！')
    setTimeout(() => { toastSuccess('云·小兔错题本 已经准备就绪，旅行者请开始今天的练习 ⭐') }, 1800)
    return
  }

  // 单击：切换到云朵主题（不走 setThemeColor，用彩蛋提示条替代默认 toast）
  if (themeColor.value !== 'cloud') {
    themeColor.value = 'cloud'
    applyTheme()
    await api.setSetting('ui_theme_color', 'cloud')
    setTimeout(() => toastSuccess('（欸，云朵？）'), 350)
  } else {
    toastSuccess('（欸，云朵？）')
  }
}

async function save(key: string, value: string) {
  try {
    if (key === 'ai_base_url') {
      const url = String(value || '').trim()
      const trusted = isTrustedAiHost(url)
      // P1-11：白名单外的自定义端点必须由用户在此显式确认。确认记录 ai_base_url_ack
      // 与 ai_base_url 分开存储，且不进备份/云同步 —— 只有本机这次点击能授权它。
      if (url && !trusted) {
        const ok = window.confirm(`该地址不在已知 AI 服务商白名单内：\n${url}\n\n继续保存表示你信任该端点接收你的 API Key（密钥会以 Bearer 头发往该地址）。`)
        if (!ok) {
          baseUrl.value = (await api.getSetting('ai_base_url')) || ''
          testResult.value = null
          return
        }
      }
      await api.setSetting('ai_base_url', url)
      await api.setSetting('ai_base_url_ack', trusted ? '' : url)
      testResult.value = null
      return
    }
    await api.setSetting(key, value)
    testResult.value = null
  } catch (e) {
    toastError('保存失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

async function pickModel(m: string, url: string) {
  model.value = m
  baseUrl.value = url
  await save('ai_model', m)
  await save('ai_base_url', url)
}

async function testConnection() {
  testing.value = true
  testResult.value = null
  try {
    await api.testAiConnection()
    testResult.value = { ok: true, msg: '' }
  } catch (e) {
    testResult.value = { ok: false, msg: e instanceof Error ? e.message : String(e) }
  } finally {
    testing.value = false
  }
}

async function backupDb() {
  try {
    const dst = await api.backupDatabase()
    toastSuccess('备份成功：' + dst)
  } catch (e) {
    toastError('备份失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

// === 导入恢复 ===
const restoreInput = ref<HTMLInputElement | null>(null)
const restoring = ref(false)
const restoreStatus = ref('')
const restoreError = ref(false)

function triggerRestore() {
  restoreInput.value?.click()
}

async function onRestoreFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  restoring.value = true
  restoreStatus.value = '正在读取备份文件...'
  restoreError.value = false
  try {
    const text = await file.text()
    const data = JSON.parse(text)
    if (!confirm('导入恢复将覆盖当前本地数据（题库 / 题目 / 错题 / 收藏 / 练习记录），设置项按备份内容补齐。确定继续？')) {
      restoreStatus.value = '已取消恢复'
      return
    }
    await api.restoreBackup(data, (msg) => { restoreStatus.value = msg })
    restoreStatus.value = '✅ 恢复成功，建议刷新页面以重载数据'
    try { dbInfo.value = await api.getDbInfo() } catch { /* 忽略 */ }
  } catch (err) {
    restoreError.value = true
    restoreStatus.value = '恢复失败：' + (err instanceof Error ? err.message : String(err))
  } finally {
    restoring.value = false
    input.value = '' // 允许重复选择同一文件
  }
}

// === 管理员面板（云函数 admin-api；T18-2c 2026-09-16：由本机服务改为云函数） ===
const adminPassword = ref('')
const adminConnecting = ref(false)
const adminConnected = ref(false)
const adminBusy = ref(false)
const adminStatusText = ref('')
const adminStatusError = ref(false)
const adminExams = ref<Array<Record<string, any>> | null>(null)
const adminBanks = ref<Array<Record<string, any>> | null>(null)
const adminFeedback = ref<Array<Record<string, any>> | null>(null)

interface AdminRes { ok: boolean; message?: string; code?: string; total?: number; exams?: any[]; banks?: any[]; items?: any[]; deleted?: number }

// 口令只存内存、随请求发给云函数；节流与锁定在函数端（P1-38：15 分钟内 5 次失败 → 锁 30 分钟）
// cloud.ts 按本文件既有约定走动态 import（保持 SDK 不进本视图 chunk）
async function adminCall(action: string, extra: Record<string, any> = {}): Promise<AdminRes> {
  const m = await import('../lib/cloud')
  return await m.callAdminApi(action, adminPassword.value, extra)
}

function adminSetStatus(msg: string, isError = false) {
  adminStatusText.value = msg
  adminStatusError.value = isError
}

async function adminConnect() {
  if (adminConnecting.value) return
  adminConnecting.value = true
  adminStatusText.value = '连接中...'
  adminStatusError.value = false
  try {
    const res = await adminCall('list-exams')
    if (!res.ok) {
      adminConnected.value = false
      adminExams.value = null
      // T18-2c：新增 LOCKED（P1-38 节流锁定）与 NO_CLOUD/CALL_FAILED（云函数未部署或权限未放通）两种分支
      if (res.code === 'BAD_PASSWORD') adminSetStatus('✗ 管理员口令错误', true)
      else if (res.code === 'LOCKED') adminSetStatus('✗ ' + (res.message || '尝试次数过多，已临时锁定'), true)
      else adminSetStatus('✗ ' + (res.message || '连接失败'), true)
      return
    }
    adminConnected.value = true
    adminExams.value = res.exams || []
    adminSetStatus(`✓ 已连接，云端共 ${res.total} 场考试`)
  } catch (e) {
    adminConnected.value = false
    adminSetStatus('✗ 无法调用管理云函数：' + (e instanceof Error ? e.message : String(e)), true)
  } finally {
    adminConnecting.value = false
  }
}

async function adminLoadBanks() {
  adminBusy.value = true
  try {
    const res = await adminCall('list-banks')
    if (!res.ok) { adminSetStatus('✗ ' + (res.message || '加载失败'), true); return }
    adminBanks.value = res.banks || []
    adminSetStatus(`✓ 已加载 ${res.total} 个题库`)
  } catch (e) {
    adminSetStatus('✗ 加载失败：' + (e instanceof Error ? e.message : String(e)), true)
  } finally {
    adminBusy.value = false
  }
}

// 2026-09-25：意见反馈的读/删（写入端是公开云函数 feedback）
async function adminLoadFeedback() {
  adminBusy.value = true
  try {
    const res = await adminCall('list-feedback', { limit: 100 })
    if (!res.ok) { adminSetStatus('✗ ' + (res.message || '加载失败'), true); return }
    adminFeedback.value = res.items || []
    adminSetStatus(`✓ 已加载 ${res.total} 条反馈`)
  } catch (e) {
    adminSetStatus('✗ 加载失败：' + (e instanceof Error ? e.message : String(e)), true)
  } finally {
    adminBusy.value = false
  }
}

async function adminDeleteFeedback(f: any) {
  if (!adminConfirm(`确定删除这条反馈？\n「${f.title}」`)) return
  adminBusy.value = true
  try {
    const res = await adminCall('delete-feedback', { id: f._id })
    if (!res.ok) { adminSetStatus('✗ ' + (res.message || '删除失败'), true); return }
    adminSetStatus('✓ ' + (res.message || '已删除'))
    await adminLoadFeedback()
  } catch (e) {
    adminSetStatus('✗ 删除失败：' + (e instanceof Error ? e.message : String(e)), true)
  } finally {
    adminBusy.value = false
  }
}

function adminConfirm(msg: string): boolean {
  return window.confirm(msg)
}

// 2026-09-27：管理员归档 / 取消归档任意考试（普通用户只能动自己的；这条走管理端）
async function adminArchiveExam(e: any) {
  const next = !e.archived
  const tip = next
    ? `归档「${e.title}」？${e.visibility !== 'private' ? '\n\n⚠️ 这是公共考试：归档后所有考生的列表里都会收起。' : ''}\n数据与成绩保留，可随时取消归档。`
    : `取消归档「${e.title}」？`
  if (!adminConfirm(tip)) return
  adminBusy.value = true
  try {
    const res = await adminCall('archive-exam', { examId: e._id, archived: next })
    if (!res.ok) { adminSetStatus('✗ ' + (res.message || '归档失败'), true); return }
    e.archived = next
    adminSetStatus(`✓ ${next ? '已归档' : '已取消归档'}`)
  } catch (e2) {
    adminSetStatus('✗ 归档失败：' + (e2 instanceof Error ? e2.message : String(e2)), true)
  } finally {
    adminBusy.value = false
  }
}

async function adminDeleteExam(e: any) {
  if (!adminConfirm(`确定删除考试「${e.title}」？\n将同时删除该考试的全部答卷记录，不可恢复！`)) return
  adminBusy.value = true
  try {
    const res = await adminCall('delete-exam', { examId: e._id })
    if (!res.ok) { adminSetStatus('✗ ' + (res.message || '删除失败'), true); return }
    adminExams.value = (adminExams.value || []).filter(x => x._id !== e._id)
    adminSetStatus(`✓ ${res.message}`)
  } catch (e2) {
    adminSetStatus('✗ 删除失败：' + (e2 instanceof Error ? e2.message : String(e2)), true)
  } finally {
    adminBusy.value = false
  }
}

async function adminDeleteBank(b: any) {
  if (!adminConfirm(`确定删除题库「${b.name}」？\n将同时删除其中的 ${b.question_count} 道题目，不可恢复！`)) return
  adminBusy.value = true
  try {
    const res = await adminCall('delete-bank', { bankId: b._id })
    if (!res.ok) { adminSetStatus('✗ ' + (res.message || '删除失败'), true); return }
    adminBanks.value = (adminBanks.value || []).filter(x => x._id !== b._id)
    adminSetStatus(`✓ ${res.message}`)
  } catch (e2) {
    adminSetStatus('✗ 删除失败：' + (e2 instanceof Error ? e2.message : String(e2)), true)
  } finally {
    adminBusy.value = false
  }
}

async function adminDeleteAllExams() {
  if (!adminConfirm('⚠ 将删除云端【所有公共考试】及其答卷，此操作不可恢复！\n确认继续？')) return
  if (!adminConfirm('再次确认：真的要删除全部公共考试吗？')) return
  adminBusy.value = true
  try {
    const res = await adminCall('delete-all-exams', { visibility: 'public' })
    if (!res.ok) { adminSetStatus('✗ ' + (res.message || '删除失败'), true); return }
    adminExams.value = (adminExams.value || []).filter(x => x.visibility !== 'public')
    adminSetStatus(`✓ ${res.message}`)
  } catch (e2) {
    adminSetStatus('✗ 删除失败：' + (e2 instanceof Error ? e2.message : String(e2)), true)
  } finally {
    adminBusy.value = false
  }
}

async function adminDeleteAllBanks() {
  if (!adminConfirm('⚠ 将删除云端【所有公共题库】及其全部题目，此操作不可恢复！\n确认继续？')) return
  if (!adminConfirm('再次确认：真的要删除全部公共题库吗？')) return
  adminBusy.value = true
  try {
    const res = await adminCall('delete-all-banks')
    if (!res.ok) { adminSetStatus('✗ ' + (res.message || '删除失败'), true); return }
    adminBanks.value = []
    adminSetStatus(`✓ ${res.message}`)
  } catch (e2) {
    adminSetStatus('✗ 删除失败：' + (e2 instanceof Error ? e2.message : String(e2)), true)
  } finally {
    adminBusy.value = false
  }
}

async function adminClearPersonal() {
  if (!adminConfirm('⚠ 将删除云端所有用户的【私有题库】【私有考试】及其题目，此操作不可恢复！\n确认继续？')) return
  if (!adminConfirm('再次确认：真的要清理全部个人数据吗？')) return
  adminBusy.value = true
  try {
    const res = await adminCall('clear-personal')
    if (!res.ok) { adminSetStatus('✗ ' + (res.message || '清理失败'), true); return }
    adminSetStatus(`✓ ${res.message}`)
  } catch (e2) {
    adminSetStatus('✗ 清理失败：' + (e2 instanceof Error ? e2.message : String(e2)), true)
  } finally {
    adminBusy.value = false
  }
}
</script>

<style scoped>
section { background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-lg); padding: 16px; margin-bottom: 16px; }
label { display: block; margin: 8px 0; }
input, select { padding: 6px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); width: 320px; max-width: 100%; box-sizing: border-box; background: var(--color-card); color: var(--color-text); }
.hint { color: var(--color-text-tertiary); font-size: 13px; }
.test-row { margin-top: 12px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.test-btn { padding: 6px 18px; border: 1px solid var(--color-primary); border-radius: var(--radius-md); background: var(--color-primary); color: #fff; cursor: pointer; font-size: 14px; }
.test-btn:disabled { background: var(--color-text-tertiary); border-color: var(--color-text-tertiary); cursor: not-allowed; }
.test-result { font-size: 14px; }
.test-result.ok { color: var(--color-success); }
.test-result.fail { color: var(--color-danger); word-break: break-all; }
.model-tips { margin-top: 8px; }
.model-list { display: flex; flex-direction: column; gap: 6px; margin: 8px 0; }
.model-pick { text-align: left; padding: 8px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg); cursor: pointer; font-size: 13px; transition: border-color 0.2s; color: var(--color-text); }
.model-pick:hover { border-color: var(--color-primary); background: var(--color-primary-light); }
.tag { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; margin: 0 4px; }
.tag.fast { background: var(--color-success-light); color: var(--color-success); }
.warn { color: #e65100; font-size: 13px; margin-top: 4px; }
.key-links { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; }
.key-links a { color: var(--color-primary); font-size: 13px; text-decoration: none; }
.key-links a:hover { text-decoration: underline; }
.data-btn { padding: 6px 16px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); color: var(--color-text); cursor: pointer; transition: background 0.15s; }
.data-btn:hover { background: var(--color-border-light); }
.data-btn.primary { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
.data-btn.primary:hover { background: var(--color-primary-dark); }
.data-btn.primary:disabled { opacity: 0.5; cursor: not-allowed; }
.data-btn.danger { color: #e53935; border-color: #e53935; }
.data-btn.danger:hover { background: #e53935; color: #fff; }
.data-actions { display: flex; gap: 8px; margin: 8px 0; flex-wrap: wrap; }
/* 备份/恢复教程（2026-08-16） */
.backup-guide { margin: 4px 0 10px; font-size: 13px; color: var(--color-text-secondary); }
.backup-guide summary { cursor: pointer; font-weight: 600; color: var(--color-primary); margin-bottom: 6px; }
.backup-guide ol { margin: 0; padding-left: 20px; line-height: 1.8; }
.backup-guide code { background: var(--color-bg); padding: 1px 5px; border-radius: 4px; font-size: 12px; border: 1px solid var(--color-border-light); }
.data-label { color: var(--color-text-secondary); margin-right: 4px; }
.data-path { background: var(--color-bg); padding: 2px 6px; border-radius: 4px; font-family: ui-monospace, Consolas, monospace; font-size: 12px; color: var(--color-text); border: 1px solid var(--color-border-light); word-break: break-all; }
.data-size { color: var(--color-text-tertiary); margin-left: 6px; font-size: 12px; }
.dir-input { flex: 1; padding: 6px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); color: var(--color-text); font-size: 13px; }

/* 云同步 */
.cloud-box { margin-bottom: 14px; padding: 14px 16px; background: linear-gradient(135deg, #f5f3ff 0%, var(--tc-light) 100%); border: 1px solid var(--color-info-strong); border-radius: var(--radius-md); }
.cloud-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.cloud-title { display: flex; align-items: center; gap: 10px; }
.cloud-icon { font-size: 26px; }
.cloud-name { font-weight: 600; font-size: 14px; color: var(--color-primary-dark); }
.cloud-desc { font-size: 12px; color: var(--color-info-strong); margin-top: 2px; }
.switch { position: relative; display: inline-block; width: 44px; height: 24px; flex-shrink: 0; }
.switch input { opacity: 0; width: 0; height: 0; }
.slider { position: absolute; cursor: pointer; inset: 0; background: #cbd5e1; border-radius: 24px; transition: 0.3s; }
.slider:before { content: ""; position: absolute; height: 18px; width: 18px; left: 3px; bottom: 3px; background: #fff; border-radius: 50%; transition: 0.3s; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
.switch input:checked + .slider { background: var(--color-primary); }
.switch input:checked + .slider:before { transform: translateX(20px); }
.cloud-config { margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(199, 210, 254, 0.7); }
.cloud-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.cloud-row label { font-size: 13px; color: var(--color-text-secondary); white-space: nowrap; }
.cloud-row .dir-input { flex: 1; }
.cloud-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.bind-box { margin-top: 16px; padding: 14px; border: 1px dashed var(--color-border); border-radius: var(--radius-md); background: var(--color-bg); }
.bind-title { font-size: 14px; font-weight: 600; margin-bottom: 6px; color: var(--color-text); }
.bind-row { display: flex; gap: 8px; align-items: center; margin-top: 10px; }
.bind-input { flex: 0 0 140px; padding: 8px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-md); font-size: 18px; letter-spacing: 3px; text-align: center; font-family: monospace; background: var(--color-card); color: var(--color-text); }
.bind-ok { font-size: 14px; color: var(--color-success, #16a34a); font-weight: 500; }
.cloud-tip { margin-top: 8px; line-height: 1.6; color: var(--color-info-strong); }
/* 2026-10-04：找回码展示与首次保存提示（视觉对齐 bind-box 口径） */
.recover-code-box { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.recover-code { font-family: monospace; font-size: 18px; letter-spacing: 3px; font-weight: 700; padding: 6px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); color: var(--color-text); }
.data-btn.slim { padding: 6px 10px; font-size: 13px; }
.code-prompt { margin-top: 10px; padding: 12px 14px; border: 1px dashed var(--color-warning, #d48806); border-radius: var(--radius-md); background: var(--color-card); }
.code-prompt p { margin: 0 0 8px; font-size: 13px; line-height: 1.6; color: var(--color-text); }
.code-prompt-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.hint.warn { color: var(--color-danger); }
.hint.warn { color: var(--color-warning); }
.hint.success { color: var(--color-success); }

/* 更新日志 */
.update-log { background: var(--color-bg); border: 1px solid var(--color-border-light); border-radius: var(--radius-md); padding: 12px 16px; margin-top: 8px; max-height: 280px; overflow-y: auto; }
.update-log h4 { margin: 0 0 8px 0; font-size: 13px; color: var(--color-text-secondary); }
.log-entry { margin-bottom: 8px; }
.log-version { display: inline-block; padding: 2px 8px; background: var(--color-primary-light); color: var(--color-primary); border-radius: 4px; font-size: 12px; font-weight: 600; margin-bottom: 4px; }
.update-log ul { margin: 4px 0 0 0; padding-left: 20px; color: var(--color-text-secondary); font-size: 13px; line-height: 1.7; }
.log-more { display: block; width: 100%; margin-top: 4px; padding: 6px 0; background: none; border: none; border-top: 1px dashed var(--color-border-light); color: var(--color-primary); font-size: 12px; cursor: pointer; text-align: center; }
.log-more:hover { text-decoration: underline; }

/* 开源信息 */
.oss-section h3 { margin-top: 0; }
.oss-card {
  background: var(--color-bg);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  padding: 6px 16px;
  font-size: 14px;
}
.oss-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 0;
  border-bottom: 1px dashed var(--color-border-light);
}
.oss-row:last-of-type { border-bottom: none; }
.oss-label { font-size: 13px; color: var(--color-text-tertiary); flex-shrink: 0; }
.oss-value { font-weight: 600; color: var(--color-text); word-break: break-all; text-align: right; }
.oss-value.link { color: var(--color-primary); text-decoration: none; font-size: 13px; }
.oss-value.link:hover { text-decoration: underline; }
.oss-divider { height: 1px; background: var(--color-border-light); margin: 4px 0; }
.oss-ai-note {
  margin: 12px 0;
  padding: 12px 14px;
  background: linear-gradient(135deg, var(--tc-light) 0%, #faf5ff 100%);
  border: 1px solid var(--color-info-strong);
  border-radius: var(--radius-md);
  font-size: 13px;
  line-height: 1.7;
  color: var(--color-primary-dark);
}

/* 管理员面板 */
.admin-section { border: 1px solid #f4c7c7; }
.admin-row { margin: 8px 0; }
.admin-row label { display: flex; align-items: center; gap: 8px; }
.admin-row label input { flex: 1; }
.admin-list { margin-top: 12px; background: var(--color-bg); border: 1px solid var(--color-border-light); border-radius: var(--radius-md); padding: 10px 12px; }
.admin-list h4 { margin: 0 0 8px 0; font-size: 13px; color: var(--color-text-secondary); }
.admin-item { display: flex; flex-direction: column; gap: 6px; }
.admin-item-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 0; border-bottom: 1px dashed var(--color-border-light); }
.admin-item-row:last-child { border-bottom: none; }
.admin-item-info { min-width: 0; }
.admin-item-title { font-size: 13px; font-weight: 600; color: var(--color-text); word-break: break-all; }
.admin-item-meta { font-size: 12px; color: var(--color-text-tertiary); margin-top: 2px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.tag-pub { background: var(--color-success-light); color: var(--color-success); }
.tag-pri { background: var(--color-border-light); color: var(--color-text-secondary); }
.admin-danger { margin-top: 12px; padding: 10px 12px; border: 1px dashed #e53935; border-radius: var(--radius-md); }
.admin-danger h4 { margin: 0 0 8px 0; font-size: 13px; color: #e53935; }

/* 移动端适配 */
@media (max-width: 768px) {
  section { padding: 12px; }
  .cloud-header { flex-direction: column; align-items: flex-start; }
  .cloud-row { flex-direction: column; align-items: stretch; }
  .cloud-row .dir-input { width: 100%; box-sizing: border-box; }
  .cloud-actions { flex-wrap: wrap; }
  .cloud-actions .data-btn { flex: 1; }
  .oss-row { flex-direction: column; align-items: flex-start; gap: 4px; }
  .oss-value { text-align: left; }
}

/* ===== 主题色 swatch ===== */
.theme-color-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 8px;
  padding: 0;
}
.swatch {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: auto;
  min-width: 72px;
  padding: 8px 14px;
  border: 2px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  transition: transform 0.12s, box-shadow 0.12s;
  position: relative;
}
.swatch:hover {
  transform: scale(1.05);
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
}
.swatch.active {
  border-color: currentColor;
  box-shadow: 0 2px 12px rgba(0,0,0,0.25);
  transform: scale(1.05);
}
.swatch-check {
  font-size: 14px;
  line-height: 1;
}
.swatch-name {  font-size: 12px;
  letter-spacing: 0.5px;
}

/* ===== 云朵彩蛋（低调）===== */
.swatch-cloud .cloud-hint {
  position: absolute;
  top: -20px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 11px;
  color: var(--color-text-tertiary);
  white-space: nowrap;
  opacity: 0;
  transition: opacity 0.25s;
  pointer-events: none;
}
.swatch-cloud:hover .cloud-hint { opacity: 0.85; }
.swatch-shake { animation: swatch-shake 0.4s ease; }
@keyframes swatch-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-3px) rotate(-2deg); }
  40% { transform: translateX(3px) rotate(2deg); }
  60% { transform: translateX(-2px) rotate(-1deg); }
  80% { transform: translateX(2px) rotate(1deg); }
}
.cloud-particle {
  position: absolute;
  top: -4px;
  left: 50%;
  font-size: 13px;
  line-height: 1;
  pointer-events: none;
  opacity: 0;
  animation: cloud-float-up 1.6s ease-out forwards;
}
@keyframes cloud-float-up {
  0% { opacity: 0; transform: translate(0, 0) scale(0.6); }
  15% { opacity: 1; }
  100% { opacity: 0; transform: translate(var(--dx, 8px), -36px) scale(1.15); }
}
@media (max-width: 768px) {
  .swatch-cloud .cloud-hint { display: none; } /* 移动端无 hover，隐藏避免误触 layout */
}
@media (max-width: 768px) {
  .theme-color-row { gap: 8px; }
  .swatch { min-width: 60px; padding: 6px 10px; }
  .swatch-name { font-size: 11px; }
}

/* 免责声明 */
.disclaimer-section { margin-top: 26px; }
.disclaimer-section h3 { margin-top: 0; }
.disclaimer-card {
  padding: 14px 16px;
  background: var(--color-card);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
}
.disclaimer-card p {
  margin: 6px 0;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--color-text-secondary);
}
.disclaimer-card p b { color: var(--color-text); }
</style>
