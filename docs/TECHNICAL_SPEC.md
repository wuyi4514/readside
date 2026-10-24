# 技术架构

Readside 使用 TypeScript、Manifest V3、原生 HTML/CSS 和 esbuild。发布包包含本地构建的扩展资源，不依赖远程脚本或项目后端。

## 执行上下文

| 上下文 | 职责 |
| --- | --- |
| Content script，isolated world | 提取网页文字、筛选语言、调度可见内容、插入译文和词句查译 |
| Background service worker | 设置与权限、动态脚本注册、标签页状态、受信消息路由 |
| Options | 设置、本地模型检查与下载、网站范围管理 |
| Popup | 当前页状态、语言选择、自动开关、主动翻译和恢复 |
| Offscreen document | 扩展来源下的本地 Translator 与 LanguageDetector 会话 |
| Dedicated Worker | Offscreen 内的有界任务排队、串行调度和取消 |

用户在设置页的点击中准备语言模型。准备后，网页片段通过扩展内部消息送往本机 offscreen 上下文，调用已就绪的本地模型。Popup 和 Options 无需保持打开。

Offscreen 使用 `WORKERS` 原因，并实际创建队列 Worker。它不注入网页主世界，也不创建可见的常驻窗口。后台按需创建并连接 offscreen；不使用空闲 ping 保持 service worker 常驻。

## 源码结构

| 路径 | 职责 |
| --- | --- |
| `src/background/` | 设置写入、权限对账、脚本注册、原生任务宿主 |
| `src/content/extractor.ts` | 通用语义块、自然文本边界、排除区域与来源身份 |
| `src/content/language.ts` | 内容块和句子的语言筛选 |
| `src/content/controller.ts` | 文档代次、调度、动态内容和旧结果隔离 |
| `src/content/renderer.ts` | 译文节点、样式与布局保护 |
| `src/content/selection.ts` | 选择查译与 Shadow DOM 浮层 |
| `src/providers/` | 本地与在线引擎、语言检测、缓存和取消 |
| `src/shared/` | 设置合同、消息校验和有界缓存 |
| `src/ui/` | 弹窗、设置、自定义选择器与语言包状态 |
| `scripts/build.mjs` | 资源复制和 JavaScript 构建 |
| `scripts/package.mjs` | 发布 ZIP 与 SHA-256 文件 |

处理流程：权限与设置 → 内容提取 → 可见性排序 → 语言与布局判断 → 所选服务翻译 → 身份核对 → 插入或回滚。

## 通用内容提取

提取器不依赖域名、私有 class、`data-testid` 或网站专用帖子选择器。

标题、段落、列表项、引用、图注和定义列表优先作为自然内容块。对缺少语义标签的页面，结合计算布局与文本结构选择最小的完整文字容器。段落内的强调和普通链接保留为整体上下文，嵌套块去重。导航、按钮、菜单、侧栏和表格中的可见文字同样参与扫描；混合容器中的孤立文字采用可撤销的行内包装，恢复时解包原文字节点。

文本从可见节点读取，不读取整页 HTML 或表单值。脚本、样式、模板、代码区域、SVG、Canvas、iframe、输入区、编辑器、标准聊天日志、隐藏区域、`translate=no`、`.notranslate` 和插件自身节点均被排除。

公开页面和私密页面无法仅凭 DOM 完整区分，因此内容排除与用户的网站授权共同决定运行范围。

## 文档与内容身份

每个内容块保留元素锚点、规范化原文、revision、entryKey、运行 generation、处理状态和自有译文节点。来源身份基于通用 article、列表项、bookmark 链接和时间信息，不采用网站专用 URL 模式。

异步结果回写前检查运行代次、内容版本、元素连接状态、原文、来源身份和语言设置。节点换文、条目复用、页面导航、恢复原文或设置变更都会使旧结果失效。

MutationObserver 合并相关变更并忽略自有节点写入；IntersectionObserver 优先安排视口及附近内容。ResizeObserver 和布局指纹使展开或尺寸变化后的内容可重新判断。页面隐藏时暂停新任务；pagehide 释放，bfcache 恢复时重新读取设置。

恢复原文只删除 Readside 拥有的节点和属性，不使用历史 DOM 快照覆盖网站的新状态。

## 语言路由

应用语言标识为 `en`、`fr`、`es`、`de`、`ja`、`ko`、`zh-CN`；调用浏览器 API 时将简体中文映射为 `zh`。

`DocumentEngine` 按用户选择的服务路由。本地模式共享文档内的检测结果，按源语言将内容路由到不同方向的 `LocalEngine`；在线模式使用 `OnlineEngine`，翻译与检测缓存仍按文档隔离。源与目标相同的内容跳过。每个本地方向独立检查能力和准备状态，缺少某个方向不阻塞其他方向。

LanguageDetector 结果被分类为匹配、非匹配和未知。较长内容要求足够的置信度与候选差距；短文本结合置信度、局部容器或正文段落的语言证据判断。局部显式 `lang` 可否决冲突来源，整页 `lang` 不代替检测。混合段落通过 `Intl.Segmenter` 按句判断。

