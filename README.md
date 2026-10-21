# ✦ Local Image Studio

一个运行在本机的轻量级 AI 图像生成工作台。它提供连接配置、多参考图管理、提示词编辑和本地生成历史，不依赖 SillyTavern，也不需要安装前端框架。

> 当前版本：`0.9.0`<br>
> 界面语言：俄语<br>
> 运行环境：Node.js 20 或更高版本

## 功能

- 创建多个独立的连接配置；
- 一键切换“普通 / NovelAI”模式，两种模式分别记住连接配置、密钥及模型；
- 每个配置可保存不同的 API 类型、Endpoint、密钥、模型和图像参数；
- 每个连接配置可单独启用带认证信息的 HTTP/HTTPS 代理；
- 支持 Gemini-compatible、OpenAI-compatible、OpenRouter 和 NovelAI；
- 一次上传多张参考图；
- 创建、复制、重命名和删除参考图配置，一键切换不同的图片组合；
- 在每个参考图配置中单独启用或停用图片；
- 为参考图添加名称及说明，帮助模型理解人物、服装或风格；
- 支持风格前缀、主提示词和负面提示词；
- 支持宽高比、分辨率及质量设置；
- 可中止正在进行的生成；
- 下载生成结果，或将结果重新加入参考图库；
- 使用 IndexedDB 在本地保存参考图和生成历史；
- 自动把生成的原始图片保存到本机文件夹，并提供一键打开文件夹的按钮；
- 图库支持提示词 / 模型 / 配置 / Seed 搜索、提供商及日期筛选、新旧排序和页码跳转；
- 独立大图查看器：左右按钮、键盘方向键、手机滑动、邻近缩略图；查看不会覆盖正在编辑的提示词；
- 按每页 12 张浏览历史，删除单张或跨页选择多张删除；
- 分开管理 NovelAI / Nano Banana 的风格库，保存预览图、分类、搜索标签及可选负面提示词；
- 支持 NovelAI Prompt Chunks：`@` 自动补全、拖放、嵌套引用及生成前展开；
- NovelAI 本地标签助手：内置 140,782 条 Danbooru 标签及别名、后台搜索、俄文入门说明、分类、自定义词典导入、排序与权重按钮；
- 独立“画师”分页：接入 Kaloscope 图片画风分类，选择 1–25 个结果、查看 Danbooru 链接、复制标签或追加到风格前缀；
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
| NovelAI | 支持 | V4.5 Precise Reference | `/ai/generate-image`，使用个人 Persistent API Token |

### Endpoint 规则

通常只填写 API 的基础地址，例如：

```text
https://api.openai.com
https://generativelanguage.googleapis.com
https://openrouter.ai/api/v1
https://image.novelai.net
```

程序会自动补充对应的 API 路径。

如果代理要求完整请求地址，请启用“Endpoint 为完整地址”选项。启用后，程序不会自动添加任何路径。

### OpenAI 参考图

当选择了参考图时，OpenAI-compatible 配置会自动改用 `/v1/images/edits`。因此模型与服务端必须支持图像编辑及 multipart 上传。若服务端只实现 `/v1/images/generations`，请取消所有参考图。

### NovelAI：使用自己的密钥

1. 点击连接面板顶部的 `NovelAI` 模式按钮；
2. 使用默认 Endpoint：`https://image.novelai.net`；
3. 在 NovelAI 的 `User Settings → Account → Get Persistent API Token` 中获取密钥，粘贴到本工具的 API 密钥字段；
4. 点击“检查密钥”确认连接，然后选择模型并填写提示词。

“普通”和“NovelAI”模式拥有各自的连接配置列表，并分别记住上次使用的配置。第一次进入 NovelAI 会自动创建使用官方 Endpoint 的独立配置，不会复制普通模式的密钥。切换模式会自动保存当前配置；返回时会恢复该模式的 Endpoint、密钥、代理、模型和参数，刷新页面后也会保留选择。原有配置会按 API 类型自动归入对应模式，不会被删除。每种模式至少保留一个连接配置。

