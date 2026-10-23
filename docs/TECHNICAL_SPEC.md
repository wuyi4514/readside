# 技术规格

实现版本：`0.1.1-preview.2` · 日期：2026-10-23。

本文记录当前开发预览的实现。正式首版目标见[产品规格](../SPEC.md)，测试结果见[验证报告](VALIDATION.md)；性能预算和未执行的验收不视为已达成。

## 1. 引擎和执行上下文

TypeScript、Manifest V3、esbuild；原生 HTML/CSS 构建轻量 Popup / Options，Vitest 检查策略与生命周期，Playwright 连接独立真实 Chrome 检查翻译。依赖版本锁定在 `package-lock.json`，发布包没有 npm 运行时依赖。

Options 页面在真实按钮手势内调用 Translator / LanguageDetector 准备模型、显示实际进度并自检。模型准备后，各网页的 **isolated content script** 在自身 Window 中检测、翻译和渲染，不需要保持 Popup / Options 开启。后台 worker 只管理设置、权限和动态脚本注册。

M0 已验证新 HTTPS origin 无手势运行、关闭准备页后运行、严格 CSP，以及重启后模型复用。CDP 调试加载的扩展重启后需要工具重新加载，因此普通 UI 安装持久性仍需单独验收。详见[引擎验证](ENGINE_SPIKE.md)。