导航与短按钮也参与语言判断，不仅依据字符集认定源语言。在线模式使用 chrome.i18n.detectLanguage，isReliable=false 时限制其置信度；附近上下文仅用于本地判断。主动查译可由用户确认后继续。

## 翻译服务与消息边界

Content script 的请求由扩展身份、顶层 documentId、来源 URL、操作类型、语言参数和长度共同约束。单条原生 RPC 的纯文本上限为 4,000 字符；长内容按句与字符预算拆分，结果回到原内容块。

Offscreen 会话按 documentId 和 client ID 隔离；设置变化产生新的运行代次。请求合并外部取消、引擎生命周期和 15 秒执行超时。即使底层原生调用迟到返回，旧任务也不能回写页面。

Offscreen Port 仅接受本扩展的准确页面来源。原网页没有可调用的翻译代理；不开放 `externally_connectable`、`postMessage` 桥或任意联网 URL。扩展页 CSP 的连接白名单仅允许 Google 与 Microsoft 服务主机。在线请求经后台固定协议路由，校验当前服务、语言、长度与主机权限，使用无凭据、无 referrer 的请求，不接受任意 URL。

只有受信的 Popup 和 Options 可写设置。写入串行化并递增版本；`storage.local` 仅对受信上下文开放，content script 经后台读取。未知设置 schema 保守关闭自动翻译。

## 渲染与布局保护

渲染器在合法位置插入自有文本节点，不使用 innerHTML 重写原文；混合容器中的孤立文本节点按需使用可撤销的行内包装。整卡链接不新增链接或焦点元素，并保留原有可访问名称。普通译文标注目标语言，不使用 `aria-live`。

译文采用原字号的 85%、可选最小字号、1.6 行高和约 5 px 间距。大字号展示文字的译文上限为 18 px。按绘制顺序合成半透明背景后计算次级文字颜色；颜色解析支持 sRGB，现代 CSS 颜色由浏览器画布解析。对可见译文监听 hover、焦点和颜色过渡；复杂背景沿用保守的可读性策略。

原文有行数限制时，父容器必须为可容纳纵向内容的布局，译文才可插入原文之后，原有行数限制保持不变。固定空间、紧凑控件和其他高风险布局在插入前判断；插入后检查裁切、相对于原布局新增的重叠和横向溢出，保留网站原有负间距形成的排版关系。不安全时回滚，不修改网站高度或 overflow。

Google 使用公开网页翻译端点；Microsoft 使用 Edge 网页翻译端点，不依赖项目服务器。在线任务合并取消与 20 秒超时，错误和限流保持在用户选定服务内，不静默切换；切换服务使文档引擎、缓存及旧结果失效。本地模型准备只在本地模式显示。

## 缓存与资源回收

原文和译文仅驻留内存，不写入磁盘日志，也不跨网站共享。翻译 LRU 上限为 1,000 项或 5 MiB，检测缓存上限为 1 MiB，Worker 队列上限为 512 项。任务结束后移除队列正文，导航、关闭标签页或释放文档时清理关联会话。

设置存储独立于可丢弃的正文缓存。后台 worker 重启后按持久设置恢复权限与注册；模型由浏览器管理。

## 权限

必需权限为 `storage`、`scripting`、`activeTab` 和 `offscreen`。可选站点权限覆盖 HTTPS；本地开发地址限于 localhost 和 127.0.0.1。不申请浏览历史、Cookie、网络拦截或剪贴板读取权限。

自动脚本只在已授权范围注册，并随设置和权限变化对账。临时 `activeTab` 支持用户主动操作当前页，不代替持续自动运行的网站授权。网站设置按 origin 精确匹配。

## 控件与语言包

`ProductSelect` 为多选源语言、单选目标语言和字号提供共享的可访问 listbox。Popover 保持菜单在卡片裁切之外，支持方向键、Home、End、Enter、Space、Esc 和 Tab。勾选标记使用固定 viewBox 的 SVG，避免字体基线造成偏移。

单选项保留原生输入语义并使用统一外观。翻译卡片显示完整方向；Chrome 的 `downloadable` 可能隐藏已有缓存，因此映射为“待准备”，仅用户点击“准备”后创建会话。圆环直接绑定浏览器 `downloadprogress.loaded`，没有数值时显示准备状态，不模拟百分比。目标变更取消旧任务，使旧进度与完成回调失效；返回已有方向时重新探测可用性，不由 Readside 删除浏览器模型。

工具栏使用静态工作环与页面状态提示，弹窗内使用支持 reduced motion 的旋转环。

## 构建与分发

依赖锁定在 `package-lock.json`。构建结果位于 `dist/`；打包收集扩展资源、安装说明、隐私说明和 MIT 许可证，ZIP 根目录直接包含 manifest，并生成 SHA-256 文件。发布文件以 `readside-<version>.zip` 命名。

## 参考

- [Chrome Translator API](https://developer.chrome.com/docs/ai/translator-api)
- [Chrome Language Detector API](https://developer.chrome.com/docs/ai/language-detection)
- [Extension permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
- [Scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [Offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [Service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
