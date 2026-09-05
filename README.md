# Music — 全网音乐聚合搜索 / 试听 / 下载

基于 **Next.js 15 全栈**（App Router + Route Handlers + TypeScript）实现的音乐聚合应用。
后端接口从 [go-music-dl](https://github.com/guohuiyuan/go-music-dl)（及其音源库 [music-lib](https://github.com/guohuiyuan/music-lib)）**完整迁移为 TypeScript，45 条 API 与 Go 版一一对应**，支持 13 家音源、歌单/专辑/链接解析、扫码登录、管理员鉴权、本地音乐库。

## 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Next.js 15（App Router，前后端同进程） |
| 前端 | React 19 + Tailwind CSS v4 + **motion**（动画）+ zustand（播放器状态）+ lucide-react + sonner |
| 后端 | Route Handlers（Node runtime，流式转发 / Range 透传 / 并行分块下载） |
| 存储 | better-sqlite3（歌单 / 下载记录 / 去重 / Cookie / 本地音乐索引 / 设置）+ music-metadata（音频元数据，等价 Go tag+ffprobe 职责） |
| 媒体 | ffmpeg（PATH → `MUSIC_DL_FFMPEG` → **ffmpeg-static 内置二进制** 三级解析，元数据嵌入与视频合成开箱即用） |
| 加密 | Node 内置 crypto（网易云 weapi/eapi/linuxapi/**xeapi** 五通道全量、QQ QRC 变体 3DES、酷狗 KRC、酷我 zlib+XOR+GB18030、汽水 PlayAuth/CENC 解密等） |
| 测试 | vitest（129 例：歌词 verbatim 管线 / SongKey / 文件名模板 / 签名探测 / mime 表 / 设置规范化 / 相似度 / **网易云 439 接口注册表完整性** / **QQ 音乐 105 接口路由表 + 响应映射完整性**） |

## 音源支持矩阵（13 源）

| 源 | 搜索 | 直链 | 歌词 | 歌单 | 专辑 | 分类 | 用户歌单 | 扫码登录 |
|---|---|---|---|---|---|---|---|---|
| 网易云 | ✅ | ✅ weapi | ✅ YRC 逐字+罗马音+译文 | ✅ | ✅ | ✅ | ✅ | ✅ |
| QQ 音乐 | ✅ | ✅ vkey 七档 | ✅ QRC 逐字+罗马音+译文 | ✅ | ✅ | ✅ | ✅ | ✅（含微信通道） |
| 酷狗 | ✅ | ✅ playInfo+3级tracker | ✅ KRC 逐字+多语言 | ✅ | ✅ | ✅ | ✅ 含云歌单 | ✅ |
| 酷我 | ✅ | ✅ convert_url_with_sign | ✅ zlib+XOR+GB18030+罗马音 | ✅ | ✅ | ✅ | — | — |
| 咪咕 | ✅ | ✅ listenSong 302 | ✅ | ✅ MIGUM3 | ✅ | ✅ | — | — |
| 千千 | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | — | — |
| 汽水 | ✅ | ✅ 需解密 | ✅ | ✅ | ✅ | — | ✅ | — |
| 5sing | ✅ | ✅ | ✅ | — | — | — | — | — |
| Jamendo | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — |
| JOOX | ✅ | ✅ OpenJOOX | ✅ | ✅ | ✅ | ✅ | — | — |
| Bilibili | ✅ | ✅ dash | ✅ | ✅ | — | — | — | ✅ |
| Apple Music | ✅ | ⚠️ preview | ✅ | ✅ | ✅ | ✅ | — | — |
| 本地音乐 | ✅ 一等搜索源 | ✅ | ✅ 内嵌/sidecar | — | — | — | — | — |

> 注：部分热门歌曲受平台版权限制（上游返回付费/无权限），无 Cookie 时无法获取直链，属平台策略，与原 Go 版行为一致；可在「设置」扫码登录获取 Cookie。

## API 完整对照表（Go `/music/*` → 本项目 `/api/*`）

| Go 路由 | 本项目 | 说明 |
|---|---|---|
| `GET /healthz` | `GET /api/healthz` | 健康检查 |
| `GET/HEAD/POST /cookies` | `GET/HEAD/POST /api/cookies` | 各源 Cookie 读写 |
| `GET/POST /settings` | `GET/POST /api/settings` | Web 设置（脱敏读取） |
| `GET /search` | `GET /api/search` | 聚合搜索：`q/type=song·playlist·album/exact_artist/sources[]`；q 为链接时自动解析（单曲→歌单→专辑） |
| `GET /playlist` | `GET /api/playlist` | 歌单详情 |
| `GET /album` | `GET /api/album` | 专辑详情 |
| `GET /album_jump` | `GET /api/album_jump` | 按歌名歌手 302 跳专辑 |
| `GET /recommend` | `GET /api/recommend` | 每日推荐歌单（多源并发） |
| `GET /user_playlists` | `GET /api/user_playlists` | 我的收藏歌单（需 Cookie） |
| `GET /playlist_categories` | `GET /api/playlist_categories` | 歌单分类（分组结构） |
| `GET /category_playlists` | `GET /api/category_playlists` | 分类下歌单 |
| `GET /inspect` | `GET /api/inspect` | 可播性探测（Range:0-1，大小/码率） |
| `GET /switch_source` | `GET /api/switch_source` | 跨源换源（相似度+时长+可播验证） |
| `GET/POST /download` | `GET/POST /api/download` | 音频流代理（Range 206 透传 / `embed=1` 元数据嵌入 / `save_local=1` 落盘去重 / WebDAV 上传 / 汽水服务端解密 / 本地 304 协商缓存） |
| `GET/POST /download_lrc` | `GET/POST /api/download_lrc` | 歌词下载（X-Lyric-Format；`save_local=1` 落盘） |
| `GET/POST /download_cover` | `GET/POST /api/download_cover` | 封面下载 |
| `GET /cover_proxy` | `GET /api/cover_proxy` | 封面代理（绕防盗链） |
| `GET /lyric` | `GET /api/lyric` | 歌词（LRC，含译文） |
| `POST/GET /qr_login/:source` | `POST/GET /api/qr_login/[source]` | 扫码登录（创建/轮询，成功自动存 Cookie） |
| `GET /collections` 系列 11 条 | `/api/collections*` | 本地歌单 CRUD / 导入 / 批量收藏 / 删除曲目 |
| `POST /collections/:id/local_music(/batch)` | 同路径 | 本地音乐加入歌单 |
| `GET/DELETE /local_music` | `GET/DELETE /api/local_music` | 本地库扫描（分页/刷新/已收藏标记）/硬删除 |
| `GET/POST /local_music/cover` | 同路径 | 本地封面（内嵌优先 sidecar 兜底） |
| `POST /local_music/upload` | 同路径 | 上传音频（元数据自动补全） |
| `POST /local_music/batch_match` | 同路径 | 搜索结果本地匹配（重复检测） |
| `GET /local_music/duplicates` | 同路径 | 疑似重复分组 |
| `POST /local_music/auto_cache` | 同路径 | 播放时后台缓存 |
| `POST /local_music/reindex` | 同路径 | 重建索引 |
| `GET /api/downloads/records` + `DELETE` | 同路径 | 下载记录分页/清空 |
| `POST /api/downloads/precheck` | 同路径 | 下载去重预检 |
| `GET /app_update/check` | `GET /api/app_update/check` | GitHub Release 检查（版本比较+资产打分） |
| `GET /github_proxy/test` | `GET /api/github_proxy/test` | 代理可用性测试 |
| `POST /videogen/init·frame·finish` + `GET /videos/*` | `/api/videogen/*` | 视频生成会话（帧收集→ffmpeg 拼装） |
| `GET/POST /setup`、`/login`、`/logout` | `/api/{setup,login,logout}` + `/login` 页 | 管理员鉴权：setup token 初始化、scrypt 密码、HMAC 会话 Cookie、指数退避防爆破；`MUSIC_DL_DISABLE_AUTH=1` 等价 Go 桌面模式跳过 |
| （Go 无对应） | `GET /api/system/status` | 环境状态（ffmpeg 可用性/来源、下载目录、版本） |
| 页面路由 `/recommend` `/playlist` `/my_collections` 等 | 前端页面 `/explore` `/playlist` `/collections` 等 | Go 的 HTML 渲染页由 SPA 页面承担，语义对应 |

## 网易云 API 全量迁移（api-enhanced）

底层网易云能力整体切换为 [NeteaseCloudMusicApiEnhanced/api-enhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced)（MIT）的 **439 个接口全量 TypeScript 移植**，路由规则与其 server.js 1:1（文件名下划线转斜杠，`daily_signin`/`fm_trash`/`personal_fm` 三个特殊路由原样）：

- **核心运行时** `lib/netease/`：五套加密通道（weapi / eapi / linuxapi / xeapi(X25519+AES-GCM) / api）、cookie 加工（NMTID 采集 / 匿名游客 token 惰性注册并持久化 `data/netease-anonymous-token.json`）、易盾反作弊 token（v3 直连；v2 jsdom 正式依赖 + 本地 vendor 脚本 `lib/netease/vendor/dun-tool.min.js` SHA-256 校验，沙箱禁远端子资源）、随机中国 IP、NCBL 打卡加密 — 零第三方加密依赖（Node 内置 crypto/zlib）
- **接口模块** `lib/netease/modules/`：439 个接口按功能家族合并为 **23 个组文件**（account / song / comment / dj / playlist…），组内命名导出 + 顶层辅助变量模块前缀隔离；含云盘/声音上传、NCBL scrobble、checktoken、xeapikey 等手工移植实现，上传类接口支持 multipart 文件
- **统一入口**：`GET/POST /api/netease/<route>`（如 `/api/netease/login/qr/key`、`/api/netease/song/url/v1`），或进程内 `invokeNcm("<name>", params)`；未显式传 cookie 自动注入 SQLite 存储的登录态，响应 `Set-Cookie` 自动合并回存储（登录接口即存即用）；支持文档级参数：`cookie` / `realIP` / `randomCNIP` / `ua` / `noCookie` / `e_r` / `proxy`（http/https 代理，undici ProxyAgent；PAC 暂不支持）、GET 200 响应 2 分钟缓存（对齐源 apicache，防网易 IP 高频）
- **前端控制台** `/netease`：439 接口分类浏览 / 实时搜索 / 在线调试（参数编辑、状态码与耗时、JSON 响应、路由复制）
- **Provider 降级耦合**：`lib/providers/netease.ts` 业务映射（Song/Playlist、VIP 判定缓存、下载直链缓存、链接解析、yrc 逐字歌词）全部保留，底层请求尽数改走新模块系统（`cloudsearch`/`song_detail`/`song_url_v1`/`lyric_new`/`album`/`playlist_detail`/`personalized`/`playlist_catlist`/`top_playlist`/`user_account`/`user_playlist`/`login_qr_*`）
- 全量清单见 `docs/netease-api-inventory.md`（439 项 / 23 分类，含每个接口的 HTTP 路由与实现方式）

## QQ 音乐 API 全量迁移（QQMusicApi）

底层 QQ 音乐能力整体切换为 [L-1124/QQMusicApi](https://github.com/L-1124/QQMusicApi)（GPL-3.0，仅作技术可行性研究）的 **14 模块 105+ 接口全量 TypeScript 移植**，路径与参数命名与其 Web 路由层 1:1（snake_case），并补齐核心库有而 Web 层未暴露的能力（logout / 新碟 / 收藏专辑 / 红心歌曲 / MV 分类列表 / **私信 15 接口** / COS 上传 2 接口）：

- **核心运行时** `lib/qq/`：CGI 统一网关（`musicu.fcg` / 签名 `musics.fcg`，zzc 签名 SHA1+XOR+base64）、三平台 comm 公共参数（Android 14.9.0.8 / Desktop / Web）、Android 虚拟设备指纹与 24h session（`music.getSession`）、QIMEI 申请（RSA+AES-CBC+MD5，缓存落盘 `data/qq_device.json`）、g_tk/hash33、错误码映射（2000 签名 / 2001 限流 / 1000·104400·104401 凭证过期）— 零第三方依赖
- **MQTT 5.0 over WebSocket** `lib/qq/mqtt.ts`：undici WebSocket 精简实现（CONNECT 属性 / ServerReference 重定向 / 订阅 UserProperty / PUBLISH 属性解析），支撑**手机客户端扫码登录**推送通道
- **接口模块** `lib/qq/modules/`：song(16) / album(5) / songlist(7) / search(5) / singer(10) / lyric(5) / mv(4) / top(2) / recommend(5) / comment(7) / user(19) / login(7·QQ/微信/手机三通道扫码+验证码) / private_message(15) / helper(2)
- **统一入口**：`GET/POST/DELETE /api/qq/<route>`（如 `/api/qq/song/{mid}/url`、`/api/qq/login/qrcode/qq`），或进程内 `import { getClient } from "@/lib/qq"`；登录成功（扫码/验证码/刷新）自动把 Credential 写回 SQLite（与旧 cookie 键位双向兼容）；GET 按 60/300/600s 分级短缓存（LRU）
- **前端控制台** `/qq`：14 模块接口分类浏览 / 实时搜索 / 在线调试；**路由 `{path_param}` 自动生成必填参数行**、GET·POST·DELETE 方法徽章、需登录接口 🔒 标记、状态码与耗时、JSON 响应复制
- **Provider 重构**：`lib/providers/qq.ts` 旧私有实现（搜索/vkey/歌单/专辑/扫码约 2300 行）全部移除，MusicProvider 契约全部改走新模块（搜索 `DoSearchForQQMusicMobile`、直链 `UrlGetVkey` 七档降级、歌词 `GetPlayLyricInfo`）；**保留复用**：QRC 变体 3DES 解密管线（`lib/qrc.ts`）、分享链接解析、VIP 过滤与音质降级策略、虚拟歌单（我喜欢/目录歌单）、歌单分类广场（参考仓库无对应接口，属本项目特有）

## 前端功能

- **聚合搜索**：单曲/歌单/专辑三种类型 + 13 源多选筛选 + 分享链接自动识别解析
- **歌单广场**：每日推荐 / 分类浏览 / 我的收藏（Cookie 源）
- **我的歌单**：自建歌单 CRUD、外部歌单/专辑导入、单曲/批量收藏、本地音乐入库
- **本地音乐**：扫描/上传/删除/重复检测/播放缓存，内嵌封面与歌词自动读取
- **播放器**：全局播放条 + 全屏播放页（**卡拉 OK 逐字高亮**：网易云 YRC / QQ QRC / 酷狗 KRC 词级歌词逐词渐变着色 + 罗马音/译文副行，其他渠道行级渐变；点击跳播）、**Range 实测音质徽章**（码率·大小）、队列管理、随机/循环、空格键控制、MediaSession（系统媒体键/锁屏控制）、失效自动换源
- **API 控制台**（`/netease`、`/qq`）：网易云 439 + QQ 音乐 105+ 接口分类浏览 / 实时搜索 / 在线调试（GET·POST·DELETE、路径参数自动填充、状态码与耗时、JSON 响应复制）
- **设置**：扫码登录（网易云/QQ/酷狗/酷我/B站）、手动 Cookie、播放与下载选项（元数据嵌入 / 服务器落盘 / 并发数 / 文件名模板）、WebDAV 同步、GitHub 更新源与代理、下载记录
- **双端适配**：PC 侧边栏布局 + 移动底部 Tab/mini 播放条，触控目标 ≥44px，动效遵循 `prefers-reduced-motion`

## 快速开始

```bash
npm install
npm run dev        # 开发模式（Turbopack），打开 http://localhost:3000
npm test           # 运行 129 例单元测试（vitest）
```

生产模式：

```bash
npm run build && npm start
```

首次运行自动创建 `data/`（app.db 含歌单/下载记录/去重/Cookie/设置表、downloads/ 下载目录）。

**ffmpeg**：元数据嵌入与视频渲染的 ffmpeg 按「系统 PATH → `MUSIC_DL_FFMPEG` 环境变量 → 内置 ffmpeg-static 二进制」顺序解析，开箱即用；无需系统安装。设置页「环境状态」卡可查看当前解析结果。

**鉴权**：默认开启（首启在终端打印 setup token，访问 `/login` 初始化管理员）；单机自托管可设 `MUSIC_DL_DISABLE_AUTH=1` 跳过（等价 Go 桌面模式）。

## 目录结构

```
├── app/
│   ├── page.tsx                 # 搜索首页（聚合搜索/链接解析）
│   ├── explore|collections|collection|local|settings|playlist|album/
│   ├── template.tsx             # 页面过渡动画
│   └── api/                     # 42 条 Route Handlers（与 Go 一一对应）
├── components/
│   ├── shell/app-shell.tsx      # 侧边栏/底部Tab 外壳
│   ├── player/                  # 播放条 + 全屏播放页
│   ├── song-list.tsx            # 歌曲列表（PC 表格/移动卡片）
│   └── playlist-grid.tsx        # 歌单网格
├── lib/
│   ├── providers/               # 13 源解析器（TS 重写自 music-lib）
│   ├── client/                  # 前端 API 客户端 + zustand 播放器
│   ├── store.ts                 # SQLite（歌单/下载记录/去重/Cookie/索引/设置 + favorites 迁移）
│   ├── download-flow.ts         # 下载核心（探测/Range 并行/元数据嵌入/去重落盘/WebDAV/ffmpeg 解析）
│   ├── range-fetch.ts           # 并行分块下载（32KB 首块+256KB×16 并发+短读校验）
│   ├── lyrics.ts                # 歌词管线（LRC/YRC/KRC 多语言→verbatim 输出）
│   ├── write-guard.ts           # save_local 写保护（POST+XHR+同源）
│   ├── cookies.ts similarity.ts local-music.ts web-core.ts
│   ├── crypto.ts qrc.ts soda-crypto.ts
│   ├── netease/                 # api-enhanced 全量移植：五通道加密运行时 + 439 接口模块 + 注册表
│   └── registry.ts types.ts     # 源注册表与契约
├── tests/                       # vitest 单元测试（85 例）
└── next.config.ts tsconfig.json vitest.config.ts
```

## 扩展新音源

在 `lib/providers/` 新建 provider 并注册到 `lib/registry.ts`（可选能力用 `?` 表达）：

```ts
export const xxx: MusicProvider = {
  name: "xxx", label: "XXX音乐",
  async search(keyword) { /* ... */ },
  async getStreamUrl(song) { /* ... */ },
  // 可选：parse/getLyric/searchAlbum/getAlbumSongs/parseAlbum/
  // searchPlaylist/getPlaylistSongs/parsePlaylist/getRecommendedPlaylists/
  // getPlaylistCategories/getCategoryPlaylists/getUserPlaylists/createQRLogin/checkQRLogin
};
```

## 声明

本项目接口实现移植自 [go-music-dl](https://github.com/guohuiyuan/go-music-dl)（AGPL-3.0），仅供学习与技术交流，请勿用于商业用途；下载的资源请于 24 小时内删除，支持正版音乐。
