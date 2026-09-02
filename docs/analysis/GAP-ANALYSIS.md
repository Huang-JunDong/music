# go-music-dl → music-dl-next 逐项对齐分析（临时分析文档）

> 基准：`.ref/go-music-dl`（Gin 版，AppVersion 1.1.0）+ `.ref/music-lib`（Provider 库）
> 对照：本仓库 Next.js 15 / React 19 / Tailwind v4 / better-sqlite3
> 本文档由 4 路并行代码对比汇总，用于逐项比较与修复跟踪。修复完成后逐项勾选。

## 0. 架构性总差异（适用全部路由）

| # | 差异 | 处置 |
|---|---|---|
| A1 | Go SSR HTML（renderIndex）vs Next JSON API + React 页面 | 保持 Next 架构；错误"200+HTML"统一转为 JSON+显式状态码（有意改进） |
| A2 | 路由前缀：Go `RoutePrefix=/music`（可配 `--base-path`）vs Next `/api` | 保持 `/api` |
| A3 | **鉴权体系整体缺失**：Go 有 setup token（24B base64url 打印到 stdout）、/login /setup /logout、HMAC-SHA256 会话 Cookie（7 天、iat±2min、SameSite=Lax、HttpOnly）、按 `user|IP` 指数退避防爆破（1s<<min(n,6)，上限 60s）、configAPI 分组鉴权（cookies/settings POST/DELETE records/qr_login）、wantsHTML/AJAX 401 分流、safeAuthRedirectTarget | **P0 补齐**（见 F 组） |
| A4 | CORS：Go 全局 `*` + Allow-Credentials | Next 无需（同源） |
| A5 | Cookie 存储：Go SQLite `cookieEntry` vs Next `data/cookies.json` | ✅ 已对齐：Next 迁移到 app.db `cookies` 表（B11） |
| A6 | Go 启动时后台 goroutine 全量扫描下载目录建本地索引 | ✅ 已对齐：instrumentation 启动调用 refreshLocalMusicScanAsync（B11） |

## 1. 路由覆盖矩阵（Go 58 条 → Next 41 文件）

### 1.1 音乐核心（music.go）
> 2026-09-02 第三轮复核后矩阵已全部收敛：下列各项均已完成对齐（细节见 §3 修复清单 B/F 组）。

| Go 路由 | 状态 | Next 文件 | 备注 |
|---|---|---|---|
| GET / | ✅ | app/page.tsx | 页面等价 |
| GET /recommend | ✅ | api/recommend | `{tabs,error}` 汇总（B7）；前端按已勾选源交集过滤（F14） |
| GET /user_playlists | ✅ | api/user_playlists | 同上；固定 `(1,50)`；前端交集过滤（F14） |
| GET /playlist_categories | ✅ | api/playlist_categories | 失败源不生成 view + 汇总 error（B7） |
| GET /category_playlists | ✅ | api/category_playlists | `(1,120)`✅；category_name 回退链✅；source_name 已回传✅ |
| GET /search | ✅ | api/search | import_collection 含 hover_text（B3）；空 q 400 为有意改进 |
| GET /playlist | ✅ | api/playlist | import_collection 输出齐全（B3） |
| GET /album | ✅ | api/album | 同上 |
| GET /album_jump | ✅ | api/album_jump | 302 等价；pickBestAlbumMatch ✅ |
| GET /inspect | ✅ | api/inspect | 在线 5s/206/Content-Range✅；本地 probe+bitrate+缓存（B11） |
| GET /switch_source | ✅ | api/switch_source | 5 常量✅；全局验证取最优可播（B4）；高分捷径流式到达即验（B12） |
| GET+POST /download | ✅ | api/download | 六分支齐全：本地/save_local/embed/soda/RangeFetch 并行分块/普通流（B6）；WebDAV 缓冲上传✅；流式无超时✅ |
| GET+POST /download_lrc | ✅ | api/download_lrc | format/X-Lyric-Format/404/save_local✅；name/artist 用原值（B12） |
| GET+POST /download_cover | ✅ | api/download_cover | 502 为有意改进（§5） |
| GET /cover_proxy | ✅ | api/cover_proxy | FetchBytesWithMime 并行通道（B10）；Cache-Control 21600✅ |
| GET /lyric | ✅ | api/lyric | 兜底纯音乐文案✅ |
| GET /api/downloads/records | ✅ | api/downloads/records | Go 大写字段（B5） |
| DELETE /api/downloads/records | ✅ | api/downloads/records | 清记录留去重表 ✅ |
| POST /api/downloads/precheck | ✅ | api/downloads/precheck | 20MB/20000/500 ✅ |

### 1.2 收藏集（collection.go）+ 本地音乐（local_music.go）
26 条对照全部有实现（`my_collections/collection/local_music_page` 为 Go HTML 页，Next 用 /collections、/collection、/local 页面等价替代）。细节差异（P2 为主）：
- include_imported 过滤语义、分页参数、级联删除（Go FK 级联 vs Next 手动事务，行为等价）—— **F20e 已抽查确认语义一致**
- auto_cache / batch_match / duplicates / reindex / upload / cover：算法参数已移植，相似度常量已抽查（F20e：duplicates 分组/排序/存在性过滤一致）
- local_music_index：字段/增量/stale 清理逻辑已移植，启动自动扫描已确认（A6/B11 + F20e 复核）