默认启用“在此浏览器中保存密钥”。如果主动关闭，密钥仍只保存在当前浏览器会话中；切换模式不会改变这个选择。

模型输入框提供 V5 Full、V5 Full Medium、V5 Curated、V4.5、V4、V3 与 Furry V3 的预设 ID，也允许直接输入自己的模型 ID。`↻` 显示内置图片模型列表；检查密钥请使用单独的按钮。

参数规则沿用 Novarakk，并依据 NovelAI 官方资料核对。每个连接配置独立保存采样器、Scheduler、Steps、Prompt Guidance、CFG Rescale、尺寸、Seed、Anlas Guard、负面提示词、参考图选项以及名字到标签的替换规则。默认采样器为 Euler Ancestral，Scheduler 为 native，Steps 为 28，Guidance 为 5，CFG Rescale 为 0，尺寸为 832×1216。

负面提示词不会追加到正面提示词中。NovelAI 的负面模板可以创建、修改、重命名和删除，并与其他 API 的负面提示词分开保存。Seed 默认为 `-1`（随机），实际使用的 Seed 会显示在结果下方并保存到历史。

模型限制：

- V5 Full / Curated：支持可调 Steps、Sampler、Scheduler、Guidance、Rescale 和负面提示词；不发送 Precise Reference、Decrisper、Variety+ 或 SMEA；
- V5 Medium：固定 14 Steps 与 Euler Ancestral，CFG Rescale 为 0，不发送用户自定义负面提示词；
- V4.5：支持 Precise Reference，可选人物、风格或两者；自动将图片缩放并填充到官方接受的三个尺寸之一，每次最多发送五张；
- V3：可以启用 SMEA / SMEA Dynamic；DDIM 会禁用这两个选项。

不支持参考图的模型或关闭参考图开关时，图片与关联描述都会从请求中排除，参考图面板也会隐藏。已有图库和参考图配置仍会保留。切换到 Medium 不会覆盖其他模型保存的 Steps、Sampler、Rescale 或负面提示词。

Anlas Guard 将请求限制在 28 Steps 和 1,048,576 像素以内；Medium 仍为 14 Steps。免费生成取决于订阅和服务端限制，参考图等附加功能仍可能收费。

默认请求使用 `Authorization: Bearer <token>`，通过 `Accept: application/json` 获取官方 JSON 图片响应，也兼容返回 ZIP 的端点。已有 HTTP/HTTPS 代理同样适用于 NovelAI。

