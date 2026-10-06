# ComfyTV 中文图文教程：进度与制作方法

## 当前进度（2026-10-01）

| 课 | 文件 | 状态 |
|---|---|---|
| 第一课：安装、第一张图、图片选择器、裁剪 | `01-first-image.zh.md` | 完成，8189 实拍，截图已按卡片区域裁剪 |
| 第二课：接入自己的工作流（关联、绑定、自定义参数） | `02-link-workflow.zh.md` | 完成，8189 实拍 |
| 第三课：资产库与参考引用（存入、上传、@图1 @图2） | `03-assets.zh.md` | 完成，8189 实拍 |
| 第四课：自定义阶段（Custom Stage） | — | 未开始，下一课 |

- 第一课的安装截图由你自己补：桌面版那张 `images/桌面版安装.png` 已有，命令行安装没配图。
- 代码和教程都在 ComfyTV 本地分支 `docs/tutorial-zh-l1-l3`，只有一个 commit，未 push。空分支 `docs/tutorial-zh` 可以删掉。

## 已定的规矩

- 面向中文社区：ComfyUI 切中文（`Comfy.Locale = zh`），正文和截图里的界面名都用中文，提示词也用中文。
- 节点统一叫「阶段」（stage），如图像阶段、视频阶段。
- 全程用 V2 卡片，前提写在第一课：先开 ComfyUI 的 Nodes 2.0，再开 ComfyTV 设置里的「启用 ComfyTV V2 节点」，然后刷新页面。
- 不提 Project 节点。
- 接入自己的工作流只讲「关联」；上传工作流、往文件夹里放 JSON 只提一句，说明是已弃用的旧方式。
- 每课自成一体：不写「见第 X 课」「见模型清单」这类指向别处的话，需要的信息直接写进本课（图片版里没法点链接）。
- 安装相关截图由你来截，md 里用 `<!-- TODO(截图): 说明 -->` 占位。
- 引用的 UI 名、数值、耗时都以实拍为准，不编。

## md 写法约定（渲染器认这些）

- `# 第N课：标题`：课标题
- `## 一、章名`：章节，渲染成 PART 01
- `### 第 N 步：标题`：步骤，带编号圆点
- 单独一行粗体：小步
- `> **注意**……`：警示框；其他引用块渲染成提示框
- 以「：」结尾的段落会和下一块排在同一页
- `<!-- TODO(截图): 说明 -->`：待补截图占位
- 图片放 `images/`，命名 `<课号>-<序号>-<英文描述>.png`，如 `02-9-bind-dropdown.png`

## 渲染

```
node scripts/tutorial/render.mjs docs/tutorial/01-first-image.zh.md
```

- 产物在 `docs/tutorial/dist/`（已 gitignore）：一份网页 HTML，加一组 1080×1440（3:4，2 倍清晰度）的分页 PNG。
- 分页不会把一个块（图、表、代码、提示框）拆到两页；单块太高会整体缩小。
- 加 `--no-images` 只出 HTML；`--out <目录>` 改输出位置。
- 依赖只有 marked 和 playwright（项目里已有）。

### 公众号版

同一次渲染还会出一份 `dist/<课名>.wechat.html`。浏览器打开，点顶上「复制到公众号」，到公众号编辑器正文里 Ctrl+V。

- 公众号粘贴时会删 `<style>`、class、id、`position`、伪元素、CSS 变量、背景图和网络字体，所以这一份的样式全写在行内 `style` 里，字体只用系统字体（`scripts/tutorial/wechat.mjs`）。
- 外链点不了，改成文末「参考链接」脚注；页内锚点只留文字。
- 列表改成带「•」的段落；三列以上、有长单元格的表改成卡片；代码块按行转 `<br>`。
- `<!-- TODO(截图) -->` 占位不进公众号版。
- **图片要重新上传**：本地截图公众号拿不到，预览里看得到，粘贴后要在编辑器里逐张替换。

## 拍摄环境：8189 干净实例

8188 是你自己的数据，不拿来拍。教程用单独开的 8189 实例：