### 1.3 配置/鉴权/更新/视频
| Go 路由 | 状态 | Next | 备注 |
|---|---|---|---|
| GET /healthz | ✅ | api/healthz | app 名刻意不同（保留） |
| GET /settings | ✅ | api/settings | 脱敏 ✅ |
| POST /settings | ✅ | api/settings | 响应脱敏（B1）；合并 patch 为有意改进（§5） |
| HEAD /cookies | ✅ | api/cookies | 204（B10） |
| GET/POST /cookies | ✅ | api/cookies | 鉴权守卫（B2）；SQLite 存储+旧文件迁移（B11/A5） |
| POST/GET /qr_login/:source | ✅ | api/qr_login/[source] | qq_wx 微信通道（B8）；cookie 存 qq 名下 ✅ |
| GET /app_update/check | ✅ | api/app_update/check | APP_VERSION 1.1.0（B9） |
| GET /github_proxy/test | ✅ | api/github_proxy/test | ✅ |
| POST /videogen/init|frame|finish | ✅ | api/videogen/* | 帧顺序校验对齐 Go writeFrameBatch（`startIdx !== total` 拒绝乱序，2026-09-02 复核） |
| GET /videos/* | ✅ | api/videogen/file/[name] | Range 206/416、basename 防穿越 ✅ |
| GET/POST /setup、/login、/logout | ✅ | api/{setup,login,logout} + /login 页 | 鉴权体系（B2/F10） |
| GET /render（视频渲染页） | ✅ | app/render/page.tsx | VideoGen 渲染页（F11；F20a 升级词级 karaoke） |

## 2. 前端功能差距（对照 app.js 7267 行 / videogen.js 1538 行 / 10 模板）

> 2026-09-02 三轮修复后全部收敛（1–25 项对应 §3 F 组修复记录；25 项含本轮 F14 补齐的移出二次确认）。
> 形状差异：Go 服务端分页（500/页）的"翻页组"按钮不适配 Next 客户端全量列表模型 —— 已由 SongList 增量渲染替代（初始 200 行 + 滚动自动追加，F20d），大歌单渲染性能对齐商业化标准（有意差异，§5-6）。

### P0（核心交互缺失）→ 全部 ✅
1. **批量操作体系** ✅（F1）
2. **保存到服务器目录** ✅（F2）
3. **逐行音质检测** ✅（F3）
4. **换源行内更新** ✅（F4）
5. **播放队列 UI + 播放历史** ✅（F5）
6. **倍速播放** ✅（F6）
7. **MediaSession API** ✅（F6）

### P1（功能点缺失）→ 全部 ✅
8. 歌手名精确搜索 ✅（F7）
9. 专辑跳转 ✅（F7）
10. 歌名外链 ✅（F7）
11. 下载歌词/封面 ✅（F7）
12. 搜索类型切换联动 ✅（F8）
13. CollectSheet 内新建歌单 ✅（F9）
14. 登录/初始化页 ✅（F10）
15. VideoGen 渲染页 ✅（F11）
16. 下载记录独立页 ✅（F12）
17. 推荐页按已勾选源过滤 ✅（F14，本轮）

### P2（细节）→ 全部 ✅
18. ?open_config=1 ✅（F13）
19. 悬浮工具栏回顶/回底 ✅（F13；翻页组见上方形状差异说明）
20. 搜索提交后滚动到结果区（小屏）✅（F14，本轮）
21. 本地音乐"本地已有"标记+播放优先本地流 ✅（F13）
22. 删除二次确认 ✅（本地删除 ConfirmDialog 已有；歌单移出二次确认 F14 本轮补齐）
23. 源面板折叠记忆 ✅（F13）
24. 再点当前曲=停止并 seek 0 ✅（F13）
25. 歌单页管理视图移出歌曲 ✅（ManageList 已有 + F14 本轮补二次确认）

## 3. 修复清单（实施记录）

> 实施日期：2026-09-02。✅=已完成并经 `next build` + 生产实例冒烟测试验证。

### 后端 B 组
- [x] B1(P0) settings POST 响应脱敏 publicWebSettings() — `app/api/settings/route.ts` ✅（冒烟：回包 webdavPassword 恒为空）
- [x] B2(P0) 鉴权体系 — `lib/auth.ts`（scrypt 密码哈希 + HMAC-SHA256 会话 + 48bit nonce + 指数退避防爆破）+ `app/api/{setup,login,logout}/route.ts` + `instrumentation.ts`（启动打印 setup token）+ 守卫接入 cookies/settings POST/DELETE records/qr_login + `MUSIC_DL_DISABLE_AUTH=1` 逃生门 ✅（冒烟：未登录 401→setup token→初始化→登录 Set-Cookie→会话访问 200→错误密码 401+退避提示）
- [x] B3(P1) playlist/album 补 import_collection（query 组装+回退+hover_text）；search 复用共享 `lib/import-collection.ts` 并补 hover_text ✅
- [x] B4(P1) switch_source 全局验证改"收集后按排序取第一个可播"（对齐 Go validateSwitchCandidates）✅
- [x] B5(P1) downloads/records 字段名对齐 Go 大写（ID/Name/Artist/Source/Status/Error/CreatedAt）+ settings/downloads 页面适配 ✅（冒烟：字段与分页正确）
- [x] B6(P1) download：`lib/range-fetch.ts` 移植 NewSourceRangeFetch（probe 0-3→206→签名探测→32KB 首块+256KB×16 并发按序流式）；WebDAV 缓冲上传；album←extra.album 回退；移除普通分支记录写入；流式请求超时取消（timeoutMs=0）✅
- [x] B7(P1) recommend/user_playlists 返回 `{tabs,error}` 汇总；playlist_categories 返回 `{sources,error}` 且失败源不生成 view ✅（explore 页已适配）
- [x] B8(P1) qr_login qq_wx → createWXQRLogin/checkWXQRLogin（微信通道）✅
- [x] B9(P1) APP_VERSION → 1.1.0（route + package.json）✅
- [x] B10(P2) cover_proxy 走 FetchBytesWithMime（Range 并行通道+单请求回退）；HEAD /cookies → 204 ✅
- [x] B11(P2) inspect 本地分支 probe/cache 细节、cookies 迁 SQLite、启动自动索引扫描 — ✅（2026-09-02 第二轮）：
  - cookies 存储 SQLite 化（app.db `cookies` 表 + 旧 data/cookies.json 一次性迁移后删除，对齐 Go CM SQLite 语义）— `lib/cookies.ts`、`lib/store.ts`
  - instrumentation 启动钩子增加 `refreshLocalMusicScanAsync()`（对齐 Go syncLocalMusicIndexAsync：启动后台全量扫描下载目录同步索引）
  - 本地元数据补 `extra.bitrate`（music-metadata format.bitrate → kbps，对齐 Go ffprobe probeLocalMusicTrack 的 extra.bitrate）；inspect 本地分支读取该值；track 元数据已有 size+mtime 缓存（等价 Go cacheLocalMusicTrack）

### 第三轮（2026-09-02 晚）— B12 / F14
- [x] B12a(P2) switch_source 高分捷径流式化：每个源搜索完成即验其最佳候选（≥0.98 且时长差 ≤3s 且可播 → 立即返回，不等其余源），对齐 Go channel"到达即验"语义 — `app/api/switch_source/route.ts`
- [x] B12b(P2) download_lrc 在线分支 name/artist 去掉 Unknown 兜底，对齐 Go lyricSongFromQuery 原值拼接 — `app/api/download_lrc/route.ts`
- [x] B12c(核对) videogen 帧顺序：addFrames `startIdx !== total` 拒绝乱序/重复，等价 Go writeFrameBatch（videogen_order_test 场景覆盖）— `lib/videogen.ts:76-84`
- [x] B12d(核对) category_playlists 已回传 `source_name`（矩阵陈旧描述更正）
- [x] F14a(P1-17) 推荐页/我的收藏按首页已勾选源交集过滤：首页 sources 持久化 sessionStorage（`musicdl:selected-sources`），explore RecommendTab/MineTab 传入 apiRecommend/apiUserPlaylists（服务端 filterAvailableSources 交集），模块缓存按源集合 key 区分 — `lib/client/ui.ts`、`app/page.tsx`、`app/explore/page.tsx`
- [x] F14b(P2-20) 小屏搜索完成后平滑滚动到结果区（scroll-mt 避让 sticky 头）— `app/page.tsx`
- [x] F14c(P2-22/25) 本地歌单管理视图移出歌曲补二次确认弹窗（ConfirmDialog，对齐 Go confirm"确定将此歌曲移出当前歌单吗？"）— `app/collection/page.tsx`

### 第四轮（2026-09-02 深查）— Provider 层 + core 服务层（B15 / F15）
> 三路并行逐函数对比 `.ref/music-lib`（12 平台）与 `.ref/go-music-dl/core`。加密/签名常量全部核验一致
> （netease weapi/eapi/linuxapi、QQ vkey 七档+QRC 3DES、kugou v5/v6/songinfoV2/tracker 四级链、soda CENC、qianqian 91q 等）。

**高（4 项，全部修复）**
- [x] B15a WebDAV 默认远端目录回填 `music-dl`（normalizeWebSettings 移植：trim/空回填/去斜杠/concurrency 1–5 夹紧/URL 回填）— `lib/store.ts`
- [x] B15b WebDAV 空密码回存保留旧值（防脱敏 GET 回存清空）— `lib/store.ts`
- [x] B15c SongKey 对齐 Go：`artist - name`（保留大小写，空回退 Unknown；原为 `name|artist` 小写）+ 去重表空时 success 历史首次回填迁移 — `lib/download-record.ts`
- [x] B15d Range chunk 短读长度强校验（`len≠span` 即重试，防残块损坏音频）— `lib/range-fetch.ts`

**中（全部修复）**
- [x] B15e 默认值对齐：embedDownload=true / webPageSize=200 / vgChangeCover=Lyric=false / githubProxyUrl=edgeone.gh-proxy.com / 模板 `{artist} - {name}`（无 {ext} 时末尾追加，占位符集不变）— `lib/store.ts`、`lib/web-core.ts`
- [x] B15f 随机 IP 头对齐：X-Forwarded-For + X-Real-IP 双头同值 + Go 9 组前缀；migu 域名按 Go 语义跳过注入 — `lib/http.ts`
- [x] B15g 音频主链路接入 Range 并行下载（Go FetchBytesWithMime：优先 32KB+256KB×16 并行，回退单请求 120s，CT 空按魔数推断、剥分号；去 32MB 上限）；封面仍走单请求（对齐 Go）— `lib/range-fetch.ts`、`lib/download-flow.ts`
- [x] B15h 签名探测分支顺序/门槛对齐 Go（MPEG sync 2 字节即可命中，4 字节 probe 下裸 mp3 可识别）；`bytes=0-` 判 partial（206+Content-Range）— `lib/range-fetch.ts`
- [x] B15i Content-Type→ext 表对齐 Go（x-flac/wma×4/x-mp3/aac+aacp→m4a；删除自创 wav 映射）— `lib/web-core.ts`
- [x] B15j kugou/kuwo/migu getStreamUrl 补 `song.url` 直链短路（避免重复触发上游取流/风控）— 各 provider
- [x] B15k netease 搜索对齐：limit 20→10、VIP 账号不过滤 fl==0（IsVipAccount 联动）、bitrate 兜底 128、歌手拼接不去空名 — `lib/providers/netease.ts`
- [x] B15l kuwo 搜索对齐：rn 20→10、请求带 Cookie；MINFO 解析对齐（size：mp3128→320→flac2000→flac→最大；bitrate：128→320→2000→800，空默认 128）— `lib/providers/kuwo.ts`
- [x] B15m migu 搜索 pageSize 20→10；302 判定收窄为仅 ===302 — `lib/providers/migu.ts`
- [x] B15n 歌词管线完整移植 Go lyrics 包：VTime/VWord/VLine/MultiData 模型、ParseLRC（词级）/ParseYRC/ParseKRC（language tag→roma/ts 多语言）/ConvertVerbatimLRC（ti/ar/al 头 + orig→roma→ts 逐行交错 + 词级时间戳）— `lib/lyrics.ts`
  - netease getLyric：yrc 逐字优先 + romalrc/tlyric 三语 + ConvertVerbatimLRC（对齐 Go netease/lyric.go）
  - kugou getLyric：KRC 完整解析（含内嵌翻译/罗马音）+ ConvertVerbatimLRC（对齐 Go kugou/lyric.go）
  - kuwo getLyric：convertKuwoNewLyric 移植（原文行后独立 roma/translation 行、保留 tag 行、中文/罗马音判定）— 替代原"译文内联"格式
- [x] B15o 嵌入前既有元数据回填（music-metadata 读取补空 title/artist/album/lyrics；mp3 无新封面时复用内嵌封面）— `lib/download-flow.ts`
- [x] B15p WebDAV BasicAuth 无条件发送（对齐 Go）；ext 空不设 Content-Type — `lib/download-flow.ts`
- [x] B15q kugou 搜索 size 链补 ResFileHash→ResFileSize；HTML 实体解码扩充（命名+数字实体）— `lib/providers/kugou.ts`
- [x] B15r soda VIP 缓存按 cookie 键控（实例语义：cookie 变化即失效）— `lib/providers/soda.ts`
- [x] B15s cookies 表补 updated_at；迁移对齐 Go（保留 cookies.json、表空才迁、DO UPDATE）— `lib/store.ts`、`lib/cookies.ts`
- [x] B15t download records 分页上限 100→200（对齐 Go）；前端 formatSize 一位小数 — `lib/download-record.ts`、`lib/types.ts`

**核验一致（无需修改）**：qianqian/joox/bilibili/fivesing/jamendo/apple 全部逻辑；soda 下载/解密/QR/MFA；QQ 全链路（含微信扫码）；kugou 云歌单/设备注册；kuwo GB18030 解密链；videogen 帧顺序；category_playlists source_name；BuildSourceRequest header 矩阵（kugou/kuwo 多注入 Referer 为增强保留）；相似度算法常量；DetectSource/GetOriginalLink；WebSettings 23 字段清单。

**剩余低影响差异（有意保留，见 §5）**：默认 UA 版本号（134 vs 91，增强）；http 层默认 15s 超时（kuwo/kugou 关键请求已显式 8s/10s）；kugou 设备注册 CT 头 text/plain（修正了 Go 缺失）；joox 封面切片越界保护（修正了 Go 潜在 panic）；~~fivesing/jamendo 顺序→并发待优化~~（F20b/F20c 已并发化）；apple token 正则稍宽松；netease eapi JSON key 字面序（服务端语义等价）。

### 第五轮（2026-09-02 完善）— B16 歌词链路联动核验 + 单元测试体系
- [x] B16a(核验) `lib/lyrics-format.ts` 与 Go lyrics_format.go **逐行一致**（classify karaoke/line 判定、format=line 去词级时间戳+按时间戳去重+排序+tags 空行）✅ 无需修改
- [x] B16b(核验) `lib/write-guard.ts` 与 Go write_guard.go **逐行一致**（XHR 头 + Origin host 比对 + Sec-Fetch-Site 白名单 + 405/403 语义）✅ 无需修改
- [x] B16c(联动修复) 播放器歌词改走 `format=line`（对齐 Go lyricURLsForPlayback：APlayer 的 lrc 用 line 模式 URL）— `lib/client/store.ts`
- [x] B16d(联动修复) 前端 `parseLrcClient` 兼容 karaoke 词级行：行内非连续时间戳全部剥除、文本拼接（对齐 APlayer 渲染语义；行首连续多时间戳的多行语义保留；"原文（译文）"合并保留）— `lib/lrc-client.ts`
- [x] B16e(新增) **vitest 单元测试体系**（Go 版有完整测试矩阵，Next 侧原为零）：
  - `vitest.config.ts` + `package.json` 增加 `test` / `test:watch` 脚本
  - `tests/lyrics.test.ts`（27 例）：ParseLRC 词级/毫秒归一化/行尾推断、ParseYRC、ParseKRC 词级 offset 与 language 多语言（type 0 roma 逐词对位 / type 1 ts 整行）、ConvertVerbatimLRC（tags 头 + orig→roma→ts 交错 + 词级时间戳含词尾）、convertKuwoNewLyric（roma/translation 独立行顺序 + 中文译文 payload 跳过）
  - `tests/lyrics-format.test.ts`（10 例）：classify（行级/词级/重复时间戳/tags 豁免）、line 模式转换与边界（纯时间戳行剔除）、前端 karaoke 兼容解析
  - `tests/core.test.ts`（28 例）：SongKey（大小写/空值/控制字符）、buildDownloadFilename（无 {ext} 追加/占位符/穿越清洗/空模板回退）、detectExtBySignature（4 字节 probe mp3 sync/wma 16 字节 GUID/ftyp 12 字节门槛）、detectExtByContentType 全表、audioMimeByExt、parseContentRangeTotal、sanitizeDownloadRelativePath、normalizeWebSettings（回填/夹紧/去斜杠）、相似度与 IsDurationClose（±10s 或 ±15% 宽限）
  - 首轮 8 个失败用例经与 Go 源码复核全部为**测试期望偏差**（词级 start 取前一时间戳 end、词尾时间戳输出、KRC 毫秒行头、concurrency ≤0 先回填 3、±15% 宽限、tags 空行索引），修正后 **65/65 通过** — 测试即对 Go 语义的回归锚点
- 验证：`npm test` 65/65 ✅、`npx tsc --noEmit` 零错误 ✅、`next build` 编译成功 ✅

### 第六轮（2026-09-02）— B17 ffmpeg/npm 依赖完善
- [x] B17a **ffmpeg-static 兜底**（optionalDependencies + `serverExternalPackages`）：`resolveFFmpegPath`（download-flow）与 `resolveFFmpeg`（videogen）解析顺序改为 PATH → `MUSIC_DL_FFMPEG` 环境变量（补齐 Go ResolveFFmpegPath 语义）→ ffmpeg-static 动态 require；本机无系统 ffmpeg 实测两条链均解析到 `node_modules/ffmpeg-static/ffmpeg.exe` ✓（此前此机器元数据嵌入必跳过、视频渲染必 501，现在开箱即用）
- [x] B17b(修复) `parseBuffer` 用法错误：第二参是 fileInfo 而非 options；且 music-metadata 11.15 + file-type 21.3 的 **mime 嗅探路径对 mp3 误判**（`audio/mpeg` 查表 miss 抛 UnsupportedFileTypeError）——统一改传 `{ path: "file.<ext>" }` 走扩展名分发绕过（`local-music.ts` 用 parseFile 不受影响）；端到端实测：嵌入 8612→9124B，title/artist/album/封面读回全部正确 ✓（ffmpeg 写 mp3 USLT 歌词帧的读取兼容性记为已知差异，非关键）
- [x] B17c(盘点) **歌词解析 npm 依赖结论**：QRC 为 QQ 变体 3DES（非标准密钥序+自定义 SBOX，Node crypto 不可替代）、KRC/YRC/kuwo yeelion/GB18030 均为平台私有格式——npm 生态无对应包，自研移植（lib/qrc.ts、lib/lyrics.ts、lib/soda-crypto.ts）是唯一正确方案；zlib（KRC/QRC 解压）与 GB18030（TextDecoder）用 Node 内置，无额外依赖需要。**ffprobe 无需 npm 化**：Go 的 ffprobe 职责（时长/码率/标签探测）已由 music-metadata 全覆盖
- 验证：`npm test` 65/65 ✅、`tsc --noEmit` 零错误 ✅、`next build` ✓ 3.5s；临时探针脚本已清理

### 第七轮（2026-09-02）— B18 ffmpeg 链路闭环 + 环境状态 + README 同步
- [x] B18a(实测) **视频渲染全链路打通**：ffmpeg-static 下 6 帧 jpg → renderVideo 合成 mp4（2389B）✓（此前本机无系统 ffmpeg 时 /render 必 501）
- [x] B18b(验证) **USLT 歌词帧写入确认**：ffmpeg dump 显示嵌入后 mp3 含 `lyrics : [00:00.00]测试歌词`（ID3v2 USLT + ID3v1 双写）；此前 music-metadata 读回 false 属其 v11 对 id3v2.3 USLT 的读取兼容性，产物对主流播放器合格 — 无需修复
- [x] B18c(新增) `GET /api/system/status`：ffmpeg 可用性/来源（path/builtin/env/unavailable）、下载目录、版本/平台 — `app/api/system/status/route.ts` + `apiSystemStatus` 客户端
- [x] B18d(前端) 设置页新增「环境状态」卡（ffmpeg 徽章 + 下载目录 + 版本/平台，加载失败静默隐藏）；「下载时嵌入元数据」hint 与 /render 页 501 文案、说明文案更新为"系统或内置 ffmpeg" — `app/settings/page.tsx`、`app/render/page.tsx`
- [x] B18e(文档) **README 全面同步**：45 条 API、鉴权已迁移（修正"未迁移"错误陈述）、cookies.json→SQLite、音源矩阵更正（咪咕/汽水/Apple 歌词 ✅、酷我扫码 —、QQ 含微信通道、酷狗含云歌单、网易云 YRC/罗马音）、ffmpeg 三级解析说明、`npm test`、目录结构补 tests//range-fetch/lyrics 等
- 验证：`tsc` 零错误 ✅、`npm test` 65/65 ✅、`next build` ✓ 5.1s、冒烟 `/api/system/status` 返回 `ffmpeg_source:"builtin"` + settings 页 200 ✅

### 第八轮（2026-09-02）— B19 卡拉 OK 逐字高亮 + 播放页 Range 音质（超出 Go 的前端增强）
> 用户能力清单核验：此前"原文/译文/罗马音 verbatim 输出"仅到服务端，**前端卡拉 OK 逐字高亮未实现**（播放器走 format=line 拿不到词级数据）；播放页无大小/码率显示（仅列表页有）。本轮补齐消费层。

- [x] B19a `lib/lrc-client.ts` 重写为词级解析器：`ClientLyricWord {start,end,text}` + 行级/词级双兼容——行首连续多时间戳→多行、行内夹时间戳→karaoke 切词（坐标系归一修复）、**同时间戳独立行归并**（拉丁→romaji / 汉字→translation，匹配 ConvertVerbatimLRC orig→roma→ts 输出特征）、"原文（译文）"内联兜底保留
- [x] B19b `store.loadLyrics` 改回 `format=auto`（拿 verbatim 原文；行级渠道 auto 即原文逐行，自动满足"其他渠道保持行级"）
- [x] B19c `now-playing.tsx` **卡拉 OK 逐字高亮**：active 行逐词渲染（KaraokeWord 双层结构，覆盖层按词内进度 width% 显示 violet→fuchsia→cyan 渐变，已唱全亮/演唱中比例过渡/未唱暗色；CJK 词间距处理）；romaji 副行（斜体 cyan）+ translation 副行（fuchsia）双行显示；非 karaoke 行保持行级渐变
- [x] B19d `now-playing.tsx` **Range 探测音质显示**：切歌时调 `/api/inspect`（Range bytes=0-1 实测），badge 旁显示 `码率 · 大小` 徽章；失败回退 Song 自带 bitrate/size（搜索结果估计值）
- [x] B19e(测试) 新增 3 例：词级片段保留（start/end/text）、同时间戳独立行归并（romaji/translation）、YRC 实际形态（主行带 words + 副行归并）— **68/68 通过**
- [x] B19f(端到端) 真实网易云"晴天"验证：服务端 verbatim 输出 → 前端 43 行、42 行 karaoke 词级 ✓（纯中文曲无罗马音/译文属数据本身特性）
- 验证：`tsc` 零错误 ✅、`npm test` 68/68 ✅、`next build` ✓ 3.7s

### 第九轮（2026-09-02 夜）— F20 词级 karaoke 视频渲染 + 遗留初级项商业化完善
> 用户要求：/render 页词级 karaoke（Canvas 逐帧）+ 文档中未完善/初级项继续完善不可跳过。

- [x] F20a **/render 词级 karaoke 渲染**（替代原"逐行歌词进度"初级实现）：
  - 新增 `lib/render-layout.ts` 纯模块（度量上下文最小契约，可注入 mock）：词级时间轴规范化（末词 end 缺失用后词 start/行末兜底、跨度保正）、按词贪心换行（词不拆分）、行级渠道按空白 token 换行 + 单 token 超宽字符硬切、**行级多物理行按宽度比例分摊行时间**（平滑逐行填充）、副行（罗马音/译文）单行截断、物理行上限 3 行截断加省略号、块高度公式
  - `app/render/page.tsx` 重写歌词绘制：**逐词渐进填充**（每词按 (nowMs-start)/(end-start) 裁剪 clip 宽度，底字暗色 + 已唱部分 violet→fuchsia→cyan 全行连续渐变 + shadowBlur 发光）、译文/罗马音副行（当前块 fuchsia/cyan、其余暗色）、行首 220ms 淡入、YRC/QRC/KRC 词级 / 其他渠道行级自动降级
  - **性能**：歌词在渲染前一次性预布局（帧循环零 measureText），长歌 30fps 渲染不掉帧
  - 测试 `tests/render-layout.test.ts`（12 例）全部通过（总 80/80）
