import { DESIGN_COMPLETE_ZH_MESSAGES } from './design-locale-complete-zh'

/** 补充精确 UI 消息与可枚举的 ICU 模板；不是对任意英文做词级替换。 */
const entries = `
Control	Control
Tab	Tab
Command	Command
Ctrl	Ctrl
Alt	Alt
Option	Option
Shift	Shift
Escape	Esc
Return	Enter
Enter	Enter
Backspace	退格
Space	空格
Up Arrow	向上方向键
Down Arrow	向下方向键
Left Arrow	向左方向键
Right Arrow	向右方向键
Page Up	上一页
Page Down	下一页
Backslash	反斜杠
Slash	斜杠
Minus	减号
Equals	等号
Comma	逗号
Period	句号
Semicolon	分号
Apostrophe	单引号
Backtick	反引号
Left Bracket	左方括号
Right Bracket	右方括号
1 file added	已添加 1 个文件
1 language found	找到 1 种语言
1 message queued. Will send after the current response.	1 条消息正在排队，将在当前回复完成后发送。
A preview card is available	有可用的预览卡片
Couldn’t read the full file list. Reload to try again.	无法读取完整文件列表，请刷新重试。
Not saved: one of the files can’t be changed from this page.	未保存：其中一个文件无法在此页面更改。
point {k} of {n}	第 {k} 个点，共 {n} 个
Points: {points}; series: {series}	数据点：{points}；系列：{series}
There was a problem reading the folder “{name}”.	读取文件夹“{name}”时出现问题。
Use the arrow keys to move between data points	使用方向键在数据点之间移动
Use the arrow keys to move between data points, and Enter to select one	使用方向键在数据点之间移动，按 Enter 选择
Written by hand in a form this editor keeps as is.	以手写形式保存，此编辑器会保留原样。
You can view this artifact, but saving isn’t available on this page.	你可以查看此作品，但此页面不支持保存。
“{name}” couldn’t be checked.	无法检查“{name}”。
{added} added, {count} rejected: {reason}	已添加 {added} 项，拒绝 {count} 项：{reason}
{additions} added, {deletions} removed	新增 {additions} 项，移除 {deletions} 项
{count, plural, one {Show # reply} other {Show # replies}}	{count, plural, one {显示 # 条回复} other {显示 # 条回复}}
{count} files rejected: {reason}	拒绝 {count} 个文件：{reason}
{count} items couldn’t be read.	无法读取 {count} 个项目。
{count} messages queued. Will send after the current response.	{count} 条消息正在排队，将在当前回复完成后发送。
{emoji} reactions: {count}	{emoji} 回应：{count}
{hint} — press Tab until focus enters the card, Escape to return.	{hint} — 按 Tab 将焦点移入卡片，按 Esc 返回。
{n, plural, one {{count} pixels tall} other {{count} pixels tall}}	{n, plural, one {高度 {count} 像素} other {高度 {count} 像素}}
{n, plural, one {{count} pixels wide} other {{count} pixels wide}}	{n, plural, one {宽度 {count} 像素} other {宽度 {count} 像素}}
{n, plural, one {{count} degree, {hue}} other {{count} degrees, {hue}}}	{n, plural, one {{count} 度，{hue}} other {{count} 度，{hue}}}
{n, plural, one {Comment, {count} open} other {Comment, {count} open}}	{n, plural, one {评论，{count} 条未解决} other {评论，{count} 条未解决}}
Changes the color to {hex}, contrast {ratio} on {ground}	将颜色设为 {hex}，在 {ground} 上的对比度为 {ratio}
also below {min} on {grounds}	在 {grounds} 上也低于 {min}
{ratio} on {ground}	在 {ground} 上为 {ratio}
Couldn’t copy the prompt. Try again, or copy the text yourself.	无法复制提示词，请重试或手动复制文本。
Restore them here to keep working with them; this view can’t publish.	在此恢复以继续编辑；当前视图无法发布。
Live sync ended for this view. Reload the page to continue editing.	当前视图的实时同步已结束，请刷新页面以继续编辑。
Shorten it to resume syncing this item.	缩短内容后可恢复同步此项目。
Showing your saved copy. Your changes will sync when you’re back online.	正在显示已保存的副本。恢复联网后将同步你的更改。
Also, “{name}” cannot be saved as it is: {why}.	此外，“{name}”无法按当前形式保存：{why}。
Couldn’t read that video. Try again.	无法读取此视频，请重试。
Everything else is saved, but “{name}” is not: {why}.	其他内容均已保存，但“{name}”未保存：{why}。
files of this kind ({type}) cannot be saved here. Use another format	此处无法保存此类文件（{type}），请使用其他格式
Icon	图标
In this animation	在此动画中
it is in a form that cannot be saved here	其形式无法在此处保存
it is over the {mb} MB limit for one file. Make it smaller	超过单个文件 {mb} MB 的限制，请减小文件
its name ends in .cmekshadow, which is reserved. Rename it	名称以保留后缀 .cmekshadow 结尾，请重命名
its name is empty or too long. Rename it	名称为空或过长，请重命名
its path has an empty part, or a part that is only dots. Rename it	路径中含有空段或只有点的部分，请重命名
its top-level name starts with an underscore, which is reserved. Rename it	顶层名称以下划线开头，这是保留名称，请重命名
No more uploads can be added here right now (storage may be full).	暂时无法继续上传，存储空间可能已满。
Not saved: this file belongs to the editor itself and cannot be changed.	未保存：此文件属于编辑器自身，无法更改。
Paused {alt}.	已暂停 {alt}。
Play the video to move through it.	播放视频以浏览其内容。
Playing {alt}.	正在播放 {alt}。
Refreshing…	正在刷新…
Replacing images isn’t available here	此处不支持替换图片
Stopped {alt}.	已停止 {alt}。
The video couldn’t be uploaded. Try again in a moment.	视频上传失败，请稍后重试。
This browser can’t play that video, so it wasn’t added. Try an H.264 .mp4.	浏览器无法播放此视频，因此未添加。请使用 H.264 编码的 .mp4。
This video isn’t playing here right now.	此视频目前未在此处播放。
Until then it is not saved, and kept only while this tab stays open.	在此之前尚未保存，仅在此标签页保持打开时保留。
Until then they are not saved, and kept only while this tab stays open.	在此之前尚未保存，仅在此标签页保持打开时保留。
Uploads aren’t available in this view, so videos can’t be added.	当前视图不支持上传，因此无法添加视频。
Videos over 20 MB can’t be added. Trim or compress it first.	无法添加超过 20 MB 的视频，请先裁切或压缩。
{current} of {total} or more	第 {current} 项，共至少 {total} 项
{label} bottom	{label} 底部
{label} bottom left	{label} 左下
{label} bottom right	{label} 右下
{label} left	{label} 左侧
{label} mode	{label} 模式
{label} right	{label} 右侧
{label} top	{label} 顶部
{label} top left	{label} 左上
{label} top right	{label} 右上
{name} actions	{name} 操作
{name} asked everyone to follow	{name} 邀请所有人跟随
{name} asked everyone to follow.	{name} 邀请所有人跟随。
{name} is no longer asking everyone to follow.	{name} 已停止邀请所有人跟随。
{name} reset	已重置 {name}
{site} video	{site} 视频
A radial gradient has no angle.	径向渐变没有角度。
Asked to follow	已请求跟随
Card	卡片
Changing the video isn’t available here.	此处不支持更改视频。
Computed — {distribute} decides this axis	计算值 — 此轴由 {distribute} 决定
Couldn’t delete the page. Try again.	无法删除页面，请重试。
Couldn’t export the PDF: {error}.	无法导出 PDF：{error}。
Couldn’t follow {name}.	无法跟随 {name}。
Couldn’t reset the cover image. The video couldn’t be read. Try again.	无法重置封面图片，因为无法读取视频。请重试。
Couldn’t save that setting.	无法保存此设置。
Delete {name}	删除 {name}
Delete {name}?	删除 {name}？
Deleted {name}	已删除 {name}
Divider	分隔线
Edit {label} {parts}	编辑 {label} {parts}
Edit the page	编辑页面
Headline	大标题
Hide {label} {parts}	隐藏 {label} {parts}
If the request is waiting in the chat, send it there.	如果请求已在对话中等待，请在对话中发送。
Inner shadow needs a fill or border on this text	此文本需要填充或边框才能添加内阴影
It plays here when it’s ready.	准备好后会在此处播放。
Keep editing	继续编辑
Linear gradients only here.	此处仅支持线性渐变。
Listen	试听
Moved down	已下移
Moved up	已上移
New set…	新建集合…
Next slide	下一张幻灯片
No animation yet	暂无动画
No longer following {name}.	已停止跟随 {name}。
No usable size was typed, so the scale stays at {percent}.	输入的大小无效，缩放比例保持 {percent}。
Not now	暂不
Not on diamond or arrow shapes	不适用于菱形或箭头形状
Note	便签
Nothing copied. That artboard is playing. Press {edit} on it first.	未复制任何内容。该画板正在播放，请先点击其中的 {edit}。
Previous slide	上一张幻灯片
Result	结果
Row	行
Select just one element to copy its properties	仅选择一个元素以复制其属性
Select just one element to copy its properties.	仅选择一个元素以复制其属性。
Select one image to replace it	选择一张要替换的图片
Select the elements to paste the properties onto.	选择要粘贴属性的元素。
Setting a cover image isn’t available here.	此处不支持设置封面图片。
Shadows	阴影
Sketch	草图
Sources	数据源
Spacer	间隔
Stop {number} color: {color}	第 {number} 个色标的颜色：{color}
Stop {number} position	第 {number} 个色标的位置
Stop following. Moving the view yourself stops it too	停止跟随。自行移动视图也会停止跟随
Stopped following {name}, who is following you now.	已停止跟随 {name}，对方现在正在跟随你。
Stopped following {name}.	已停止跟随 {name}。
Stopped following them.	已停止跟随。
Test	测试
That request hasn’t been confirmed yet. It may still arrive.	该请求尚未确认，仍可能送达。
The agent is working	Agent 正在处理
The person you were following left.	你跟随的人已离开。
The save didn’t go through. Try Download again	保存未成功，请再次尝试下载
The whole note is already bold (its style)	整张便签已使用粗体样式
The whole note is already italic (its style)	整张便签已使用斜体样式
This menu can only paste right after you copy or cut here.	此菜单只能在此处复制或剪切后立即粘贴。
Too much text. Try fewer words.	文本过多，请减少字数。
Turn off Follow me	关闭跟随我
You asked everyone to follow	你邀请了所有人跟随
You asked everyone to follow.	你邀请了所有人跟随。
“{name}” already exists.	“{name}”已存在。
“{name}” is not a token name — letters, digits, . _ and - only.	“{name}”不是有效的设计变量名称，只能使用字母、数字、.、_ 和 -。
“{name}” is reserved. Pick another name.	“{name}”是保留名称，请使用其他名称。
“{name}” is still loading — try again in a moment	“{name}”仍在加载，请稍后重试
“{name}” is still loading — try again in a moment.	“{name}”仍在加载，请稍后重试。
“{name}” is too large to export at {scale}×	“{name}”过大，无法按 {scale} 倍导出
“{name}” is too small to export as a PDF page	“{name}”太小，无法导出为 PDF 页面
“{name}”’s preview is stopped — reload it before exporting.	“{name}”的预览已停止，请重新加载后再导出。
{connector} is turned off	{connector} 已关闭
{connector} is turned off for this dashboard.	此仪表盘已关闭 {connector}。
{connector} needs a fresh sign-in, which this page can’t ask for.	{connector} 需要重新登录，当前页面无法发起登录。
{connector} said	{connector} 返回
{connector} said: {quoted}	{connector} 返回：{quoted}
{connector}, a custom connector at {host}	{connector}，位于 {host} 的自定义连接器
{connector}: Viewers use {access}	{connector}：查看者使用 {access}
{crop} (or double-click the image)	{crop}（或双击图片）
{crop} (or double-click the picture)	{crop}（或双击图片）
{crop} (or double-click the video)	{crop}（或双击视频）
{day} at {time}	{day} {time}
{font} (couldn’t load)	{font}（加载失败）
{group} colors	{group} 颜色
{key}-click to open: {address}	按住 {key} 并点击以打开：{address}
{key}-click to select the text box	按住 {key} 并点击以选择文本框
{key}-click to use	按住 {key} 并点击以使用
{label}, the agent is working	{label}，Agent 正在处理
{name} brought back	已恢复 {name}
{name} change redone	已重做 {name} 的更改
{name} change undone	已撤销 {name} 的更改
{name} changed	{name} 已更改
{name} changed meanwhile. Nothing was deleted.	{name} 已在此期间更改，未删除任何内容。
{name} deleted.	已删除 {name}。
{name} has a draft waiting.	{name} 有待处理的草稿。
{name} is not in this dashboard	{name} 不在此仪表盘中
{name} is not in this file	{name} 不在此文件中
{name} is not selected. Nothing was copied.	未选择 {name}，未复制任何内容。
{name} is not selected. Nothing was flipped.	未选择 {name}，未翻转任何内容。
{name} is not selected. Nothing was pasted.	未选择 {name}，未粘贴任何内容。
{name} is not selected. Nothing was scaled.	未选择 {name}，未缩放任何内容。
{name} layer {n}	{name} 图层 {n}
{name} moved earlier.	已将 {name} 前移。
{name} moved later.	已将 {name} 后移。
{name} moved.	已移动 {name}。
{name} preview	{name} 预览
{name} props	{name} 属性
{name} reset again	已再次重置 {name}
{name} selected	已选择 {name}
{name} selected, {index} of {count}	已选择 {name}，第 {index} 项，共 {count} 项
{name} selected, {index} of {count}, hidden	已选择 {name}，第 {index} 项，共 {count} 项，已隐藏
{name} text selected	已选择 {name} 文本
{name} updated	{name} 已更新
{name} usage notes	{name} 使用说明
{name} value	{name} 值
{name} with the agent	与 Agent 讨论 {name}
{name}, {enter} to edit	{name}，按 {enter} 编辑
{name}, {enter} to edit, {keys} to use	{name}，按 {enter} 编辑，按 {keys} 使用
{name}, {keys} to use	{name}，按 {keys} 使用
{name}, component	{name}，组件
{name}, component, thumbnail	{name}，组件，缩略图
{name}, link	{name}，链接
{name}, scene {number}, scene options	{name}，场景 {number}，场景选项
{name}, thumbnail	{name}，缩略图
{name}: added	{name}：已添加
{name}: edited	{name}：已编辑
{name}: not set	{name}：未设置
{name}: removed	{name}：已移除
{name}’s access	{name} 的访问权限
{name}’s data, updated {ago}	{name} 的数据，更新于 {ago}
{name}’s data, updated now	{name} 的数据，刚刚更新
{removed}. This cannot be undone.	{removed}。此操作无法撤销。
{rev} · Some changes aren’t syncing.	{rev} · 部分更改未同步。
{rows} · not saved	{rows} · 未保存
{rows} · not saved · out of date	{rows} · 未保存 · 已过期
Rename…	重命名…
Copy it	复制
New set	新建集合
Couldn’t copy	无法复制
Inherits {theme}	继承 {theme}
Asking the agent	正在询问 Agent
Still working on your previous change. Try again in a moment.	仍在处理你之前的更改，请稍后重试。
Font files	字体文件
Free {size}	释放 {size}
Nothing was freed.	未释放任何空间。
Freeing space isn’t available here.	此处不支持释放空间。
Save your changes first, then free space.	请先保存更改，再释放空间。
Still saving your latest changes. Try again in a moment.	仍在保存最新更改，请稍后重试。
Nothing to free: every stored file is in use.	没有可释放的文件：所有已存储文件均在使用中。
Could not read what the store holds — try again in a moment.	无法读取存储内容，请稍后重试。
Reconnecting to this design system — try freeing space again in a moment.	正在重新连接设计系统，请稍后重试释放空间。
This text already has another style	此文本已使用其他样式
Code can’t carry a link	代码不能包含链接
Paste a link, then Enter	粘贴链接后按 Enter
Block style	块样式
A list item stays a paragraph	列表项保持为段落
Only paragraphs become lists	只有段落可以转换为列表
Subheading	副标题
Could not rename {name}.	无法重命名 {name}。
Markdown shortcuts · select text to format	Markdown 快捷键 · 选择文本以设置格式
Read-only document	只读文档
Copied {value}	已复制 {value}
Copy value	复制值
The request is in your chat box — send it to the agent.	请求已在输入框中，请发送给 Agent。
No agent session found — the request was copied for you to paste and send to the agent.	未找到 Agent 会话，已复制请求，请粘贴并发送给 Agent。
No agent session found, and the request couldn’t be copied.	未找到 Agent 会话，也无法复制请求。
When to use it, and when not to…	何时使用，以及何时不应使用…
Delete usage notes	删除使用说明
Usage notes	使用说明
Usage notes: {name}	使用说明：{name}
Overview	概览
Not a plain CSS value	不是简单的 CSS 值
{value} copied	已复制 {value}
{theme}: Copy {value}	{theme}：复制 {value}
Go to {name}	转到 {name}
{theme}: inherit {first}	{theme}：继承 {first}
There is already a {name} group	已存在 {name} 组
Could not rename {name} — a token name is already taken.	无法重命名 {name}，设计变量名称已被占用。
Fix with the agent	请 Agent 修复
Shadow {name}	阴影 {name}
{name} · layer {n}	{name} · 图层 {n}
Layer {n}	图层 {n}
Remove layer {n}	移除图层 {n}
Copied {name} ({theme})	已复制 {name}（{theme}）
No colors yet.	暂无颜色。
No type styles or font files yet.	暂无排版样式或字体文件。
No spacing values yet.	暂无间距值。
No corner radii yet.	暂无圆角。
No shadows yet.	暂无阴影。
Themes in this system	此系统中的主题
Inherit {theme}	继承 {theme}
{theme} value	{theme} 值
This design system has no other themes	此设计系统没有其他主题
These component previews are static pictures, so they can’t change theme	这些组件预览是静态图片，无法切换主题
{theme}, Preview theme	{theme}，预览主题
Theme default	主题默认值
Theme changed on every slide.	已更改所有幻灯片的主题。
Use smaller settings	使用较低的设置
The design system has reopened. Editing is back.	设计系统已重新打开，可以继续编辑。
The design system has reopened.	设计系统已重新打开。
This design system is being moved. Editing is off until the page reopens.	设计系统正在移动，页面重新打开前暂停编辑。
Part of this design system could not be found. Editing is off, and what is shown may be incomplete.	未找到此设计系统的部分内容，已暂停编辑，显示的内容可能不完整。
An older copy of this design system was saved over the current one. Editing is off here.	当前设计系统已被旧副本覆盖，此处已暂停编辑。
Changes made to this design system outside this page were brought in.	已导入在此页面之外对设计系统所做的更改。
The store is unreachable. Retrying now. Your edits are kept on this screen.	无法连接存储，正在重试。你的编辑保留在当前页面。
The store is unreachable. Retrying shortly; click to retry now. Your edits are kept on this screen.	无法连接存储，即将重试；点击可立即重试。你的编辑保留在当前页面。
All changes synced · {time}. Edits sync as you go; if two people change the same thing, the last change wins.	所有更改已同步 · {time}。编辑会实时同步；多人修改同一内容时，以最后一次更改为准。
All changes synced. Edits sync as you go; if two people change the same thing, the last change wins.	所有更改已同步。编辑会实时同步；多人修改同一内容时，以最后一次更改为准。
Synced. Edits sync as you go; if two people change the same thing, the last change wins.	已同步。编辑会实时同步；多人修改同一内容时，以最后一次更改为准。
Updating to the latest version…	正在更新到最新版本…
This page couldn’t finish updating. Reload to keep working.	页面更新未能完成，请刷新以继续操作。
This dashboard can’t load here, so it is empty and view-only.	此处无法加载仪表盘，因此内容为空且为只读。
Live updates stopped. Reconnecting; click to retry now. Your edits are kept on this screen.	实时更新已停止，正在重新连接；点击可立即重试。你的编辑保留在当前页面。
Sign in to Claude to see this content, then reload the page. If you’re already signed in, you might not have access to it.	请登录 Claude 后刷新页面以查看此内容。如果你已登录，则可能没有访问权限。
This presentation couldn’t be loaded.	无法加载此演示文稿。
This presentation is read-only here.	此演示文稿在此处为只读。
Couldn’t load this presentation. Reload to try again.	无法加载此演示文稿，请刷新重试。
Try now	立即重试
Couldn’t read this canvas’s files. Reload to try again.	无法读取此画布的文件，请刷新重试。
What the agent is making	Agent 正在制作的内容
What the agent has written so far	Agent 目前已完成的内容
`;

