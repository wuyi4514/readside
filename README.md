<p align="center">
  <img src="assets/icons/128.png" width="72" height="72" alt="Readside">
</p>
<h1 align="center">Readside</h1>
<p align="center">保留原文，让译文陪你读懂每一页。</p>
<p align="center">
  <a href="https://github.com/wuyi4514/parallel-read/releases/latest">下载</a> ·
  <a href="docs/INSTALL.md">安装指南</a> ·
  <a href="docs/USAGE.md">使用指南</a> ·
  <a href="PRIVACY.md">隐私说明</a> ·
  <a href="CONTRIBUTING.md">参与贡献</a>
</p>
<p align="center">
  <a href="https://github.com/wuyi4514/parallel-read/releases/latest"><img src="https://img.shields.io/github/v/release/wuyi4514/parallel-read?color=3266e8&label=version" alt="GitHub Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-3266e8" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/Chrome-138%2B-3266e8" alt="Chrome 138+">
</p>

Readside 是一个开源的网页对照翻译插件。在标题和段落下方显示译文，保留网页原有的内容、链接和交互，帮助你阅读外文网站，也在阅读中学习语言。

![Readside 网页对照阅读](docs/images/reader.png)

## 功能

- **对照阅读**：原文与译文逐块对应，译文使用更轻的字级和颜色。
- **多语言**：源语言可多选，目标语言单选，支持英语、法语、西班牙语、德语、日语、韩语和简体中文。
- **自动翻译**：为所有已授权网站开启，或只在单独允许的网站使用。
- **当前页操作**：随时翻译当前页、恢复原文，不必修改全局偏好。
- **词句查译**：选择文字后查看翻译，支持复制原文、译文和查看原句参考。
- **阅读设置**：支持明暗主题、译文最小字号和动态加载内容。
- **本地处理**：使用 Chrome 内置翻译能力，无需 API Key，不上传网页正文。

Readside 依据通用内容语义和布局识别阅读区域，不依赖特定网站的域名、私有 class 或帖子标记。为保持页面布局，按钮、导航和空间受限的组件可通过选择词句查译。

## 安装

1. 前往 [Releases](https://github.com/wuyi4514/parallel-read/releases/latest)，下载 `readside-0.2.2.zip` 并解压。
2. 在桌面 Chrome 打开 `chrome://extensions`，开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择直接包含 `manifest.json` 的目录。
4. 固定 Readside，打开设置，选择语言并下载对应语言包。

开启自动翻译并授予网站访问权限后，打开网页即可开始对照阅读。详细步骤见[安装指南](docs/INSTALL.md)。

## 使用

默认将英语翻译为简体中文。你可以选择多种源语言，并将它们统一翻译成一个目标语言；未选择的语言保持原样。

语言包按源语言与目标语言分别准备，圆环显示下载进度，可取消和重新下载。与目标语言相同的内容无需翻译。可用语言方向由当前 Chrome 的本地翻译能力决定。

<details>
<summary>查看设置界面</summary>

![Readside 设置](docs/images/settings.png)

</details>

更多操作和常见问题见[使用指南](docs/USAGE.md)。

## 隐私

网页文字只在浏览器本机处理。Readside 没有项目服务器、账号、广告或遥测，也不会在本地翻译不可用时改用云服务。首次准备语言包时，Chrome 会连接其自身服务下载模型。

开关、语言、字号和网站规则保存在本机；正文和译文使用有限内存缓存。详见[隐私说明](PRIVACY.md)。

## 兼容性

需要支持内置 Translator 和 Language Detector 的桌面 Chrome，最低版本为 138。设备条件、浏览器策略、存储空间和语言方向会影响本地模型可用性。

主要面向普通 HTTPS 网页。浏览器内部页面、扩展商店、内置 PDF、图片、视频、跨域 iframe 和封闭 Shadow DOM 不属于自动翻译范围。

## 从源码构建

需要 Node.js 24 和 npm。

```sh
git clone https://github.com/wuyi4514/parallel-read.git
cd parallel-read
npm ci
npm run build
```

构建输出在 `dist/`，可直接加载到 Chrome。执行 `npm run package` 可生成分发 ZIP。

## 文档与贡献

- [安装指南](docs/INSTALL.md)：安装、更新与语言包准备。
- [使用指南](docs/USAGE.md)：日常操作、语言设置和常见问题。
- [产品规格](SPEC.md)：功能行为、设置规则与阅读体验。
- [技术架构](docs/TECHNICAL_SPEC.md)：模块职责、消息、生命周期与本地引擎。
- [更新记录](docs/CHANGELOG.md)：各版本的功能与改进。
- [贡献指南](CONTRIBUTING.md)：本地开发、代码约定与提交方式。

欢迎通过 [Issues](https://github.com/wuyi4514/parallel-read/issues) 提交建议和兼容性问题。分享页面样例前，请去除个人信息与登录凭据。

## License

[MIT](LICENSE) © 2026 wuyi4514.
