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
      <p class="hint">网页版没有独立的更新检查——刷新页面（或手机端右上角 🔄 按钮）即获取最新版本；下方按钮可直接刷新</p>
      <div class="data-actions">
        <button class="data-btn" @click="manualCheckUpdate">
          🔄 刷新页面
        </button>
        <button class="data-btn" @click="showUpdateLog = !showUpdateLog">📜 更新日志</button>
      </div>
      <div v-if="showUpdateLog" class="update-log">
        <h4>更新日志</h4>
        <div class="log-entry">
          <span class="log-version">v1.2.48</span>
          <ul>
            <li>考试答案加固：考生端不再直接读取考试数据，公共考试列表/取卷/判分/查询码回看全部改由云端函数下发，答案与解析不再随卷面一起发出</li>
            <li>修复「没作答的题被当成答错」：交卷判分改为按「是否作答」统计</li>
            <li>查询码随机部分加长（4 → 6 位），并给判分动作补两道门（全空白卷不下发答案、非公开考试不对外发答案）</li>
            <li>云同步：题库/题目内容修改恢复推送；删除题库/题目补上云端删除通道（删掉的内容不再被下次同步「复活」）；公共内容被跳过时不再谎报「同步完成」；从备份恢复后不再假装「已同步」</li>
            <li>导入：AI 分块失败会明确提示（不再静默少题）；答案回填不再猜位置；「识别题数明显偏少」的安全网真正生效</li>
            <li>判断题判分口径统一（网页端与云端同一套判断词），修掉个别题目「白送分 / 恒判错」</li>
            <li>联系与分享：微信二维码恢复可扫、反馈按钮不再假报成功；分享卡片换用新站名；新增 robots.txt</li>
            <li>运维：新增每日全库备份入库与站点巡检；管理面板口令改走云函数校验，并加了失败锁定</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.47</span>
          <ul>
            <li>关闭自由创建公共题库：新建题库一律为私人，完成后可在题库卡片「提交到公共题库」申请公开（需管理员审核）</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.46</span>
          <ul>
            <li>自动清理「我的题库」里显示 0 题的空公共题库壳（只删本地显示，不动云端公共数据）</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.45</span>
          <ul>
            <li>云同步提速：题目去重改索引查表，大题库同步不再卡顿；修掉「拉取 N 条」计数虚高</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.44</span>
          <ul>
            <li>云同步推送侧去重：本地同一道题的重复副本只上传一条；恢复导入后不再被当成整库待上传</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.43</span>
          <ul>
            <li>修复云同步题目反复叠加：同题干自动判重，反复同步不会越点越多</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.42</span>
          <ul>
            <li>修复 deleteBank 级联删除遗漏 review_records：删题库后复习记录不再残留</li>
            <li>修复 judgeAnswerBool 空答案默认 'true'：无法识别的判断词不再误判为正确</li>
            <li>修复 ExamTakeView reviewWrongs 类型声明：补全 myRaw/correctRaw 字段</li>
            <li>修复 StatsView 错题饼图暗色主题适配：中心圆和文字改用 CSS 变量颜色</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.41</span>
          <ul>
            <li>整体代码审查：全库 bug 扫描 + 58 项单元测试全通过 + 全页面手机端适配检查</li>
            <li>首页记忆复习入口卡片手机端适配：纵向堆叠、健康条全宽、隐藏箭头</li>
            <li>首页学习计划卡片手机端适配：同步优化</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.40</span>
          <ul>
            <li>修复云同步题目叠加：cloudId 为空时按 stem+bank_id 去重，匹配后回写 cloud_id 防止下次再叠加</li>
            <li>记忆复习页手机端适配完善：scope-bar/exam-banner/复习列表全宽适配</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.39</span>
          <ul>
            <li>记忆复习统计新增「知识点去重」：同题目内容（stem）只保留最强记忆记录，避免重复题导致健康度/分布虚高；概览显示「去重后知识点数」</li>
            <li>calculateDailyTask 性能优化：O(N²) 嵌套 find → O(N) Map 查表，4000 题计算从 ~300ms 降到 3ms</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.38</span>
          <ul>
            <li>修复记忆复习核心 bug：`last_review` 误存为下次复习时间导致逾期判断失效、SM-2 间隔计算错误，现已修复为正确记录本次复习时间</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.37</span>
          <ul>
            <li>记忆复习新增「备考驱动」动态节奏：设置考试日期后，按距考试天数动态加大每日复习比例（常规8% → 加量12% → 冲刺18% → 冲刺极限25%），越临近考试复习越突击</li>
            <li>记忆复习页与首页显示「距最近考试 N 天」及对应复习阶段提示</li>
            <li>未设考试日期时保持默认常规节奏</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.36</span>
          <ul>
            <li>记忆复习新增「按题库独立复习」：顶部可切换全部/指定题库，每个题库按题目规模联动每日配额（8%、保底25、上限200），大题库不再受制于全局50题限制</li>
            <li>记忆复习页支持单库范围选择，每库独立显示到期数与建议题数</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.35</span>
          <ul>
            <li>记忆复习新增防堆积机制：每日复习配额（联动学习计划，至少 50 题保底），超出自动顺延，杜绝「墨墨式」长时间不练后一次性涌出大量到期题</li>
            <li>首页记忆卡片改显示「今日建议 N 题」而非全量到期，并标注顺延数，消除复习焦虑</li>
            <li>超过 30 天未复习的题自动标记「重新学」，从短间隔重新开始，不留痛苦长尾</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.34</span>
          <ul>
            <li>新增「记忆复习」功能：基于遗忘曲线的间隔重复，任何练习模式都自动积累记忆数据（自动评估记忆质量，可手动覆盖为认识/一般/模糊/不认识）</li>
            <li>首页新增「记忆复习」入口卡片：显示今日待复习题数和记忆健康度，点按直达记忆复习页</li>
            <li>修复学习计划复习判断：之前备考记录字段命名不符导致复习题永远不触发，现已统一字段并改用 next_review 为准</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.33</span>
          <ul>
            <li>云同步提速（并发推送 + 增量同步）：本地几千题时同步从十几分钟降到秒级；断网推送不再「假成功」，会明确提示失败条数</li>
            <li>修复统计页正确率超 100%、答错数为负的问题（同一题多次答对时显示异常）</li>
            <li>修复首页进出时监听器泄漏（每次进出首页累积 document 监听器）</li>
            <li>修复公共题库重复导入：已导入的题库不再显示「添加」按钮，二次拦截防同名副本</li>
            <li>修复设置云同步无限膨胀：每次手动同步新增 5 条重复设置文档的问题，改为稳定身份更新</li>
            <li>修复热力图数据异常时整块不显示：解析失败降级为空热力图</li>
            <li>修复 ExamTakeView 查询码错误处理：区分网络异常、考试不存在、超时等不同情况，提供更详细的错误提示</li>
            <li>修复 WrongView 练习退出反馈：题目数据异常或已删除时，添加 toast 提示</li>
            <li>修复 QuestionCard 选项乱序稳定性：使用固定种子确保同一题目乱序结果一致</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.32</span>
          <ul>
            <li>修复备份/恢复丢失数据：「已掌握」记录和「智能组卷历史」未包含在备份中，恢复后会丢失——现已补全</li>
            <li>修复删除题库未清理「已掌握」记录：删除题库后 mastered_questions 表残留孤儿数据，导致错题本出现幽灵条目</li>
            <li>修复检查更新版本号显示错误：手动检查更新提示 v1.2.29 而非实际版本</li>
            <li>修复热力图最长连续天数在夏令时切换日可能断裂的问题</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.31</span>
          <ul>
            <li>错题本新增「自动掌握」：练习时连续答对指定次数（默认 3 次，可在设置→练习调整：关闭 / 2 / 3 / 5 次），题目自动移入「已掌握」；中途答错重新计数；错题列表显示「连对 n/阈值」进度，云同步保留计数</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.30</span>
          <ul>
            <li>修复多选题 5+ 选项误判：历史导入把第 5 个选项拼进题干（答案仍含 E/F）导致必判错——云端 64 道题已修复，前端答题/组卷自动自愈，此后再不会出现「看不见选项却被判错」</li>
            <li>修复单题 AI 解析格式错乱：AI 现在按要求返回结构化解析（知识点 / 逐项分析 / 参考答案 / 易错点 / 解题技巧），分区清晰展示</li>
            <li>手机端修复：题干右上角按钮遮挡题目；题库 ⋯ 菜单点击无反应；「答对自动下一题」开关记住选择</li>
            <li>练习页题型筛选修复：判断题（库内以单选形式存储）现在正确显示「判断」筛选项</li>
            <li>云同步加固：请求超时保护（不再卡死按钮）；严格只同步私人数据（公共题库不再拉入本地）；修复同步覆盖「我的题库」私人副本的严重 bug；补齐掌握记录同步</li>
            <li>设置页清理：移除「数据库位置 / 备份目录」占位（网页版无文件系统），新增备份 / 恢复教程；手机端隐藏键盘快捷键提示</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.29</span>
          <ul>
            <li>云同步删除同步修复：取消收藏 / 标记已掌握 / 放回错题 / 清空收藏等删除类操作会同步删除云端旧记录，不再「复活」</li>
            <li>题型归一：问答（qa）题不再被当成填空显示</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.27</span>
          <ul>
            <li>修复错题本「已掌握」：标记已掌握现在真正记录（支持云同步），已掌握列表可查看/放回；首页「已掌握」统计改为真实数据</li>
            <li>导入解析器支持 A) A: 等选项分隔格式；编辑题目切换题型自动重置答案</li>
            <li>考试列表/查询上限提升至 500；未知链接自动跳回首页</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.26</span>
          <ul>
            <li>移除设置页「OCR 引擎」区块（网页版暂不支持图片识别，避免误导）</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.25</span>
          <ul>
            <li>AI 识别引擎新增 OpenCode 官方订阅推荐：Go（$10/月订阅，DeepSeek/Kimi/GLM 等开源模型）/ Zen（按量付费，Claude/GPT/Gemini，含免费模型），点击自动填充</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.24</span>
          <ul>
            <li>AI 识别引擎设置更新：模型统一为 DeepSeek V4（deepseek-v4-flash / deepseek-v4-pro，旧 deepseek-chat 已停用）；新增硅基流动注册入口（邀请码 TPL3Ne7Z）</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.23</span>
          <ul>
            <li>修复考试「查询码回看错题」：错题列表现在显示完整选项（你的答案标红、正确答案标绿），不再只有题干；没有错题时显示「全部答对」提示</li>
            <li>修复判断题被当选择题：公共题库导入、旧考试快照中的判断题统一按内容识别，正确显示 √正确/×错误</li>
            <li>云同步重构：只同步私人数据（公共题库人人可见无需同步）；修复进度/错题/收藏上传失败的问题；新增「同步昵称」，换设备填同一昵称即可拉回私人进度/错题/收藏</li>
            <li>智能组卷新增历史记录：交卷自动保存（记录码 + 成绩），可回看历次错题、删除记录</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.14</span>
          <ul>
            <li>首页新增访问统计：显示「累计访问次数 · 今日访问次数」（本设备按天去重，云端独立集合计数）</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.13</span>
          <ul>
            <li>数据备份升级为全量备份：一次导出题库 + 题目 + 错题 + 收藏 + 练习记录 + 设置</li>
            <li>新增「📥 导入恢复」按钮：选择备份文件即可整体恢复本地全部数据</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.12</span>
          <ul>
            <li>手机版（≤768px）右上角导航栏新增「🔄 刷新」按钮（清缓存硬刷新拿最新版本）</li>
            <li>考试列表「📖 预览」按钮改为「📖 进入」</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.11</span>
          <ul>
            <li>首页公共题库新增「＋ 添加到我的题库」：一键将云端题库导入为本地私人副本，自动获得进度条 / 错题本 / 收藏夹</li>
            <li>公共题库小标题增加提示：仅供展示、练习数据不保存，导入本地后享进度/收藏/错题</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.10</span>
          <ul>
            <li>「联系我」弹窗替换为真实微信二维码</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.9</span>
          <ul>
            <li>删除侧边栏无效的「关闭」按钮；刷新按钮加文字标签与「加载不全或卡顿，点此刷新」提示</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.8</span>
          <ul>
            <li>侧边栏底部新增「联系我」入口（圆形头像，点击弹微信二维码）</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.7</span>
          <ul>
            <li>主 logo 更换为兔子动态 logo：多尺寸 PNG（32/64/192/256/512）+ 透明动态 logo.gif</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.6</span>
          <ul>
            <li>首页图标改为轻量 GIF 动图（书本 / 火箭 / 骰子 / 火焰，96×96 透明 3 帧浮动）</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.5</span>
          <ul>
            <li>修复交卷后显示「试卷不存在」、查不到查询码（交卷后 exam=null 与成绩页分支顺序导致）</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.4</span>
          <ul>
            <li>修复创建考试选公共题库「选一个全选、改一个数量其它全变」（云端无 id 字段，v-for key 兼容 _id）</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.3</span>
          <ul>
            <li>修复全新访客（零配置）首页看不到公共题库 / 公共考试（ensureCloud 无配置回退默认 envId）</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.2</span>
          <ul>
            <li>修复自建题库「题目框消失、题号导航还在」（QuestionCard 中 IIFE 在 computed 声明前访问引发 TDZ）</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.1</span>
          <ul>
            <li>修复题型筛选三问题：判断题（云端存为 single + 选项[正确,错误]）无「判断」按钮、全不选白屏；自建题库筛选后未重建答题顺序</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.2.0</span>
          <ul>
            <li>新增「选项乱序」功能：题库练习 / 公共题库刷题可手动开启打乱选项顺序，模拟考试默认开启</li>
            <li>乱序后判分、答案高亮、存档自动映射对齐，不会出现「显示 A 判成 C」错位</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.1.1</span>
          <ul>
            <li>修复公共题库打开无反应：加载增加超时保护与失败重试提示，不再卡在「加载中」</li>
            <li>修复公共题库题目被截断的问题：合集 / 技师等超过 500 题的题库现在可刷到全部题目</li>
            <li>公共题库加载失败时显示具体原因和「重试」按钮</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v1.1.0</span>
          <ul>
            <li>修复考试三大问题：无法删除、交卷后显示考试不存在、交卷报 [object Object]</li>
            <li>新增考试本地快照兜底：网络异常也能查看和回看已参与的考试</li>
            <li>关闭启动自动云同步，消除刷题卡顿；改为手动「立即同步」</li>
            <li>新增首页公共题库与公共考试入口，无需同步即可直接刷公共题</li>
            <li>新增公共题库直刷模式：顺序 / 随机 / 模拟考试三种刷题方式</li>
            <li>新增管理员面板（本机管理服务）：密码保护，可管理公共考试 / 公共题库 / 清理个人数据</li>
            <li>云端公共题库数据重建：6 大题库（合集 / 初级 / 中级 / 高级 / 技师 / 安规）共 7049 题与权威源一致</li>
            <li>技师题库按权威 TXT 重建（820 题：单选 292 + 多选 192 + 判断 336），技师模拟考试重新抽题</li>
            <li>错误提示统一优化：不再出现 [object Object] 等无意义报错</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v0.1.8</span>
          <ul>
            <li>修复 mammoth 提取 docx 时选项分隔符错位导致部分题目选项被并入题干的问题（如习思想2第101题）</li>
            <li>PDF 导入改为异步执行，支持取消按钮和逐页进度反馈</li>
            <li>PDF 导入添加 5 分钟硬超时保护，单页失败自动跳过</li>
            <li>答案区识别优化，第十五章等缺少小节标题的章节可基于内容自动推断题型</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v0.1.1</span>
          <ul>
            <li>更新应用图标（全平台）</li>
            <li>修复 WebView 缓存导致旧图标不刷新的问题</li>
            <li>修复 exe 文件图标不显示的问题（多尺寸 ICO 嵌入）</li>
          </ul>
        </div>
        <div class="log-entry">
          <span class="log-version">v0.1.0</span>
          <ul>
            <li>首次发布</li>
            <li>支持 docx / txt / md / pdf 导入</li>
            <li>AI 自动解析（多模型：智谱 / DeepSeek / Agnes）</li>
            <li>收藏夹 / 错题本 / 学习热力图</li>
            <li>题目导航 / 搜索高亮 / 题型筛选</li>
            <li>自动更新支持</li>
          </ul>
        </div>
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
            <label>同步昵称</label>
            <input v-model="syncNickname" @blur="saveSyncNickname" placeholder="换设备填同一昵称可同步私人进度/错题/收藏" class="dir-input" />
          </div>
          <div class="cloud-actions">
            <button class="data-btn" :disabled="!cloudEnvId.trim() || cloudSyncing" @click="saveCloudConfig">{{ cloudSyncing ? '☁️ 同步中...' : '☁️ 连接并同步' }}</button>
            <button class="data-btn" :disabled="!cloudSaved || cloudSyncing" @click="doSync">{{ cloudSyncing ? '🔄 同步中...' : '🔄 同步数据' }}</button>
          </div>
          <p class="hint cloud-tip">① 昵称默认随机生成，可改成好记的；换设备填<b>同一昵称</b>即可拉回私人进度。② 之后题库、错题、收藏有改动时点「同步数据」推送到云端。③ ⚠️ 这个昵称<b>等同于你的跨设备身份</b>（云端按它区分数据归属）：<b>请勿使用真实姓名、手机号等个人信息</b>；也不要用太短或太好猜的昵称——别人用了同名昵称就会与你的云端数据互相覆盖。</p>
          <p v-if="syncNicknameMsg" class="hint warn">{{ syncNicknameMsg }}</p>
          <p v-if="cloudStatusText" class="hint" :class="{ warn: cloudError }">{{ cloudStatusText }}</p>

          <!-- 与小程序打通（自定义登录，替代匿名身份） -->
          <div class="bind-box">
            <div class="bind-title">🔗 与小程序打通{{ bound ? '（已绑定）' : '' }}</div>
            <p class="hint">
              网页版默认匿名身份，换浏览器或清缓存会丢数据。在小程序「我的 → 与网页版打通」生成 6 位绑定码填在这里，
              两端即共用同一账号，错题与进度自动互通。
            </p>
            <div v-if="!bound" class="bind-row">
              <input v-model="bindCodeInput" class="bind-input" placeholder="6 位绑定码" maxlength="6" @input="bindCodeInput = bindCodeInput.toUpperCase()" />
              <button class="data-btn" :disabled="binding || bindCodeInput.trim().length !== 6" @click="doBind">
                {{ binding ? '绑定中...' : '绑定' }}
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
  </div>