const translations: Record<string, string> = Object.fromEntries(entries.trim().split('\n').map((line) => {
  const [source, translated, extra] = line.split('\t')
  if (!source || !translated || extra !== undefined) throw new Error(`无效的 design 补充中文消息：${source}`)
  return [source, translated]
}))

// 上游使用同一固定 ICU 结构枚举数量读数。中文保留复数结构和参数，避免自行处理数值格式。
const units: ReadonlyArray<readonly [string, string, string]> = [
  ['day', 'days', '天'], ['file', 'files', '个文件'], ['item', 'items', '项'], ['layer', 'layers', '个图层'],
  ['row', 'rows', '行'], ['Text', 'Text', '个文本'], ['more', 'more', '项更多内容'], ['object', 'objects', '个对象'],
  ['artboard', 'artboards', '个画板'], ['column', 'columns', '列'], ['error', 'errors', '个错误'],
  ['hour', 'hours', '小时'], ['key', 'keys', '个键'], ['minute', 'minutes', '分钟'], ['month', 'months', '个月'],
  ['note', 'notes', '张便签'], ['picture', 'pictures', '张图片'], ['shape', 'shapes', '个形状'],
  ['source', 'sources', '个数据源'], ['video', 'videos', '个视频'], ['year', 'years', '年'], ['match', 'matches', '个匹配项'],
  ['day ago', 'days ago', '天前'], ['hour ago', 'hours ago', '小时前'], ['minute ago', 'minutes ago', '分钟前'],
  ['month ago', 'months ago', '个月前'], ['year ago', 'years ago', '年前'],
]
for (const [one, other, translated] of units) {
  translations[`{n, plural, one {{count} ${one}} other {{count} ${other}}}`] = `{n, plural, one {{count} ${translated}} other {{count} ${translated}}}`
}
const counts: ReadonlyArray<readonly [string, string, string]> = [
  ['objects deleted', 'objects deleted', '已删除 {count} 个对象'], ['layers selected', 'layers selected', '已选择 {count} 个图层'],
  ['slide updated', 'slides updated', '已更新 {count} 张幻灯片'], ['slides cut', 'slides cut', '已剪切 {count} 张幻灯片'],
  ['slides deleted', 'slides deleted', '已删除 {count} 张幻灯片'], ['slides moved', 'slides moved', '已移动 {count} 张幻灯片'],
  ['slides pasted', 'slides pasted', '已粘贴 {count} 张幻灯片'], ['slides removed', 'slides removed', '已移除 {count} 张幻灯片'],
  ['slides restored', 'slides restored', '已恢复 {count} 张幻灯片'], ['slides selected', 'slides selected', '已选择 {count} 张幻灯片'],
  ['selected', 'selected', '已选择 {count} 项'],
]
for (const [one, other, translated] of counts) {
  translations[`{n, plural, one {{count} ${one}} other {{count} ${other}}}`] = `{n, plural, one {${translated}} other {${translated}}}`
}
const undoLabels: ReadonlyArray<readonly [string, string]> = [
  ['Crop', '裁剪'], ['Delete', '删除'], ['Duplicate', '复制'], ['Edit path', '路径编辑'], ['Flip', '翻转'],
  ['Move', '移动'], ['New note', '新建便签'], ['New picture', '新建图片'], ['New shape', '新建形状'], ['New video', '新建视频'],
  ['Note delete', '删除便签'], ['Note edit', '编辑便签'], ['Note move', '移动便签'], ['Note resize', '调整便签大小'],
  ['Note style', '便签样式'], ['Page change', '页面更改'], ['Page delete', '删除页面'], ['Paper change', '纸张更改'],
  ['Paste', '粘贴'], ['Resize', '大小调整'], ['Rotate', '旋转'], ['Shape color', '形状颜色'], ['Shape delete', '删除形状'],
  ['Style', '样式'], ['Tweak', '微调'], ['Video delete', '删除视频'], ['Video replace', '替换视频'], ['Video settings', '视频设置'],
]
for (const [label, translated] of undoLabels) {
  translations[`{dir, select, undo {${label} undone.} other {${label} redone.}}`] = `{dir, select, undo {已撤销${translated}。} other {已重做${translated}。}}`
}
translations['{n, plural, one {{count} change waiting to sync.} other {{count} changes waiting to sync.}}'] = '{n, plural, one {{count} 项更改等待同步。} other {{count} 项更改等待同步。}}'
export const DESIGN_EXTRA_ZH_MESSAGES: Readonly<Record<string, string>> = Object.freeze({ ...translations, ...DESIGN_COMPLETE_ZH_MESSAGES })