- [x] F20b **jamendo fetchTracks 并发化**：逐轨详情拉取由顺序循环改为并发 4（对齐 Go errgroup SetLimit(4)），结果按曲目顺序占位回填、首错保留 — `lib/providers/jamendo.ts`（清掉 B15 遗留"fivesing/jamendo 顺序→并发待优化"中的 jamendo 项）
- [x] F20c **fivesing searchPlaylist creator 并发补齐**：缺失 userName 的项由循环内串行 await 改为 Promise.all 并行拉取（失败保留 ID 占位、结果顺序不变）— `lib/providers/fivesing.ts`
- [x] F20d **SongList 大列表增量渲染**（商业化性能，收敛 §2/§5-6 翻页组形状差异）：初始渲染 200 行 + IntersectionObserver（rootMargin 600px）滚动自动追加 300 行 + "显示更多"按钮兜底；选择/批量操作仍作用于全量；本地匹配与"检测音质"限定可见行（翻页后增量匹配，模块级缓存共享）— `components/song-list.tsx`
- [x] F20e(抽查) §1.2 遗留"需抽查"项复核：
  - include_imported 过滤语义：默认仅 manual（`kind='manual' OR kind=''`），`?include_imported=1` 全量 — `app/api/collections/route.ts:11-18` ✓ 与 Go 一致
  - duplicates 分组：`GROUP BY name,artist HAVING COUNT(*)>1`、组内按 size DESC、文件存在性过滤（isDirectory/stat 失败剔除）、<2 项丢弃 — `app/api/local_music/duplicates/route.ts:39-91` ✓
  - 启动自动扫描：`instrumentation.ts` → `refreshLocalMusicScanAsync()` ✓（A6/B11 已对齐，复核无回归）