</template>

<script setup lang="ts">
// P2-4 的 refreshBoundState 与 cloud.ts 的其余调用一样走**动态 import**（保持 SDK 不进主包），
// 故此处不静态导入它——静态导入会多出一条 TS6133「已声明未使用」，也会把 cloud.ts 静态拉进本视图 chunk。
import { redeemBindCode, unbindMiniProgram, isBoundToMiniProgram } from '../lib/cloud'
// 2026-09-15（用户裁定「挂上入口」）：意见反馈弹窗自 Initial commit 起就在仓库里却**没有任何调用点**
// （全仓 grep 零引用），用户永远打不开它；P2-19 已把它的「附加最近 100 行运行日志」修成真的。
// 现在从设置页「关于本项目」卡片挂一个入口进来。日志缓冲由该组件首次打开时自行安装（复审 MF-1）。
import FeedbackDialog from '../components/FeedbackDialog.vue'
import { isTrustedAiHost } from '../lib/ai'
import { ref, onMounted } from 'vue'
import { api } from '../utils/api'
import { toastSuccess, toastError } from '../utils/toast'
import { updateAppearanceCache } from '../lib/theme'

const currentVersion = ref('1.2.48-web')
const checkingUpdate = ref(false)
const showUpdateLog = ref(false)
// 意见反馈弹窗的开关（2026-09-15 用户裁定新增入口）
const showFeedback = ref(false)

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
  const code = bindCodeInput.value.trim().toUpperCase()
  if (code.length !== 6) return
  binding.value = true
  bindMsg.value = ''
  bindError.value = false
  try {
    const r = await redeemBindCode(code)
    if (r.ok) {
      bound.value = true
      bindCodeInput.value = ''
      bindError.value = false
      bindMsg.value = '绑定成功！现在可点「同步数据」拉取小程序端的错题与进度'
      toastSuccess('已与小程序共用账号')
    } else {
      bindError.value = true
      bindMsg.value = r.msg || '绑定失败'
      toastError(r.msg || '绑定失败')
    }
  } catch (e: any) {
    bindError.value = true
    bindMsg.value = '绑定失败：' + (e?.message || String(e))
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
  } else {
    toastError('解除失败')
  }
}

