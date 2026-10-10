# ✦ Local Image Studio

一个运行在本机的轻量级 AI 图像生成工作台。它提供连接配置、多参考图管理、提示词编辑和本地生成历史，不依赖 SillyTavern，也不需要安装前端框架。

> 当前版本：`0.2.0`<br>
> 界面语言：俄语<br>
> 运行环境：Node.js 20 或更高版本

## 功能

- 创建多个独立的连接配置；
- 每个配置可保存不同的 API 类型、Endpoint、密钥、模型和图像参数；
- 每个连接配置可单独启用带认证信息的 HTTP/HTTPS 代理；
- 支持 Gemini-compatible、OpenAI-compatible 和 OpenRouter；
- 一次上传多张参考图；
- 创建、复制、重命名和删除参考图配置，一键切换不同的图片组合；
- 在每个参考图配置中单独启用或停用图片；
- 为参考图添加名称及说明，帮助模型理解人物、服装或风格；
- 支持风格前缀、主提示词和负面提示词；
- 支持宽高比、分辨率及质量设置；
- 可中止正在进行的生成；
- 下载生成结果，或将结果重新加入参考图库；
- 使用 IndexedDB 在本地保存参考图和生成历史；
- 针对桌面和手机屏幕设计的响应式界面；
- 启动脚本会自动安装用于代理连接的轻量依赖。

## 快速开始

### Windows

双击：

```text
start-local.bat
```

然后在浏览器中打开：

```text
http://127.0.0.1:3210
```

请在使用期间保持命令行窗口开启。按 `Ctrl+C` 可以停止服务器。
首次启动时脚本会自动执行 `npm install`。

### 命令行

```powershell
cd path\to\image-studio
npm install
node server.mjs
```

也可以使用：

```powershell
npm start
```

## 支持的 API

| 类型 | 无参考图 | 有参考图 | 默认请求方式 |
| --- | --- | --- | --- |
| Gemini-compatible | 支持 | 支持 | `:generateContent` + `inlineData` |
| OpenAI-compatible | 支持 | 取决于模型和服务端 | `/v1/images/generations` 或 `/v1/images/edits` |
| OpenRouter | 支持 | 支持的模型可用 | `/chat/completions` + image modalities |

### Endpoint 规则

通常只填写 API 的基础地址，例如：

```text
https://api.openai.com
https://generativelanguage.googleapis.com
https://openrouter.ai/api/v1
```

程序会自动补充对应的 API 路径。

如果代理要求完整请求地址，请启用“Endpoint 为完整地址”选项。启用后，程序不会自动添加任何路径。

### OpenAI 参考图

当选择了参考图时，OpenAI-compatible 配置会自动改用 `/v1/images/edits`。因此模型与服务端必须支持图像编辑及 multipart 上传。若服务端只实现 `/v1/images/generations`，请取消所有参考图。

## 连接配置

每个连接配置保存：

- API 类型；
- Endpoint；
- 是否使用完整 Endpoint；
- API 密钥；
- HTTP/HTTPS 代理地址、用户名和密码；
- 模型名称；
- 宽高比；
- 图像分辨率；
- 质量设置。

参考图库、参考图配置与生成历史由所有连接配置共享。

如果关闭“在此浏览器中保存密钥”，API 密钥和代理密码只保存在当前浏览器会话的 `sessionStorage` 中，关闭会话后不会继续保留。

### 代理

在连接配置中启用代理后，该配置的模型列表、生成请求以及远程结果图片下载都会通过所填的 HTTP/HTTPS 代理发送。代理设置不会影响其他连接配置。可点击模型字段旁的 `↻` 来快速验证连接是否可用。

## 参考图库

可以通过以下方式加入图片：

- 点击“上传”；
- 将一张或多张图片拖入上传区域；
- 从剪贴板直接粘贴图片；
- 将生成结果加入参考图库。

图片在加入图库时会在浏览器中缩放到最大边长 2048 像素，以减少请求体积。原始文件不会上传到任何额外服务器；只有在发起生成时，已启用的参考图才会发送到所选 API。

参考图配置只保存“当前选中了哪些图片”。新建配置时会复制当前选择，之后可以独立调整；图片本身、名称和说明仍然由所有参考图配置共享。删除配置不会删除图库中的图片。

## 本地数据与安全

- Web 服务器只监听 `127.0.0.1`，不会暴露到局域网；
- 连接配置保存在浏览器的 `localStorage`；
- 参考图和生成历史保存在浏览器的 IndexedDB；
- API 密钥只会从浏览器发送到本机 Node.js 服务，再由本机服务发送到所配置的 Endpoint；
- 项目不会把密钥写入源码、日志或 Git 仓库；
- 请仅使用你信任的 Endpoint。

清除浏览器站点数据会同时删除本地配置、参考图和历史记录。

## 项目结构

```text
image-studio/
├─ public/
│  ├─ index.html       # 页面结构
│  ├─ styles.css       # 响应式界面
│  └─ app.js           # 配置、图库、历史和前端逻辑
├─ tests/
│  ├─ mock-provider.mjs
│  ├─ mock-proxy.mjs
│  └─ smoke.mjs
├─ server.mjs          # 静态服务器与 API 代理
├─ start-local.bat     # Windows 快速启动
└─ package.json
```

## 测试

无需真实 API 密钥即可运行本地 smoke test：

```powershell
node tests/smoke.mjs
```

测试包含：

- 静态页面加载；
- OpenAI 图片生成；
- OpenAI 带参考图的编辑请求；
- Gemini `inlineData` 请求；
- OpenRouter 图像请求；
- 模型列表读取。
- 带账号密码的 HTTP 代理路由。

## 当前限制

- NovelAI、Naistera 等专用协议尚未加入独立版本；
- OpenAI-compatible 服务对多参考图字段的实现可能不同；
- 历史记录仅保存在当前浏览器中，没有云同步；
- 没有用户账户或远程访问功能。

## 开发原则

这是一个个人、本地优先的图像工作流工具。目标是让连接配置、参考图和提示词保持清晰可控，同时尽量减少安装步骤和外部依赖。

如果你基于本项目的代码继续开发，请在明显位置保留来源说明，并尊重其所依赖服务的使用条款。
