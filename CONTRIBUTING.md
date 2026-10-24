# 贡献指南

欢迎为 Readside 提交功能改进、界面优化、文档修订和网页兼容性修复。

## 本地开发

需要 Node.js 24、npm 和桌面 Chrome。

```sh
git clone https://github.com/wuyi4514/readside.git
cd readside
npm ci
npm run build
```

在 `chrome://extensions` 中开启开发者模式，加载 `dist/` 目录。运行 `npm run dev` 可持续构建源码；构建后重新加载扩展并刷新网页。

执行 `npm run package` 可在 `releases/` 中生成 ZIP 与 SHA-256 文件。

## 项目结构

| 目录 | 内容 |
| --- | --- |
| `src/background` | 设置、权限、脚本注册、引擎路由与工具栏状态 |
| `src/content` | 内容提取、语言筛选、布局保护与词句查译 |
| `src/providers` | 本地与在线引擎、后台文档、队列与会话 |
| `src/shared` | 设置、消息和缓存合同 |
| `src/ui` | 弹窗、设置与共享控件 |
| `assets` | 品牌图标 |
| `docs` | 安装、使用与技术文档 |
| `scripts` | 构建、打包与开发工具 |

## 实现约定

- 使用通用内容语义与布局约束，避免按网站域名、私有 class 或专用帖子标记编写特例。
- 保留原文字、链接、节点顺序和网站事件；译文使用插件拥有的节点。
- 使用纯文本传递与渲染结果，不将模型输出作为 HTML 执行。
- 新增异步工作时，处理关闭、导航、语言切换和迟到结果。
- 正文与译文保留在浏览器本机，不添加隐式联网回退或遥测。
- 沿用共享颜色、字号、间距与控件，并提供清晰的键盘焦点。

## 提交修改

较大的功能和行为变更可先在 [Issues](https://github.com/wuyi4514/readside/issues) 说明使用场景。提交 Pull Request 时描述问题、修改后的行为以及涉及的界面或文档；界面改动可以附上不含个人信息的截图。

提交内容应聚焦一个明确问题。请勿包含构建目录、浏览器配置、语言模型、凭据或私人网页资料。

贡献遵循仓库的 [MIT 协议](LICENSE)。
