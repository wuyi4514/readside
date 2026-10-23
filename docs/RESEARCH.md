# 规格依据与待验证假设

核实日期：2026-10-23。仅采用官方浏览器资料作为技术依据；以下是产品设计研究，不是本项目插件测试结果。

## 已确认与设计推论

| 官方事实 | 对本项目的设计含义 | 依据 |
| --- | --- | --- |
| Chrome 能力矩阵列出 Translator / Language Detector 的桌面 Web 与扩展支持，起始为 Chrome 138 | 本地引擎值得优先验证；不能由版本号直接推定设备可用 | [内置 API 矩阵](https://developer.chrome.com/docs/ai/built-in-apis) |
| Translator 提供语言方向探测与本地翻译，翻译调用按序处理 | 能力探测、方向适配、可见块优先和单队列 | [Translator API](https://developer.chrome.com/docs/ai/translator-api) |
| 准备模型可能需要下载与用户激活 | 首次准备有明确点击、状态和失败处理；后续自动运行单独验收 | [Get started](https://developer.chrome.com/docs/ai/get-started) |
| Language Detector 输出候选与置信度，短词检测不可靠 | 使用块级证据与 unknown；不以拉丁字母等同英语 | [Language Detector](https://developer.chrome.com/docs/ai/language-detection) |
| 扩展还有 CLD 语言检测接口 | 可保留独立适配器；比例和可靠标记不等于其他模型置信度 | [i18n API](https://developer.chrome.com/docs/extensions/reference/api/i18n) |
| content script 可操作页面 DOM，并处于独立执行环境 | 页面提取、翻译计算和插入职责分离 | [Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) |
| 扩展脚本注入与站点访问需要声明／授予相应权限 | 全局自动翻译和当前页主动处理使用不同的授权路径 | [权限声明](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)、[权限 API](https://developer.chrome.com/docs/extensions/reference/api/permissions) |
| 取消脚本注册不会自动清理已经注入的脚本 | 关闭必须向页面发 stop 并显式移除显示 | [Scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting) |
| MV3 service worker 可能终止，内存状态会丢失 | 持久设置、文档身份和握手恢复是必需设计 | [生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) |
| offscreen 具备 Window，但不可聚焦，且有枚举用途要求 | 只能作为待验证候选，不直接认定可承载本地翻译 | [Offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen) |
| 扩展存储可分本地与同步区域 | 首版只落本地设置，不保存正文、不用同步 | [Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage) |

以上“设计含义”是本项目根据资料作出的推论，不是浏览器官方对本插件兼容性、性能或体验的背书。

## 当前待验证项

1. 本地模型在实际扩展执行上下文可用，准备一次后可跨新 origin 自动处理。
2. 关闭 popup、worker 休眠、浏览器重启后不要求用户逐站重新点击。
3. 英语到简体中文在目标设备上的真实质量、性能、方向映射和语言包可用性。
4. offscreen 若采用，有实际匹配用途和正确激活路径；不能以文档具备 Window 就视为通过。
5. 布局保护在真实官网、博客与 X 中既保结构又有足够翻译覆盖。
6. 短标题和多语言段落的阈值能平衡误翻与漏翻，必须用独立标注语料检验。
7. 对不规则背景、渐变和动态主题的译文对比度，不能只依赖静态颜色公式。

## 用户参考图的使用方式

参考图用于理解“标题下方、描述下方”的对照位置与弱化层级。图中内容、型号、日期不作为产品事实来源。原始附件不纳入公开仓库；实现验收可使用独立构造的同类三列卡片夹具，再验证真实公开网页。

## 未采用的依赖

- 不使用抓取的非官方免费翻译接口。
- 不发布共享密钥，也不假定公众使用成本由项目方无限承担。
- 不依赖远程可执行代码、浏览器实验 flags、每站人工点击或常驻准备页作为正常自动阅读前提。
- 不将其他 Chromium 浏览器当作 Chrome 内置模型的同等环境。
