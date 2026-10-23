# Parallel Read · 对照读

Read the English web, with quiet Chinese translations right below the original.

保留英文原文，在下方显示轻量中文译文。看懂产品官网、博客和 X，也能在日常阅读中学习英语。

> **项目状态：规格阶段。当前没有可安装的插件或下载版本。**
>
> **Status: specification only. There is no installable extension or release yet.**

## 计划提供的体验

- 开启自动翻译后，在已授权的网站上自动显示对照译文。
- 标题、段落、卡片和帖子逐块对照，译文较小、较轻，保留网站原有风格与交互。
- 默认仅翻译英语，目标语言为简体中文；法语、西语等内容不会因为出现在英文网站上就被自动翻译。
- 支持选择要翻译的源语言，并为未来日语、韩语等目标语言预留扩展能力。
- 选择单词或句子后按需查看译文，帮助理解词句在当前语境中的含义。
- 一键关闭并移除插件译文；不会用中文替换英文原文。

## 首版设计取舍

首版面向桌面 Chrome，采用 Manifest V3，计划优先使用 Chrome 的本地翻译能力，无须用户填写 API Key。首次使用可能需要准备语言包；运行时能力检测和扩展内的自动执行验证是实现前的必要步骤。[Chrome 官方能力说明](https://developer.chrome.com/docs/ai/built-in-apis)

正文和可伸展卡片采用“原文在上、译文在下”。固定高度按钮、紧凑导航等区域若无法安全容纳双语，则提供按需查阅。对照文字可以增加正常内容高度，组件的点击、焦点和布局约束必须保留。

默认不连接项目服务器，也不自动转用云翻译。对 Edge、Firefox、Safari、移动端和受浏览器保护的页面，暂不承诺支持。

## 规格文档

| 文档 | 内容 |
| --- | --- |
| [SPEC.md](SPEC.md) | 用户场景、首版范围、交互、排版、语言策略和版本边界 |
| [技术规格](docs/TECHNICAL_SPEC.md) | DOM 分段、翻译接口、状态、权限、恢复与性能 |
| [验收清单](docs/ACCEPTANCE.md) | 可执行用例、真实网站验证和发布条件 |
| [调研依据](docs/RESEARCH.md) | 官方资料、已确认能力、待验证假设 |
| [隐私设计](PRIVACY.md) | 首版计划处理的数据和边界 |

文档中的功能、指标和里程碑均为待实现要求，不能视为已经通过测试的能力。

## 下载与安装

目前请勿将 GitHub 的源码 ZIP 当作可安装插件。完成开发和验收后，计划通过本仓库的 GitHub Releases 提供包含 `manifest.json` 的构建 ZIP、校验值和中文安装说明。Chrome Web Store 上架属于后续独立事项。

## 参与与反馈

欢迎通过 [Issues](https://github.com/wuyi4514/parallel-read/issues) 讨论规格、网站兼容问题和学习体验。报告问题时请移除页面中的个人信息；不要公开提交登录后的私人内容、访问令牌或浏览记录。

## License

[MIT](LICENSE) © 2026 wuyi4514. Third-party websites and browser-provided models retain their respective licenses and terms.