- 验证：`npm test` **80/80** ✅、lint 零问题、`next build` ✓

### 前端 F 组
- [x] F1(P0) 批量操作条（批量开关/全选/批量收藏/批量下载=precheck 确认+3 并发+进度 toast）— `components/song-list.tsx` ✅
- [x] F2(P0) save_local"保存到服务器"按钮（每行 + 批量）+ path/warning/webdav_error/skipped toast ✅
- [x] F3(P0) inspect 逐行检测（100ms 节流队列 + 大小/码率 tag + 失败"无效"）✅
- [x] F4(P0) 换源行内更新（onSongsChange 回写列表，对齐 updateCardWithSong）✅
- [x] F5(P0) 播放队列/历史抽屉（`components/player/queue-drawer.tsx`：队列+历史双 tab、移除、清空；PC 右滑/移动上滑）✅
- [x] F6(P0) 倍速（0.5–2.0 六档循环，播放条 Gauge/Nx 按钮）+ MediaSession（store 已有，保留）✅
- [x] F7(P1) 歌手精确搜索（feat./、，,;& 拆分多歌手独立链接）/ 专辑跳转（album_id 直跳 + album_jump 兜底）/ 歌名源站外链 / 下载歌词+封面（更多菜单）✅
- [x] F8(P1) 搜索联动：类型切换禁用不支持源并自动取消勾选、placeholder 三态、源面板全选/清空 ✅
- [x] F9(P1) CollectSheet 批量收藏 + 抽屉内新建歌单 ✅
- [x] F10(P1) 登录/初始化页（`app/login/page.tsx`：setup token 表单+登录表单）+ api 客户端 401 全局事件 + AppShell 跳转/登出 ✅
- [x] F11(P1) VideoGen 渲染页（`app/render/page.tsx`：canvas 30fps 逐帧=旋转封面+渐变背景+歌词，30 帧批量上传，finish→预览/下载，501 ffmpeg 提示，可取消）✅（歌词已由 F20a 升级为词级 karaoke 逐字高亮）
- [x] F12(P1) 下载记录独立页（`app/downloads/page.tsx`：分页/清空/状态图标）+ 导航入口 ✅
- [x] F13(P2) ?open_config=1、悬浮回顶底、源面板折叠记忆、本地已有标记、再点当前曲=停止 — ✅（2026-09-02 第二轮）：
  - `?open_config=1` → AppShell 自动跳转 /settings 并清理参数（对齐 Go 打开配置抽屉）
  - `components/floating-toolbar.tsx`：右下悬浮工具栏（回顶部/回底部，滚动超一屏出现，spring 动画，reduced-motion 降级，双端自适应播放条/导航位置）
  - 源面板折叠状态 sessionStorage 记忆（`musicdl:source-panel`）
  - 本地已有标记 + 播放优先本地：SongList 渲染后 300ms 防抖批量 batch_match（模块级缓存对齐 Go localMusicMatchCache），行内"本地已有"徽章（title 含格式/大小/播放提示），播放时替换为本地源 song（对齐 Go playbackSong 构造）
  - 再点当前播放曲 = 停止并 seek 0 + 清除当前标记（对齐 Go playAllAndJumpTo 的 pause+seek(0)+currentPlayingId=null；store 新增 stop()）