// 同步昵称（跨设备身份）：默认随机生成，可自定义
// P1-12（T10b，2026-09-15）：setSyncKey 现在做写入侧校验并返回结果（旧实现返回 void，任何输入都静默写入，
// 包括空串→随机重生成、超短/怪字符昵称→静默接受）。这里按结果如实提示，弱昵称给「碰撞风险」提示但不阻拦。
const syncNicknameMsg = ref('')
function saveSyncNickname() {
  try {
    import('../lib/cloud').then(m => {
      const r = m.setSyncKey(syncNickname.value.trim())
      syncNickname.value = r.key  // 校验失败时回显当前实际生效的昵称（未被改动）
      syncNicknameMsg.value = r.ok ? (r.warn || '') : (r.msg || '同步昵称无效')
      if (r.ok) toastSuccess('同步昵称已保存')
      else toastError(r.msg || '同步昵称无效')
    })
  } catch { /* ignore */ }
}

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
    // 读取应用版本（PWA 固定版本号）
    currentVersion.value = '1.2.48-web'
    // 读取云同步配置
    loadCloudConfig()
    // 读取同步昵称
    try {
      const m = await import('../lib/cloud')
      syncNickname.value = m.getSyncKey()
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

// === 云同步逻辑 ===
async function loadCloudConfig() {
  try {
    const mod = await import('../lib/cloud')
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
    // #36（2026-09-15 复审 MUST-FIX 3）：全域只有两个 syncAll 调用点，另一个是 doSync（已按 st.error 分流）。
    // 这里原先只看 `st.authed` ⇒ 云端**部分失败**（st.error 非空）时状态行仍显示绿色「✓ 已连接云端」，
    // 与 doSync 的诚实口径不一致。现改为同口径；「配置已保存」仍如实告知（那件事确实成功了），
    // 但同步没完成时另给一条失败提示，不让绿字掩盖问题。
    if (st.authed && !st.error) {
      cloudStatusText.value = `✓ 已连接云端 · 推送 ${res.pushed} 条 · 拉取 ${res.pulled} 条${truncTip}${skipTip}`
      toastSuccess('云同步配置已保存')
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

async function doSync() {
  if (!cloudSaved.value) {
    toastError('请先保存配置')
    return
  }
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
    cloudError.value = !!st.error
    if (st.authed && !st.error) {
      // P1-19（T10b）：拉取截断（命中分页上限）不是错误，但要显式提示，否则「同步完成」会掩盖数据少了一截
      const truncTip = res.truncated ? ' · ⚠️ 有集合超出单次同步上限，本次未同步完整（可再点一次「同步数据」续拉）' : ''
      // A-03：同上一处调用点，把「无权写的公共内容」如实报出（这是第二个 syncAll 调用点）
      const skipTip = res.skipped ? ` · 跳过 ${res.skipped} 条（公共内容客户端无权改，仅本地生效）` : ''
      cloudStatusText.value = `✓ 同步完成 · 推送 ${res.pushed} 条 · 拉取 ${res.pulled} 条${truncTip}${skipTip}`
      toastSuccess('同步完成')
    } else {
      cloudStatusText.value = st.error || '同步中...'
      toastError('同步未完成：' + (st.error || '云端未授权'))
    }
  } catch (e) {
    cloudError.value = true
    cloudStatusText.value = '同步失败：' + (e instanceof Error ? e.message : String(e))
    toastError('同步失败')
  } finally {
    cloudSyncing.value = false
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
    if (!confirm('导入恢复将覆盖当前本地数据（题库 / 题目 / 错题 / 收藏 / 练习记录 / 设置），确定继续？')) {
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

interface AdminRes { ok: boolean; message?: string; code?: string; total?: number; exams?: any[]; banks?: any[]; deleted?: number }

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

function adminConfirm(msg: string): boolean {
  return window.confirm(msg)
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
.cloud-actions { display: flex; gap: 8px; }
.bind-box { margin-top: 16px; padding: 14px; border: 1px dashed var(--color-border); border-radius: var(--radius-md); background: var(--color-bg); }
.bind-title { font-size: 14px; font-weight: 600; margin-bottom: 6px; color: var(--color-text); }
.bind-row { display: flex; gap: 8px; align-items: center; margin-top: 10px; }
.bind-input { flex: 0 0 140px; padding: 8px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-md); font-size: 18px; letter-spacing: 3px; text-align: center; font-family: monospace; background: var(--color-card); color: var(--color-text); }
.bind-ok { font-size: 14px; color: var(--color-success, #16a34a); font-weight: 500; }
.cloud-tip { margin-top: 8px; line-height: 1.6; color: var(--color-info-strong); }
.hint.warn { color: var(--color-danger); }
.hint.warn { color: var(--color-warning); }
.hint.success { color: var(--color-success); }

/* 更新日志 */
.update-log { background: var(--color-bg); border: 1px solid var(--color-border-light); border-radius: var(--radius-md); padding: 12px 16px; margin-top: 8px; max-height: 280px; overflow-y: auto; }
.update-log h4 { margin: 0 0 8px 0; font-size: 13px; color: var(--color-text-secondary); }
.log-entry { margin-bottom: 8px; }
.log-version { display: inline-block; padding: 2px 8px; background: var(--color-primary-light); color: var(--color-primary); border-radius: 4px; font-size: 12px; font-weight: 600; margin-bottom: 4px; }
.update-log ul { margin: 4px 0 0 0; padding-left: 20px; color: var(--color-text-secondary); font-size: 13px; line-height: 1.7; }

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
