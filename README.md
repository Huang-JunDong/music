# Music DL — 全网音乐聚合搜索 / 试听 / 下载

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
| 加密 | Node 内置 crypto（网易云 weapi/linux eapi、QQ QRC 变体 3DES、酷狗 KRC、酷我 zlib+XOR+GB18030、汽水 PlayAuth/CENC 解密等） |
| 测试 | vitest（65 例：歌词 verbatim 管线 / SongKey / 文件名模板 / 签名探测 / mime 表 / 设置规范化 / 相似度） |

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

## 前端功能

- **聚合搜索**：单曲/歌单/专辑三种类型 + 13 源多选筛选 + 分享链接自动识别解析
- **歌单广场**：每日推荐 / 分类浏览 / 我的收藏（Cookie 源）
- **我的歌单**：自建歌单 CRUD、外部歌单/专辑导入、单曲/批量收藏、本地音乐入库
- **本地音乐**：扫描/上传/删除/重复检测/播放缓存，内嵌封面与歌词自动读取
- **播放器**：全局播放条 + 全屏播放页（**卡拉 OK 逐字高亮**：网易云 YRC / QQ QRC / 酷狗 KRC 词级歌词逐词渐变着色 + 罗马音/译文副行，其他渠道行级渐变；点击跳播）、**Range 实测音质徽章**（码率·大小）、队列管理、随机/循环、空格键控制、MediaSession（系统媒体键/锁屏控制）、失效自动换源
- **设置**：扫码登录（网易云/QQ/酷狗/酷我/B站）、手动 Cookie、播放与下载选项（元数据嵌入 / 服务器落盘 / 并发数 / 文件名模板）、WebDAV 同步、GitHub 更新源与代理、下载记录
- **双端适配**：PC 侧边栏布局 + 移动底部 Tab/mini 播放条，触控目标 ≥44px，动效遵循 `prefers-reduced-motion`

## 快速开始

```bash
npm install
npm run dev        # 开发模式（Turbopack），打开 http://localhost:3000
npm test           # 运行 65 例单元测试（vitest）
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
│   └── registry.ts types.ts     # 源注册表与契约
├── tests/                       # vitest 单元测试（65 例）
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