### UI/UX U 组
- [x] U1 视觉体系：暗色玻璃拟态 + 品牌渐变（violet→fuchsia→cyan）+ 背景光晕/网格纹理 + 源徽章配色（含新增 qq_wx 微信绿）✅
- [x] U2 动画：列表 stagger 渐入、layoutId 滑动指示器（tab/导航/队列）、spring 抽屉弹窗、唱片均衡器、shimmer 骨架、进度条 motion ✅
- [x] U3 双端一致：PC 侧边栏+完整播放条+右滑抽屉 / 移动底部 Tab+mini 播放条+上滑抽屉；触控目标≥44px（min-h-[44px]/h-11 规范）；safe-area 适配；导航 7 项双端同构 ✅
- [x] U4 性能：img lazy、模块级 SWR 缓存（explore）、100ms 节流 inspect、批量下载并发 3、URL 驱动状态 ✅
- [x] U5 边界与异常：401 全局分流、空态/骨架/错误重试（TabError）、预检确认弹窗、WebDAV/嵌入 warning toast、取消失效自动换源（最多 2 次）、双confirm 清空 ✅

## 4. 验证记录

- 第九轮（F20 词级 karaoke + 初级项完善后）：`npm test` **80/80** 通过（新增 render-layout 12 例：词级时间兜底/换行不拆词/多词合并/行级时间比例插值/副行截断/行数上限/块高度/末行兜底）；lint 零问题；`next build` ✓
- `npm run build`：✓ 全部编译通过（44+3 API 路由、11 页面）
- 冒烟（生产实例）：healthz ok / records Go 字段+分页 / playlist_categories 200 / 未登录 401 / setup-token 初始化 / 登录 Set-Cookie / 会话访问 cookies 200 / 错误密码 401+防爆破 / settings POST 响应脱敏
- 第二轮冒烟（2026-09-02，MUSIC_DL_DISABLE_AUTH=1 + next start）：
  - `/api/healthz` 200；`/api/cookies` 返回 SQLite 迁移后的完整 cookie（旧 cookies.json 已自动迁移并删除）
  - `/api/local_music` 返回 dir/total/exists；`/api/local_music/batch_match` 返回 `{matches:[]}`
  - 首页 / 设置页 200 渲染；`npx tsc --noEmit` 零错误