```
D:\conda\envs\comfyui-cu132\python.exe main.py --port 8189 --enable-assets ^
  --input-directory U:\comfyui-tutorial\input --output-directory U:\comfyui-tutorial\output ^
  --user-directory U:\comfyui-tutorial\user --database-url sqlite:///U:/comfyui-tutorial/user/comfyui.db ^
  --temp-directory U:\comfyui-tutorial\temp --fast fp8_matrix_mult --use-sage-attention --preview-method auto
```

- 在 `I:\ComfyUI` 下启动，模型和 8188 共用。
- `U:\comfyui-tutorial\user\default\comfy.settings.json`：中文、Nodes 2.0 开、小地图关、`Comfy.TutorialCompleted` 为 true。
- ComfyTV 数据库是独立的 `U:\comfyui-tutorial\user\comfytv\data.db`；非内置工作流都已在「阶段管理」里隐藏，下拉框里只有内置工作流。
- 8189 上已有的东西：保存的工作流「Z-Image 文生图」（已关联、已绑定）、自定义参数「采样步数」（image 类型）、资产「狐耳女孩」「海边小镇」。重拍第二课时要先解除关联、删掉参数，才能拍到初始状态。
- 截图前把顶栏和侧栏的其他插件停用，方法是在 `custom_nodes` 里给目录名加 `.disabled`。目前这 14 个仍是停用状态：
  `skill_test_nodes`、`rgthree-comfy`、`ComfyUI-GoPainter`、`ComfyUI-LayerEditor`、`ComfyUI-OpenCut`、`ComfyUI-BlenderWeb`、`ComfyUI-PascalEditor`、`ComfyUI-AudioMass`、`ComfyUI-mesh2motion`、`ComfyUI-NomadSculpt`、`ComfyUI-Custom-Scripts`、`ComfyUI-Easy-Use`、`ComfyUI-iTools`、`ComfyUI-ShaderNodes`。
  拍完要恢复时去掉 `.disabled` 并重启。

## 截图流程

1. 用 Chrome 打开 `http://127.0.0.1:8189/`，一步一步真操作，每步截整窗（窗口 2000×1251，截图 3200×2002，即 1.6 倍）。
2. 用 PIL 按卡片区域裁剪：在整窗截图上读出显示坐标，乘 1.6 得到原图坐标再裁。整窗图在 3:4 的页里太小，看不清卡片上的字。
   - 单张卡片：只裁那张卡片。
   - 多张卡片：裁出相关的几张，连线和弹出菜单一起保留。
   - 侧栏、设置：裁侧栏，保留左侧图标栏，方便看出入口在哪。
   - 需要指示某个按钮时，可以在原图上画一个红色圆角框再裁。
3. 写进 md，渲染后看分页图，检查有没有图太小、页太空的情况。

## 实操里踩过的坑

- 点按钮、选下拉项尽量按元素点，不要往没聚焦的地方打字：卡片上的工作流下拉框没有搜索框，打字会触发画布快捷键；焦点在提示词框里时，打的字会进提示词。
- 新装环境里，从输出口拖线松手会先弹出菜单（Add Node / Search…），选 Search 才是搜索框；松手时按住 Shift 可以直接打开搜索框。
- 新加的节点会跟着鼠标走，先点画布把它放下。
- 关联工作流后右上角会多一条 ComfyUI 自己的「已请求更新」提示，截图前等它消失或关掉。
- 图像阶段第一次运行要加载模型，耗时明显更长；写耗时用第二次的。
- 「阶段管理」的类型下拉默认是 text，建 image 参数要先切过去。
- 卡片上的「工作流参数」一行，要建过自定义参数之后才会出现。
- 侧栏切换标签页后，原标签页的内容可能还留在页面里，按顺序找元素时会点错，要限定在当前标签页里找。

## 下一步

1. 第四课：自定义阶段（输入输出不是「提示词进、图片出」的工作流怎么接进来）。开拍前先读一遍 Custom Stage 的代码和现有说明。
2. 第一课补命令行安装的截图（可选）。
3. 全部拍完后：恢复 14 个插件、按需把 8188 的语言改回去、关掉 8189。
