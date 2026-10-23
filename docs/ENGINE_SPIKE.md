# 本地翻译引擎验证

日期：2026-10-23。环境：macOS，桌面 Google Chrome 155.0.8059.85，独立测试 profile；未启用 AI 实验 flags，未读取用户个人 profile。

## 已实测

1. 扩展页面通过真实按钮点击启动 Translator / LanguageDetector 的语言包准备；初始状态为 downloadable。
2. 观察到真实下载进度，下载完成后输出 `与您的团队一起构建更好的产品。`；输入为 `Build better products with your team.`。
3. 关闭所有扩展准备页面，通过静态 isolated content script，在 `https://example.org` 和 `https://example.net` 的 document_idle 自动创建会话并翻译。两次 `navigator.userActivation.isActive` 均为 false，方向状态均为 available。
4. 带 `default-src 'none'; style-src 'none'` 的安全 localhost 夹具同样完成真实翻译，无需点击。
5. 完整关闭并重新启动隔离 Chrome 后，重新载入测试扩展，新页面无用户激活地复用已下载模型并返回相同中文。无需重新下载或点击准备。

## 已确定的实现选择

读取、语言判断、翻译和插入均在每个网页自己的 isolated content script 中执行。Options 页面只负责首次准备和自检。无需 offscreen、后台常驻窗口、云服务、共享密钥或主世界注入。

## 证据限制

使用官方 CDP `Extensions.loadUnpacked` 的自动化安装方式类似命令行加载，只在当前浏览器进程加载扩展。重启后需要测试工具重新加载；这一步不是用户点击，也没有重新准备模型。**该测试证明模型缓存与会话重建可用，不等同于已完成普通 UI 安装后的扩展持久性验收。**

完整插件另已验证动态注册、设置持久化和 worker 终止后的处理；权限原生提示、下载取消和离线异常仍待验收，见[验证报告](VALIDATION.md)。

准备过程曾因测试原型新增 manifest 权限后 reload 被 Chrome 禁用；修正为重新安装原型后验证。该事件是安装／权限变化行为，不是翻译 API 不可用。

官方依据：[Translator API](https://developer.chrome.com/docs/ai/translator-api)、[Language Detector](https://developer.chrome.com/docs/ai/language-detection)、[CDP Extensions](https://chromedevtools.github.io/devtools-protocol/tot/Extensions/)。


## 0.2.0 多语言引擎修订（2026-10-23）

上述 M0 记录属于早期英语→简体中文方向，不可直接推广到所有语言。扩大语言后发现，在新网页上，部分已缓存的语言方向仍报告 downloadable，并要求该来源的首次用户激活；仅在设置页下载后让每个网页直接 create 不能满足完整多语言自动运行。

0.2.0 改为扩展来源的 offscreen Window 执行 native API，实际专用 Worker 管理有界队列、取消和过期任务。页面只提取、筛选、缓存与渲染；纯文本片段经受信扩展内部 RPC 流转，不上传。首次准备依然在真实设置页按钮手势内完成。需要新增 offscreen 权限，原因 WORKERS 与真实实现一致。

已在独立 Chrome155 配置中通过六种源语言→简体中文、关闭设置页后新 HTTPS origin 自动执行；下载圆环取消／重试也在另一个全新 profile 真实执行。方向切换和当前回归结果以 VALIDATION.md 与结构化检查为准，未以 CDP userGesture 冒充网页自动执行。

参考：[Translator 的来源状态与激活要求](https://developer.chrome.com/docs/ai/translator-api)、[offscreen](https://developer.chrome.com/docs/extensions/reference/api/offscreen)。
