# 技术规格

版本：0.1.0-draft · 日期：2026-10-23 · 状态：设计，尚未实现。

本文实现 [产品规格](../SPEC.md) 的行为约束。官方 API 支持与本项目的实测证据分开记录，所有性能数值均为待验证预算。

## 1. 技术方案与先决验证

采用 TypeScript、Manifest V3 和轻量界面；建议 Vite 构建、Vitest 验证纯逻辑、Playwright 配合真实 Chrome 验证扩展交互。开始实现时核验并锁定具体依赖版本。

Chrome 官方列出 Translator / Language Detector 的 Web 和扩展支持；接口存在、设备可用、语言包就绪和扩展完整闭环是不同条件。[官方矩阵](https://developer.chrome.com/docs/ai/built-in-apis)

### 1.1 M0 验证

编写完整页面引擎前，用无实验 flags 的真实 Chrome 扩展验证下表，记录浏览器版本、系统和执行上下文。初始基线 Chrome 138+，最终最低版本由实测确定；运行时能力探测始终必需。

| 验证项 | 通过条件 |
| --- | --- |
| 执行上下文 | 在明确可用的 Window 中翻译与检测语言 |
| 全新配置 | 缺语言包时可由用户手势准备，下载进度、失败、取消和重试有状态 |
| 翻译方向 | 英语到简体中文可用，输出不是繁体中文 |
| 后续自动运行 | 准备后打开此前未访问的两个已授权 HTTPS origin，无需再次点击即可翻译 |
| 弹窗关闭 | 关闭 popup 和准备页后仍可处理正文与新标签页 |
| 休眠恢复 | service worker 终止后可重连，不重复插入 |
| 浏览器重启 | 设置保留、重新探测引擎，新页面自动处理 |
| 异常恢复 | 策略禁用、缺包、离线、权限撤销和包被清理均有明确恢复路径 |
| 站点兼容 | 至少一个严格 CSP 的 HTTPS 页面；HTTP 单独记录 |

### 1.2 翻译宿主决策

- 读写页面使用 isolated world content script，默认不注入主世界、不改站点 CSP。
- 先验证 isolated world 的能力与首次准备能否覆盖后续 origin；不能只测网站开发者控制台。
- 若需 extension-owned Window，必须证明关闭弹窗后可持续工作，重建后可无手势恢复。临时准备页不能作为唯一宿主。
- offscreen document 只是候选：它不能聚焦，必须有真实匹配的官方 reason。不得发布 `TESTING` 或伪造音频／剪贴板用途；无适用 reason 或无法满足激活就否决。[offscreen 约束](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- Translator 不在 Web Worker 中提供；MV3 service worker 负责控制和路由，不直接调用模型 API。[Translator 说明](https://developer.chrome.com/docs/ai/translator-api)
- 验证结果写入 `docs/ENGINE_SPIKE.md` 后才算 M0 完成；当前没有该实测文件。实现时将选定宿主、权限、origin 与恢复方式补入本文。

无法满足时标记本地方案阻断。改用云服务或常驻窗口会改变费用／体验，需记录方案并取得用户选择，不能悄悄降低自动翻译要求。

## 2. 模块职责

| 模块 | 边界 |
| --- | --- |
| Popup / Options | 设置、当前页操作、网站规则、语言包准备、可读性 |
| Service worker | 权限、脚本注册、设置分发、任务路由、宿主重连 |
| Content coordinator | 一个 document 的运行代次、块、队列、可见性和撤销 |
| Extractor | 授权文档的可见合格文字，不读取表单值、隐藏内容或整页 HTML |
| Language gate | 源语言筛选、证据与跳过原因 |
| Translation provider | 能力、准备、纯文本翻译、取消与错误标准化，不接触网页 DOM |
| Renderer | 安全插入计划、布局复核、回滚和恢复 |
| Site adapter | 内容边界、排除区域、插入位置；X 也受通用规则约束 |
| Selection lookup | 用户主动词句查译、原句参考与浮层 |

执行顺序：授权与规则 → 提取 → 语言筛选 → 布局预检 → 可见性排序 → 翻译 → 版本核对 → 插入。主题变化只更新展示，不重新翻译。

## 3. 权限与脚本注册

| 权限 | 用途 | 策略 |
| --- | --- | --- |
| `storage` | 设置、网站规则与版本 | 必需 |
| `scripting` | 授权站点脚本注册／注入 | 必需 |
| `activeTab` | 用户主动翻译当前页 | 必需 |
| `optional_host_permissions` | 可选的 `https://*/*`、`http://*/*` 范围 | 开启自动翻译时申请，可缩小到当前 origin |
| `offscreen` | 经 M0 证明的宿主需求 | 未确定，不提前加入 |
| `contextMenus` | 未来右键入口 | 首版不用 |
| `tabs`、`history`、`cookies`、`webRequest` | 非核心需求 | 首版不申请 |

请求所有网站权限时解释用途。拒绝不反复弹窗，保留主动翻译与缺权限状态；临时 `activeTab` 不等同于新网站自动运行。[权限声明](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)、[脚本注入](https://developer.chrome.com/docs/extensions/reference/api/scripting)

运行时只申请已验证支持的协议范围；HTTP 尚未验证时只申请 HTTPS，不能为未支持场景先索取额外访问范围。

动态注册持久 content script，仅覆盖授权 origin；启动和权限变化时对账。初次开启注入现有活动页，避免必须刷新。关闭时已注入实例仍要 stop 清理，unregister 不会自动移除已注入脚本。[动态脚本说明](https://developer.chrome.com/docs/extensions/reference/api/scripting)

关闭后仅保留最小控制通道，停 observer、队列和模型调用。权限撤销时清理；若上下文已被浏览器销毁，弹窗提示刷新清除旧显示。

## 4. 提取与块身份

### 4.1 提取原则

- 选择标题、自然段、列表自然段、引用、文章和帖子正文的最小完整块；不能同时选中嵌套父块和子块。
- 同段 `strong`、`em`、`a`、短 `code` 保留原 DOM，提取使用稳定空白与语义占位，避免碎片翻译。
- 不发送 `body.innerText` 或 HTML。扫描分片遍历，只调度可见及近视口内容。
- 排除 `script`、`style`、`noscript`、`pre`、独立代码、SVG、Canvas、`textarea`、`input`、`select`、`contenteditable`、编辑器、`hidden`、`aria-hidden`、`translate=no`、`.notranslate`、插件节点与已识别私信／草稿区域。
- 隐藏、不可见和模板副本不翻译；展开后重评估。不读表单 `.value`，选区与敏感排除区域相交也不查译。
- 表单区域默认不自动提取；主动查译仅可处理非编辑、非敏感的只读标签文字，不能读取输入值。

### 4.2 BlockRecord

内存中保存元素／Range 锚点及下列字段，不序列化整页 DOM：

| 字段 | 含义 |
| --- | --- |
| `documentToken` | 每次 document 的随机身份，区分完整导航 |
| `routeEpoch` | SPA 主视图变更代次 |
| `generation` | 开关、语言、规则变更后的运行代次 |
| `blockId` | 当前 document 内的块身份，不使用 DOM 下标作永久身份 |
| `blockRevision` | 原文、来源条目或插入计划变化时递增 |
| `sourceHash` | 排除插件节点后的规范化原文摘要，保留标点与大小写 |
| `entryKey` | 帖子 permalink 等来源身份，普通文章可为空 |
| `sourceLanguage` / `targetLanguage` | 方向 |
| `state` | discovered / skipped / queued / translating / rendered / failed / disposed |
| `renderPlan` | 插入位置、布局约束、拥有的节点和属性 |

锚点与状态优先用 WeakMap，避免给源节点写大量属性。选择查译使用独立 `requestId` / `selectionHash`，不能误入页面自动插入通道。

## 5. 语言策略合同

输出 `match`、`non_match`、`unknown`，附检测器类型、候选和证据，不只输出布尔值。

优先验证本地 Language Detector。`chrome.i18n.detectLanguage` 可作为单独校准的备选，其语言比例与 `isReliable` 不能直接当作前者的 confidence。[扩展语言检测](https://developer.chrome.com/docs/extensions/reference/api/i18n)

初始 `language-policy-v1`：

- 至少 40 个有效字母的自然文本，第一候选为源语言，置信度起始阈值 0.85，领先第二候选至少 0.20；发布前用独立语料校准。
- 短文本不能凭自身低置信度通过；仅允许继承同段／同卡片可靠证据，不跨帖子、不用整页语言兜底。
- 相反语言证据阻止继承；容器有多语言时不能统一继承。
- 非源语言、目标语言和 unknown 自动跳过。主动查译未知语言可询问是否按所选源语言处理，需要明确点击。
- 混合段落按可靠句子边界拆分；同句混杂无法可靠拆分则跳过。85% 英语不等于允许翻译剩余法语句子。
- 漏翻与误翻分开记录；不通过盲目降阈值追求覆盖。

阈值是工程假设，不能直接当准确率承诺。检测器无第二候选时使用其专门校准政策，不伪造 margin。

## 6. 翻译引擎合同

### 6.1 最小接口

```ts
type AppLanguage = string; // BCP 47; UI v0.1 target is restricted to zh-CN
type Readiness = "ready" | "needs-download" | "downloading" | "unsupported";

interface LanguagePair {
  sourceLanguage: AppLanguage;
  targetLanguage: AppLanguage;
}

interface PrepareOptions {
  signal: AbortSignal;
  onProgress?: (progress: { stage: string; fraction?: number }) => void;
}

interface TranslationRequest extends LanguagePair {
  requestId: string;
  segments: Array<{ segmentId: string; text: string }>;
  signal: AbortSignal;
}

interface TranslationResponse {
  requestId: string;
  segments: Array<{ segmentId: string; translatedText: string }>;
}

interface TranslationProvider {
  readonly id: string;
  readonly version: string;
  availability(pair: LanguagePair): Promise<Readiness>;
  prepare(pair: LanguagePair, options: PrepareOptions): Promise<void>;
  translate(request: TranslationRequest): Promise<TranslationResponse>;
  dispose(): Promise<void>;
}
```

这是宿主内部合同；`AbortSignal` 不通过 runtime 消息序列化。跨上下文使用 `CANCEL(requestId)`，宿主创建本地 AbortController。

- 结果仅纯文本，不接受 HTML、脚本或 DOM patch。
- 按 `segmentId` 对应，缺失、重复、未知 ID 都视为协议错误，不靠数组位置猜测。
- 空结果、提示词和错误文本不能作为译文插入。
- 应用统一 `zh-CN`，Chrome 适配器映射到经过验证的简体中文方向标识，如 `zh`；不假定任意 BCP 47 直接可用。
- 本地每宿主／方向一个执行队列；不同块不能无边界拼接。长块按句拆分，回到原块展示。
- 官方说明翻译按序处理；优先短可见块，对多标签页公平限流。[顺序执行说明](https://developer.chrome.com/docs/ai/translator-api)
- 调度软限制：块约 2,000 字符、子段约 800 字符；这是初始预算，不是官方 API 上限。

### 6.2 选择查译

首版输出所选词句直译，不承诺词典或语境词义抽取。翻译所在句时单独显示“原句参考”，不能将整句中文冒充词义。

选区最多 1,000 字符，超出提示缩短；原句参考最多 500 字符，仅取同一可见段的非敏感文本。单词直译与原句参考分开显示，留在本地。

### 6.3 错误标准化

错误码：`unsupported_browser`、`unsupported_pair`、`needs_download`、`activation_required`、`download_failed`、`permission_denied`、`host_unavailable`、`timeout`、`cancelled`、`invalid_response`、`translation_failed`。

权限、需用户动作和不支持错误不自动重试。临时执行错误最多重试一次并短退避；超时起始 15 秒，下载独立处理。重试前重检版本与可见性；持续失败暂停 provider，给恢复入口，不循环唤醒。

## 7. 动态页面与恢复

### 7.1 回写前同时满足

1. document、routeEpoch、generation、blockRevision 与请求一致。
2. 原锚点仍连接，未替换或转成编辑区。
3. 当前 sourceHash、entryKey、语言方向相同。
4. 规则或主动运行有效，权限存在。
5. 无当前版本译文，最新布局允许插入。

不符即丢弃，不能猜一个近似 DOM 位置回写。

### 7.2 增量、路由与 X

- MutationObserver 只处理相关变更，排除插件节点和自身插入，避免循环；原文更新先撤旧译文、递增 revision，再调度。
- IntersectionObserver 做视口优先级，后台页暂停新任务。扫描分片，布局读取／写入分批，避免逐节点强制全页重排。
- 首版不改主世界 history API；结合 DOM 根变化与有限 URL 检查识别 SPA 导航，revision 作为第二道保护。
- bfcache 的 pagehide／pageshow 后重检设置和代次，不能复活已关闭翻译。
- X 按帖子正文边界与公开 permalink 身份适配，选择器版本化；展开、返回、引用帖、同节点换帖均重检身份。
- 排除编辑器、私信、账号统计和站点自身译文；结构不可靠时安全跳过并给兼容状态，不能直接翻译整块 article。

### 7.3 关闭与生命周期

先推进 generation，再取消队列、observer 和订阅，移除拥有的译文／浮层，广播状态。底层无法取消的执行可结束，但结果必须丢弃。

service worker 全局变量不是唯一事实来源。设置存 `storage.local`，document coordinator 持有本轮状态；重连握手按设置版本与 documentToken 对账，只重新调度缺失项。[生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)

浏览器重启可丢正文缓存，不能丢开关设置；不以无业务意义的定时 ping 保 worker 常驻。

## 8. 渲染与布局

- 仅以 `textContent` 写译文，不使用不可信 `innerHTML`。
- 在合法容器内追加自有元素或安全 sibling；不包裹、移动、替换原文节点。
- 插入会新增错误 grid／flex 项、破坏表格或嵌套交互时否决；适配器可给出实测安全位置。
- 样式只作用自有节点，不改原网站全局字体、宽高、overflow 和事件。
- 预检固定高度、裁切、line-clamp、定位、交互祖先和宽度；插入后检查重叠／溢出，不安全立刻回滚转查译。
- 每块有限次尝试，避免插入—移除震荡；主题、宽度、可见性变化才重评估。
- 保持视口阅读锚点，不跳顶；避免已滚过屏幕上方的迟到插入造成跳动。
- 网站可能观察到新增 DOM 文字，不能承诺所有站点零影响；真实组件交互和布局必须验收。

浮层独立样式边界，主动查阅才出现，支持键盘与边缘避让。原控件可访问名称保持不变。

## 9. 设置、缓存与消息

### 9.1 设置模型

```json
{
  "schemaVersion": 1,
  "settingsVersion": 1,
  "autoTranslate": false,
  "sourceLanguage": "en",
  "targetLanguage": "zh-CN",
  "provider": "chrome-local",
  "selectionLookup": true,
  "translationScale": 0.85,
  "minimumTranslationFontPx": 12,
  "contrast": "readable-secondary",
  "siteRules": {}
}
```

网站按 origin 存 `follow-global | always | never`，总开关高于 always。当前页暂停仅内存。迁移失败保守关闭自动翻译，不误开启。

### 9.2 缓存

- 正文／译文仅内存，不写磁盘、sync 或日志。只有设置与 origin 规则落本机。[存储说明](https://developer.chrome.com/docs/extensions/reference/api/storage)
- 同 origin 可复用，跨 origin 不共享正文缓存。
- key 包含 origin、语言方向、provider 版本、分段策略、上下文标识与原文摘要；复用时还要精确匹配原文。
- 合并请求的各订阅块独立检查 generation；取消一页不误取消其他有效订阅。
- 总预算初始为 1,000 项或 5 MiB，先到先淘汰，LRU；可清除，语言变化按方向失效。

### 9.3 消息安全

- 验证 sender、授权标签页、类型、长度与速率。tab／document／origin 身份从浏览器取得，不信任页面任意参数。
- 不开放 `externally_connectable` 或任意页面 `postMessage` 翻译代理；content script 不指定任意联网地址。
- 权限和语言包准备在合法 UI 手势内发起，不伪造点击。
- 首版本地无项目方联网、远程代码或密钥。未来云 provider 另行设计。

## 10. 性能预算

记录参考机器、系统、Chrome；语言包已准备、100 段夹具、前台、无其他翻译插件。冷准备、热执行和真实网站分别报告。

| 指标 | 首版目标 |
| --- | --- |
| 首块可见译文 | 热状态 p95 ≤ 2 秒，引擎耗时另列 |
| DOM 工作 | 单片目标 < 16 ms，无插件引入的 > 50 ms long task |
| 关闭清理 | 当前页 p95 ≤ 300 ms；可达其他页 ≤ 1 秒收到停止 |
| 预取 | 下方约 1 个视口，不翻译全量信息流历史 |
| 动态追加 | 稳定后约 150–300 ms 批处理，再按可见性执行 |
| 压力 | 20 次开关、200 次复用后无重复译文、脱离节点引用或队列持续增长 |
| 布局 | 无新增横向滚动、遮挡与控件失效；正常高度增加可接受 |

这些是待测预算。未达标要记录原因并修正，不能把目标写成结果。

## 11. 实现组织与发布

未来代码按 background、content、providers、adapters、selection、ui、shared 组织；测试分独立夹具、策略单测与真实扩展交互。当前仓库尚无这些运行时代码。

构建包不能含私有样本、用户附件、密钥、浏览历史或工作规划文件。解压后的明确目录直接包含 `manifest.json`，Releases 记录版本、来源、校验值、权限与安装方法。