- 第三轮（B12/F14 后）：`npx tsc --noEmit` 零错误、lint 零问题、`npm run build` 通过
- 第四轮（B15 Provider/core 深查后）：`npx tsc --noEmit` 零错误、lint 零问题、`npm run build` 通过；生产实例冒烟：
  - `/api/settings`：webdavDir 自动回填 `music-dl`；旧库存留合法值按 Go 语义保留（仅非法值修正）
  - 四源搜索：kuwo=7 / migu=1 / kugou=10（均 ≤10 对齐 Go limit）；netease 直调验证正常（上游对无 cookie 请求风控导致 privilege.fl=0 过滤，VIP 联动逻辑按 Go 语义工作，bitrate 兜底生效）
- 第五轮（B16）：`npm test` 65/65 通过（vitest，覆盖歌词 verbatim 管线/格式化/前端解析/SongKey/文件名/签名探测/mime 表/settings 规范化/相似度）；`npx tsc --noEmit` 零错误；`next build` ✓ Compiled successfully
- 注意：冒烟期间在 `data/app.db` 初始化了测试管理员 `admin / test123456`，如需重置：删除 `data/app.db` 中 `web_settings` 表 `k='auth'` 行（或整库删除，收藏数据会一并清除）；本地单人使用可在启动时设 `MUSIC_DL_DISABLE_AUTH=1` 跳过鉴权（对齐 Go 桌面模式）。

## 5. 有意保留的差异（不视为缺陷）

1. JSON API + 显式状态码取代 200+HTML 错误页
2. settings POST 合并语义（Go 全量替换易误清空）
3. download_cover 上游失败 502（Go 200 空 body，前端无法感知失败）
4. search 空 q 400（避免无意义上游风暴）
5. Next 额外增强：search errors 数组、lyric 缓存头、search sources 逗号分隔支持
6. Go 服务端分页（500/页）的悬浮"翻页组"不适配 Next 客户端全量列表模型，由悬浮回顶/回底 + 浏览器原生滚动 + SongList 增量渲染（初始 200 行滚动自动追加，F20d）替代
7. 密码哈希 scrypt（Node 内建）替代 bcrypt，强度对齐（N=16384）