无需 offscreen、主世界注入、常驻窗口、云服务或共享 Key。API 基线 Chrome 138，当前真实验证 Chrome 155 / macOS；每次运行探测设备、语言方向和模型状态。[官方能力矩阵](https://developer.chrome.com/docs/ai/built-in-apis)

## 2. 模块

| 路径 | 职责 |
| --- | --- |
| `src/background/` | 受信设置写入、权限对账、动态脚本注册、标签页状态 |
| `src/content/extractor.ts` | 通用语义块与自然文本边界、敏感排除、来源身份 |
| `src/content/language.ts` | 块／句语言筛选、局部上下文证据 |
| `src/content/controller.ts` | 文档代次、队列、可见性、动态内容和旧结果隔离 |
| `src/content/renderer.ts` | 保留原 DOM、安全插入、样式和布局复核 |
| `src/content/selection.ts` | 用户主动查译、独立 Shadow DOM 浮层和复制 |
| `src/providers/` | Chrome 原生会话、取消、检测和本地缓存 |
| `src/shared/` | 设置校验、消息合同、发送者身份与 LRU |
| `src/ui/` | 弹窗与阅读设置、模型准备、权限与可读性 |

流程：权限和规则 → 通用提取 → 可见性排序 → 语言筛选／布局预检 → 本地翻译 → 版本核对 → 插入／回滚。主题变化只更新样式。

## 3. 权限与消息

必需 `storage`、`scripting`、`activeTab`。可选 `https://*/*` 与安全开发地址 `http://localhost/*`、`http://127.0.0.1/*`；不为普通 HTTP 请求全网权限。不申请 offscreen、tabs、history、cookies、webRequest 或剪贴板读取。

网站授权可为全部 HTTPS 或当前主机，持久动态 content script 仅注册已获权限范围，设置与权限变化时对账。临时 activeTab 用于点击插件后的当前页主动操作，不等同于自动运行权限。[权限](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)、[动态脚本](https://developer.chrome.com/docs/extensions/reference/api/scripting)

只有本扩展的 Popup / Options 可更新设置；消息校验扩展身份和精确页面来源。正文翻译在文档内部执行，不提供网页可调用的翻译／联网代理。不开放 externally_connectable、postMessage 桥或任意联网地址；扩展页面 CSP 声明 `connect-src 'none'`。

设置写入串行化并递增版本；`storage.local` 限制为受信上下文，content script 经后台读取设置。权限撤销、总关闭或失效上下文停止运行；无法再访问的旧页面显示需要刷新清理。

## 4. 通用提取：无网站专用适配器

不使用域名白名单、URL 路由模式、私有 class、`data-testid` 或专用帖子选择器。

优先选择标题、段落、列表项、引用、图注、定义列表与标准 heading 角色。对缺少这些标签的页面，识别具有 block／flow-root／list-item／inline-block 自然流布局、足够自然文字且子级为行内内容的最小容器；自定义标签也适用。最小文字块选中后不再递归重复提取其视觉行；纵向 flex 文字列按完整段落处理。嵌套语义块去重，作者区域、时间、导航、按钮和工具栏排除。

提取遍历可见文本节点，保留同段强调和链接的文字，不重写原节点。不读取 `body.innerText`、整页 HTML 或表单 `.value`。排除脚本、样式、模板、pre、SVG、Canvas、iframe、表单、输入区、contenteditable、role=textbox／log、hidden、aria-hidden、translate=no、.notranslate 和插件拥有的节点。

短标题仅可从有限、同一自然内容容器继承语言证据，不使用全页语言兜底。通用规则无法识别全部私信或敏感页面，网站规则和本地处理是明确边界，不能承诺根据 DOM 自动辨认全部隐私场景。

## 5. 身份与动态内容

块保存元素锚点、规范化原文、revision、entryKey、运行 generation、状态和拥有的译文节点。来源身份使用最近标准 article／list item 的 WeakMap 身份，补充标准 bookmark 链接、时间或普通 permalink；没有某个站点的 status URL 模式。

回写前同时检查：运行仍有效、generation／revision 一致、元素连接、原文精确相同、来源身份相同、语言提示与当前规则有效。节点换文、同节点换条目、导航、关闭和设置变更使旧结果失效。底层不可取消的迟到结果也不能插入。

MutationObserver 批处理相关变更，忽略插件自身写入；IntersectionObserver 优先视口及下方一个视口，后台暂停新翻译。因布局保护跳过的块记录布局指纹，ResizeObserver、相关 DOM 变更与滚动后在尺寸／约束变化时重新评估，不对语言不确定的块盲目放宽。新增角色、编辑状态或不翻译标记会清理已有输出，局部lang变化使块版本失效。SPA 用 DOM 变化和运行中的有限 URL 变化检查，不修改页面 history API；pagehide 停止，bfcache pageshow 重新读取设置。

按运行代次隔离 pump，旧 provider 未返回也不会阻塞新一轮。断开的节点移除引用，远离视口的记录设数量约束。恢复原文仅删除自有节点，不以旧 DOM 快照覆盖网站状态。

## 6. 语言和本地模型

源语言 en／fr／es／de／ja／ko，目标仅 zh-CN。Chrome provider 映射为目标 `zh`，英中方向已有简体中文实测，其他方向按当前设备 availability 启用，不冒充已完成逐方向质量验收。

LanguageDetector 输出候选和置信度，分类为 match／non_match／unknown：

- 长文本起始要求至少 40 个有效字母、首选为源语言、置信度 ≥ 0.85、领先 ≥ 0.20。
- 足够长的中短标题可在更严格阈值（≥24 字母、至少4词、置信度≥0.98、领先≥0.80）下独立通过。
- 其他短标题仅在局部一致证据下继承；英语少于3词保持未知，不将 Paris／AI 等直接当英文。
- 局部显式 lang 可否决相反源语言，但 html.lang 不能代替检测。
- 多句混合文本按 Intl.Segmenter 句界分别判断，仅翻译源语言句；未知或其他语言跳过。

这些阈值尚未完成独立语料校准，不是准确率保证。主动查译无法确认语言时由用户点击确认继续。[Language Detector](https://developer.chrome.com/docs/ai/language-detection)

`LocalEngine` 每文档、每方向复用 Translator / LanguageDetector 会话；自动阅读仅在模型 available 时创建，不在网页偷偷触发下载。请求合并外部取消、引擎生命周期和 15 秒执行超时，结果只接受有界纯文本，使用 textContent 写入。

每次 translate 与具体块闭包绑定，不跨上下文传递正文，也没有远程 segment ID 协议。较长块按句和字符预算拆分后回到原块展示。准备缺包／不支持时停止自动重试并提供设置入口；普通块临时失败最多重试一次。浏览器模型本身的翻译质量仍需人读验收。[Translator](https://developer.chrome.com/docs/ai/translator-api)

## 7. 排版与学习浮层

在合法文本容器内追加自有 span，不替换、移动或包裹原文，不新增链接或可聚焦元素。整卡链接内的译文设 aria-hidden，保留该链接原有可访问名称。普通译文标注 zh-CN，不使用 aria-live。

正文字号为原文的85%，最小12／14／16 px 可选；标题和原字号≥24px的展示／引用文字译文上限18px，且常规字重；实色次级文字、无底色边框、5px 间距、1.6 行高。对可解析的纯色祖先背景计算4.5:1目标对比度；背景图片、渐变、复杂透明叠加和高级色彩空间仍需加强验证。

排除紧凑控件、窄单元格、flex／grid 文字容器、固定定位和 line-clamp 等风险区域；插入前后检查裁切、重叠和新增横向溢出。横向轮播以原文容器边界为准，不因卡片本来部分超出视口就否决翻译，也不把页面已有溢出归咎于译文。不修改网站的高度、overflow 或全局样式，不安全则回滚。宽表格中明确的段落可在布局检查后翻译。

选择查译最多1,000字符，原句参考最多500字符；入口需点击才调用翻译。浮层使用独立 Shadow DOM，支持复制、Esc、外部点击／滚动／失焦关闭和视口避让；异步结果复核原选区和页面地址。选区与敏感排除区域相交时不可查译。

## 8. 设置、缓存与生命周期

自动开关与所有网站范围分别持久化；关闭所有网站范围时仅 always 记录可自动处理，先保存范围再请求撤销宽泛权限。原生授权失败回滚 UI 单选状态，不保存已获得访问的假象。总关闭优先于网站 always，网站 never 禁止自动处理，当前页恢复在本 document 内暂停；主动“翻译当前页”可覆盖暂停／网站自动禁用，但不改持久规则。规则按 origin 精确匹配，不扩展到子域。未知存储 schema 保守关闭自动翻译。

设置保存本机。正文／译文仅当前文档内存，不跨站共享，不写磁盘或日志。翻译 LRU 上限1,000项或5MiB，检测缓存单独上限1MiB，关闭释放会话和缓存；可主动清除。

worker 不承载正文任务，终止后设置读取／写入可唤醒恢复。正文缓存可丢，开关设置不可丢；不依赖无业务意义的 ping 保持 worker 常驻。[worker 生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)

## 9. 正式首版预算与分发

下表是**待测目标**，不作为本预览版实测指标：

| 指标 | 目标 |
| --- | --- |
| 热状态首块译文 | 100段、20次独立测量，p95 ≤ 2秒 |
| DOM 工作 | 分片目标 < 16ms，无插件引入的 >50ms long task |
| 关闭清理 | 当前页 p95 ≤300ms；其他可达页≤1秒收到停止 |
| 压力 | 20次开关、200次复用后无重复／持续内存增长 |
| 布局 | 无新增横向滚动、遮挡和失效控件 |

构建脚本固定依赖版本，打包仅收集 dist、安装说明、隐私说明和 MIT。ZIP 根目录直接有 manifest，附 SHA-256。GitHub CI 执行 npm ci、类型检查、单测、构建和打包；真实模型回归在独立桌面 Chrome 执行。原始用户附件、个人 Chrome 配置、私有证据和本地规划不会发布。
