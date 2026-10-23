# Parallel Read · 对照读

Read the English web, with quiet Chinese translations below the original.

保留英文原文，在标题和段落下显示轻量中文译文。看懂网站，也在阅读中学习英语。

**当前版本：`0.1.0-preview.1` 开发预览。** 已实现 Chrome 插件并通过本地模型和真实网页验证；完整首版验收尚未完成。请先在自己的常用网页试用，具体证据和限制见[验证报告](docs/VALIDATION.md)。

[下载构建包](https://github.com/wuyi4514/parallel-read/releases/tag/v0.1.0-preview.1) · [中文安装说明](docs/INSTALL.md) · [反馈问题](https://github.com/wuyi4514/parallel-read/issues)

![原创测试页面上的实际对照翻译](docs/images/reader.png)

## 已实现

- 自动对照开关、当前页翻译和恢复原文、按网站设置规则。
- 标题和正文分块对应；译文较小、较轻，保留原始节点、链接和交互。
- 默认仅翻译英语到简体中文；逐块检测语言，同页法语、西语等不随英文一并翻译。
- 可选择英语、法语、西班牙语、德语、日语、韩语作为源语言，具体可用性由设备检测；目标目前固定简体中文。
- 选择词句后点击查译，可复制原文／译文、查看原句参考。
- 动态新增内容、文本更新、列表节点复用保护，以及明暗主题和最小字号设置。

采用**通用内容语义、自然文本边界和布局检查**，不依赖特定网站域名、私有 class、测试标记或专用帖子选择器。网站换框架或修改标记后，仍按同一套内容规则识别。复杂布局可能保守跳过，无法承诺覆盖所有网站或每一段文字。

紧凑按钮、导航、菜单和裁切区不强行插入译文，可选择文字查译。普通内容允许自然增高；原文始终保留。

## 本地翻译

桌面 Chrome、Manifest V3。使用 Chrome Translator / Language Detector，首次需要用户点击准备语言包，之后在已授权网页自动执行。无需 API Key，无项目方服务器、遥测或云翻译回退。[Chrome 官方能力说明](https://developer.chrome.com/docs/ai/built-in-apis)

当前实测 Chrome 155 / macOS。Manifest 基线为 Chrome 138，仍需设备、策略、存储空间与语言方向检查；其他 Chrome 版本、系统和浏览器尚未完成验证。主要支持 HTTPS；PDF、图片、视频、跨域 iframe 和封闭 Shadow DOM 不覆盖。

表单、编辑器、隐藏内容和标准聊天日志区域排除。通用 DOM 规则不能识别所有私密页面，敏感网站可关闭自动翻译。正文和译文仅保留有限内存缓存，网站规则存本机，详见[隐私说明](PRIVACY.md)。

## 从源码构建

需要 Node.js 24 LTS 和 npm。运行：

```sh
npm ci
npm run package
```

`dist/` 可在 `chrome://extensions` 中加载；`releases/` 包含可安装 ZIP 和 SHA-256。GitHub 自动生成的 Source code ZIP 需要先构建。

验证命令：

```sh
npm run check           # 类型检查、单元测试、构建
npm run browser:start   # 启动独立 Chrome 测试配置，按提示准备模型
npm run test:browser    # 使用真实本地模型的浏览器回归
```

浏览器测试需要支持 CDP 扩展调试的桌面 Chrome，默认本机端口 9327；测试模型与 profile 放在被忽略的 `.private/`。`CHROME_PATH` 可指定 Chrome 路径。CI 执行类型检查、单测、构建和打包；不会把无模型的 CI 结果冒充真实翻译验收。

## 文档

| 文档 | 内容 |
| --- | --- |
| [安装说明](docs/INSTALL.md) | 下载、准备模型、授权和日常使用 |
| [验证报告](docs/VALIDATION.md) | 已执行的检查、真实网页观察和待验证项 |
| [产品规格](SPEC.md) | 用户场景、阅读体验和正式首版目标 |
| [技术规格](docs/TECHNICAL_SPEC.md) | 通用提取、版本保护、权限与实现结构 |
| [完整验收清单](docs/ACCEPTANCE.md) | 正式首版验收要求；不等于全部已通过 |
| [引擎验证](docs/ENGINE_SPIKE.md) | 本地模型准备、跨 origin 和自动执行证据 |
| [调研依据](docs/RESEARCH.md) | 官方资料与设计依据 |

欢迎通过 Issues 提供脱敏后的兼容性样例。请勿上传私人页面、登录凭据、令牌或浏览记录。

## License

[MIT](LICENSE) © 2026 wuyi4514. Third-party websites and browser-provided models retain their respective licenses and terms.