官方资料：[Image API](https://image.novelai.net/docs/index.html)、[获取 Persistent API Token](https://docs.novelai.net/en/text/usersettings/account/)、[Medium Effort](https://docs.novelai.net/en/image/effort/)、[Precise Reference](https://docs.novelai.net/en/image/precisereference/)。

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

在连接配置中启用代理后，该配置的远程模型列表、生成请求以及远程结果图片下载都会通过所填的 HTTP/HTTPS 代理发送。代理设置不会影响其他连接配置。一般 API 可点击模型字段旁的 `↻` 验证连接；NovelAI 使用“检查密钥”按钮。

## 参考图库

可以通过以下方式加入图片：

- 点击“上传”；
- 将一张或多张图片拖入上传区域；
- 从剪贴板直接粘贴图片；
- 将生成结果加入参考图库。

图片在加入图库时会在浏览器中缩放到最大边长 2048 像素，以减少请求体积。原始文件不会上传到任何额外服务器；只有在发起生成时，已启用的参考图才会发送到所选 API。

参考图配置只保存“当前选中了哪些图片”。新建配置时会复制当前选择，之后可以独立调整；图片本身、名称和说明仍然由所有参考图配置共享。删除配置不会删除图库中的图片。

## 风格库与 NovelAI Prompt Chunks

“风格与 Chunks”面板在参考图和提示词之间。点击“新建风格”即可保存当前前缀，也可以直接编辑风格文本、名称、分类与搜索标签。预览图可以上传，或使用当前生成结果；会缩小到最长边 384px 后保存在浏览器 IndexedDB 中。预览图仅用于识别风格，不会成为 API 参考图。

点击卡片即可替换“前缀 / 风格”，不会覆盖场景描述、连接配置或参考图选择。可选勾选“同时应用负面提示词”；不勾选时保留现有负面提示词。NovelAI 和普通模式（Nano Banana 等）的风格分开显示，各自记住最后的前缀与所选风格。支持编辑、删除、分类筛选、文字搜索和每页六张卡片。

NovelAI 模式额外显示 Chunks 分页。可以把选中的文本保存为 Chunks，或手工输入；名称区分大小写。通过卡片按钮、拖放或在文本框输入 `@` 插入，支持方向键、回车和 Escape。引用会在输入框内显示为彩色胶囊，只显示名称，不再显示内部 `!macro:名称!` 标记。同名 Chunks 始终使用相同颜色；点击查看内容，双击展开成普通文本，`×` 删除本次引用。支持整块删除、撤销/重做及文本复制粘贴。

嵌套引用使用 `!macro:名称!`。正面、前缀及支持自定义负面的模型会在发送前分别展开；权重和 artist 语法保持不变。找不到引用、循环引用或过度嵌套时会停止请求，不触发付费生成。重命名 Chunks 会同步更新库内引用及当前输入；删除前请先展开仍在使用的引用。

语法依据 [NovelAI 官方 Prompt Chunks 文档](https://docs.novelai.net/en/image/promptchunks/)。这里的库只存储在本机浏览器，**不会与 NovelAI 账户或官方云端同步**；清除浏览器站点数据也会删除风格、预览图和 Chunks。

## NovelAI 标签助手

NovelAI 模式的提示词面板中新增“提示词助手”。输入英文标签片段（如 `blue ha`）时会显示补全：`↑` / `↓` 选择、`Enter` 插入、`Esc` 关闭。补全仅在 NovelAI 模式生效，可单独关闭，开关会保存在浏览器中。`@` 仍然只用于 Chunks，不会被标签补全接管。

展开助手后，可以按英文标签、别名或俄文说明搜索，也可以选择分类。默认自动加载 140,782 条 Danbooru 标签、147,076 个别名以及分类和使用次数，并保留 208 个独立整理的入门标签及俄文说明；合并后共 140,813 条不重复标签。俄文说明只覆盖入门词库，未翻译全部 Danbooru。默认数据库不是 NovelAI 的官方词表，也不是持续更新的完整 Danbooru；部分词汇包含成人内容，模型不一定支持所有标签。

大词库随项目附带，无需手动导入或连接 Danbooru。仅在首次进入 NovelAI 时启动独立 Web Worker，在后台加载、建立索引和搜索；主线程只接收当前页结果，不会渲染十几万张按钮。先按热度建立索引，查询时不再重排全部匹配项；重复查询使用有上限的缓存，旧查询不会覆盖新查询。每页只显示 12 条结果；点选可添加到主提示词、风格前缀或 NovelAI 负面提示词，不会替换整个输入。已添加的相同标签会标记，未收录的词仍然可以手动输入。词库加载失败时会明确显示警告及重试按钮，并暂时使用入门词库。

“当前字段”以分组显示提示词，点击组后可以用按钮、拖放或 `Shift + ← / →` 调整顺序，也可删除或添加 `{}` / `[]` 权重。Chunks、artist 语法、括号内的逗号和数值权重分组会保留，不会简单按每个逗号拆开。只显示前 60 组以控制界面大小，后续内容不会被删除。数值权重规则请参考 [NovelAI 官方文档](https://docs.novelai.net/en/image/strengthening-weakening/)。保存组合仍然使用现有风格库和 Chunks。

“词典与帮助”中可以导入 JSON / TXT / CSV，最多 25 MB、250,000 条，解析同样在后台进行。支持 [sekiryl/tag-prompt-generator](https://github.com/sekiryl/tag-prompt-generator) 的分类 JSON 格式、对象或字符串数组、逐行 TXT、`tag,count` CSV 及常见 Danbooru CSV；下划线转换为空格，保留说明、别名和热度。自定义词典补充默认词典，重复名称优先使用自定义说明。再次导入会替换上一个自定义词典；导入失败不会清空已有数据。“移除自定义词典”保留 Danbooru、入门词库、提示词、风格及 Chunks。

自定义词典保存在本机 IndexedDB；默认 Danbooru 词库位于 `public/data/danbooru.csv`。标签查询、说明、排序和权重编辑不调用生成 API，也不会向外部服务发送提示词。该功能受 Tag Prompt Generator 的交互方式启发；助手代码和入门词库为本项目独立实现，不包含其代码、词库或 Sortable.js。

Danbooru CSV 来自 [DominikDoom/a1111-sd-webui-tagcomplete](https://github.com/DominikDoom/a1111-sd-webui-tagcomplete/blob/209b1dd76b69e95ba6b1619ea5d13e68446607b7/tags/danbooru.csv) 的固定提交 `209b1dd`（词表文件提交日期：2025-01-03），按原始字节附带，作者及 MIT 授权声明保存在 [DANBOORU-LICENSE.txt](public/data/DANBOORU-LICENSE.txt)。来源、SHA-256、Git Blob SHA 和条目数保存在 `public/data/danbooru.meta.json`。`npm run data:danbooru` 可重新下载并验证这一固定版本，不会自动追踪或信任远程最新版。

## Kaloscope：寻找相似画风

顶部的“画师”分页连接 [DraconicDragon 的 Kaloscope Space](https://huggingface.co/spaces/DraconicDragon/Kaloscope-artist-style-classifier)。可以上传 PNG / JPEG / WebP、拖放文件、粘贴剪贴板图片，或使用当前画布结果。图片先在浏览器中转成最长边不超过 1024px 的 JPEG，移除原始文件名及元数据，透明部分使用白色背景；原图最多 30 MB。

默认模型为 `Kaloscope v2.0 ONNX`，也可以选用 Space 当前提供的其他版本，包括 `v3.0 Preview`。结果数量为 1–25，阈值固定为 0，不提供误触滑块。模型输出是画风相似性的分类分数，**不是对真实作者身份的证明**；未知画师或混合画风只能作参考，低分结果也不应当当作确定结论。

默认只选择第一项，可勾选更多结果、点击名称查看 Danbooru、复制单个名字或复制整组标签。Danbooru 可能包含成人内容。标签支持 `artist:name` 和普通名字两种格式。“加入前缀 / 风格”仅追加到现有前缀，不替换场景、负面提示词或参考图，也不自动调用图片生成。画风权重可之后在提示词助手中调整。

### 外部服务与隐私

准备预览和切换分页不会上传图片。每次换图后必须重新勾选同意，再点击分析按钮，才会通过本机 Node 服务把 JPEG 副本传到 Kaloscope / Hugging Face。生成服务的 API 密钥、提示词、其余参考图和原始本地文件名不会发送给该 Space；不需要填写 Hugging Face Token。

图片、勾选同意和分类结果不存入浏览器历史或本地归档；刷新即清空。外部 Space 可能按其规则保留已上传内容，本应用无法保证远程删除。服务可能休眠、排队、限流或加载模型；“中断等待”只停止本地等待，不保证取消远程任务或删除上传。等待最多三分钟，不自动重试分析，以免重复提交。

可勾选使用“当前连接配置的代理”。只读取该配置中的代理地址及认证，不会把图片生成 API 的密钥转发给 Space。未配置代理时会提示，不会悄悄改为直连。默认固定使用官方 Space，不从网页接收任意远程文件 URL；高级用户如部署了自己的兼容副本，可在启动 Node 服务前设置 `IMAGE_STUDIO_KALOSCOPE_ENDPOINT`。

集成依据 Space 的公开 [API 源码](https://huggingface.co/spaces/DraconicDragon/Kaloscope-artist-style-classifier/blob/main/app.py) 和 Gradio 上传 / 队列接口独立实现，不下载或打包模型权重。感谢 DraconicDragon 的 Space、heathcliff01 的原始 Kaloscope 模型及其贡献者。

## 图片文件夹与历史管理

新的生成结果会自动以原始图片格式保存到项目目录下的 `generated-images/`，不再需要逐张点击下载。文件名包含生成时间及唯一 ID；不会覆盖已有图片。此目录已加入 `.gitignore`，私人图片不会提交到 GitHub。

顶部的“图库”导航可直接跳到“图库”面板。在该面板点击“📁 图片文件夹”会打开本机文件管理器。首次使用时，旧版本中仅保存在当前浏览器历史里的图片也会逐张复制到该文件夹；不会删除原有历史或参考图，也不会重复复制已归档的图片。文件夹是在运行 Node.js 服务的电脑上打开的。

历史按每页 12 张显示，支持文字搜索、提供商 / 日期筛选、新旧排序、页码按钮及输入页码直接跳转。缩略图只生成最长边 256px 的小图，使用有上限的内存缓存；不会一次加载全部历史原图。

点击缩略图或结果图片会打开独立大图查看器。可使用两侧按钮、键盘 `←` / `→`、`Home` / `End`、手机横向滑动或邻近缩略图浏览，`Esc` 关闭。浏览范围遵循当前筛选和排序，并跨越图库分页。单纯查看不会修改现有提示词；“使用提示词”按钮才会载入文字和显示结果，也可以直接下载当前图片或加入当前参考图配置。

每张缩略图的 `×` 可以单独删除记录；点击“选择”后，可以勾选多张、选择当前页，或翻页继续选择，再点击“删除所选”。跨页或切换筛选不会清除已有选择，数量始终显示在工具栏。清空全部历史仍然可用，但放在选择工具栏里，并要求确认。

**从历史删除或清空历史，只删除浏览器中的记录。磁盘上的图片文件及参考图库中的副本不会被删除。** 如果要删除文件，请在打开的文件夹中自行操作；已归档的图片被手动移除后，不会因为打开文件夹而自动复活。

如果磁盘写入失败，生成结果仍然会返回并保留在浏览器历史中，同时显示保存失败提示。修复路径权限或空间问题后，可以再次点击文件夹按钮补存。

可选：通过服务端环境变量 `IMAGE_STUDIO_IMAGES_DIR` 指定其他归档目录。网页不能传入任意目录或系统命令。

## 本地数据与安全

- Web 服务器只监听 `127.0.0.1`，不会暴露到局域网；
- 连接配置保存在浏览器的 `localStorage`；
- 参考图和生成历史保存在浏览器的 IndexedDB；
- 风格、预览图和 Chunks 同样保存在浏览器 IndexedDB，不写入源码或 Git；
- 图片文件另存到本机的 `generated-images/`，与浏览器记录分开保留；
- API 密钥只会从浏览器发送到本机 Node.js 服务，再由本机服务发送到所配置的 Endpoint；
- Kaloscope 分页是明确同意后才上传的外部画风分类服务，不属于离线识别；
- 项目不会把密钥写入源码、日志或 Git 仓库；
- 请仅使用你信任的 Endpoint。

清除浏览器站点数据会同时删除本地配置、参考图和历史记录，但不会删除已归档到磁盘的图片。

## 项目结构

```text
image-studio/
├─ public/
│  ├─ index.html       # 页面结构
│  ├─ styles.css       # 响应式界面
│  ├─ app.js           # 配置、图库、历史和前端逻辑
│  ├─ prompt-library.js # 风格库、预览图和 Chunks 界面
│  ├─ chunk-editor.js   # 输入框内的彩色胶囊与文本编辑
│  ├─ prompt-tools.js   # Chunks 解析、嵌套与校验
│  ├─ history-tools.js  # 图库搜索、筛选、排序与分页
│  ├─ image-viewer.js   # 大图浏览、键盘及触屏导航
│  ├─ image-thumbnails.js # 有上限的小图缓存
│  ├─ tag-assistant.js  # NovelAI 标签助手与输入补全
│  ├─ tag-tools.js      # 标签词典解析及安全分组编辑
│  ├─ novelai-tags.js   # 独立整理的入门标签与俄文说明
│  ├─ tag-catalog.js    # Danbooru、入门说明及自定义词典合并
│  ├─ tag-search-client.js # 有上限缓存的 Worker 通信
│  ├─ tag-search-worker.js # 后台加载、导入、索引及查询
│  ├─ artist-classifier.js # 独立画师分页、上传确认及标签使用
│  ├─ artist-tools.js    # Kaloscope 模型列表、画师标签及安全链接
│  ├─ data/             # Danbooru CSV、来源元数据及 MIT 声明
│  └─ novelai.js       # 前后端共用的 NovelAI 参数规则
├─ lib/
│  ├─ novelai-result.mjs # JSON / ZIP 图片响应解析
│  ├─ image-archive.mjs  # 原始图片归档及打开本机文件夹
│  └─ artist-classifier.mjs # Kaloscope 上传、Gradio 队列及结果解析
├─ generated-images/   # 私人生成图片（已被 Git 忽略）
├─ tests/
│  ├─ mock-provider.mjs
│  ├─ mock-proxy.mjs
│  ├─ novelai.test.mjs
│  ├─ image-archive.test.mjs
│  ├─ prompt-tools.test.mjs
│  ├─ history-tools.test.mjs
│  ├─ tag-tools.test.mjs
│  ├─ tag-catalog.test.mjs
│  ├─ artist-classifier.test.mjs
│  ├─ browser.mjs
│  └─ smoke.mjs
├─ server.mjs          # 静态服务器与 API 代理
├─ scripts/update-danbooru.mjs # 校验并下载固定版本词库
├─ scripts/check-kaloscope.mjs # 显式联网检查（只创建并上传人工渐变测试图）
├─ start-local.bat     # Windows 快速启动
└─ package.json
```

## 测试

`npm test` 与浏览器测试仅使用本地模拟服务，不会上传私人图片或调用真实付费生成。若要显式检查 Kaloscope 公共 Space，可运行 `node scripts/check-kaloscope.mjs`；它会自行生成并上传一张 128×128 的渐变测试图，不读取本机图片或密钥。

无需真实 API 密钥即可运行本地 smoke test：

```powershell
npm test
```

测试包含：

- 静态页面加载；
- OpenAI 图片生成；
- OpenAI 带参考图的编辑请求；
- Gemini `inlineData` 请求；
- OpenRouter 图像请求；
- 模型列表读取。
- 带账号密码的 HTTP 代理路由。
- NovelAI 个人密钥、JSON / ZIP 响应、各代模型限制与参考图描述隔离。
- 原始图片归档、旧历史重复导入、文件名校验及本机操作的跨站请求保护。

还可以使用本机 Edge 执行浏览器检查：

```powershell
npm run test:browser
```

浏览器检查使用本地模拟 API，不会触发真实付费生成；覆盖配置切换、Medium 参数保留、参考图归一化、模板保存、历史分页与选择删除、旧图片归档以及手机布局。文件夹打开动作由模拟响应替代，不会弹出额外窗口；测试图片保存在独立临时目录中，结束后清理。可通过 `IMAGE_STUDIO_BROWSER` 指定其他 Chromium 浏览器路径。

## 当前限制

- Naistera 等其他专用协议尚未加入独立版本；
- NovelAI 暂不提供 img2img、inpainting、流式生成或独立角色提示词编辑器；
- 未知自定义模型 ID 的兼容性取决于所用端点；
- OpenAI-compatible 服务对多参考图字段的实现可能不同；
- 历史记录的元数据仅保存在当前浏览器中；图片另有本机文件副本，没有云同步；
- 没有用户账户或远程访问功能。

## 开发原则

这是一个个人、本地优先的图像工作流工具。目标是让连接配置、参考图和提示词保持清晰可控，同时尽量减少安装步骤和外部依赖。

如果你基于本项目的代码继续开发，请在明显位置保留来源说明，并尊重其所依赖服务的使用条款。
