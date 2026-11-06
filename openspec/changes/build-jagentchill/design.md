## Context

JAgentChill là repo mới (`hdc/jagentchill`). Kết quả khảo sát nằm trong `docs/research/` và là nguồn sự thật cho mọi
khẳng định về hành vi tham chiếu:

| File | Nội dung | Phát hiện quyết định thiết kế |
|---|---|---|
| `capcut-parity-benchmark.md`, `capcut-mobile-ui-reference.md` | 291 chức năng CapCut, cấu trúc editor mobile | Chuẩn chức năng; 32 dòng UNVERIFIED |
| `opencut-classic-inventory.md` | 515 dòng PORT-CHECKLIST, schema lưu trữ v31 | Repo `opencut` hiện tại không có editor; classic thiếu transition, chỉnh màu, fade, export chi tiết; có 6 lỗi nghi vấn |
| `openclaw-reference.md`, `openclaw-plugin-feasibility.md`, `openclaw-agent-capabilities.md` | OpenClaw 2026.9.8 @ `0816aa1b` | Gateway daemon + plugin; UI upstream là Lit/Swift/Kotlin; 1 Gateway = 1 miền tin cậy; Node ≥ 24.16, pnpm 12 |
| `jagentdesk-reference.md`, `jagentdesk-agent-features.md` (178 mã JD-*) | Kết nối, chat agent, ORC, multi-agent, skills, usage, terminal, workspace | Ed25519 ký nonce, mã 6 số; thiếu giới hạn thử mã, thu hồi không ngắt socket, khoá lưu file thường; AGPL |
| `waoowaoo-v0.4.1-pipeline.md`, `waoowaoo-reference.md` | Pipeline 21 bước; bản mới là chat + canvas | v0.4.1 không có license, HEAD là ELv2 → chỉ tham chiếu hành vi |
| `archify-reference.md` | Skill + CLI → HTML tĩnh | Không có trạng thái chạy, không nhúng được → tự vẽ bản sống |
| `repository-harness-reference.md` | Harness hiện tại | Không còn quy định user story → tự đặt quy ước story trong repo |
| `devin-ui-reference.md` | Ngôn ngữ thị giác Devin | Token là ước lượng từ ảnh chụp; không có bản mobile |

Ràng buộc: bản production duy nhất, không chia phase; local-first; không telemetry; mã nguồn OpenClaw không bị sửa và
code JAgentChill nằm ngoài nó.

## Goals / Non-Goals

**Goals:**
- Một editor ngang chuẩn CapCut chạy trên web, desktop (macOS/Windows/Linux) và mobile (iOS/Android) từ một codebase.
- Port đủ 515 dòng PORT-CHECKLIST của OpenCut classic và phủ CC-001..CC-291 (mỗi dòng map tới một requirement).
- Kết nối đa thiết bị có ký, thu hồi được, không lộ bí mật qua QR.
- Agent thao tác được mọi thứ người dùng thao tác được trong editor, có preview và undo.
- Soạn kịch bản bởi người hoặc agent, duyệt bởi người hoặc agent; đội agent vai cố định và agent tự do gọi nhau;
  workflow do người vẽ hoặc agent tự lập, nối các agent trên diagram.
- Dùng provider qua CLI đã cài hoặc OAuth/API key trực tiếp, đổi provider/model/mode/skill ngay trong cuộc chat; có
  usage, terminal, workspace như JAgentDesk.
- JAgentChill là dự án riêng; OpenClaw là gateway nguyên bản trong `gateway/openclaw/`, nâng bản bằng cách đổi tag ghim.

**Non-Goals:** xem proposal (SaaS nhiều tenant, channel nhắn tin, nội dung/brand của CapCut và Devin, telemetry, marketplace).

## Decisions

### D1 — JAgentChill là sản phẩm riêng với server riêng; OpenClaw là tiến trình con nguyên bản
Quyết định của chủ dự án (2026-10-05): OpenClaw **chỉ làm gateway/bộ máy agent**; JAgentChill **không phải plugin hay
extension của OpenClaw**. JAgentChill có **server riêng** (`server/`) — tiến trình của ta — khởi chạy và giám sát OpenClaw
như một tiến trình con và là client duy nhất của nó. Đã chạy thử thật: `docs/decisions/0002-own-server-gateway-sidecar.md`.
Bố cục repo:

```
jagentchill/                        repo của JAgentChill (monorepo pnpm riêng)
  gateway/
    OPENCLAW_VERSION                tag OpenClaw đang ghim (hiện v2026.9.8)
    openclaw/                       mã nguồn OpenClaw kéo về bằng scripts/gateway-pull.sh — NGUYÊN BẢN, không commit
                                    vào repo này, không bao giờ sửa, không chứa file nào của JAgentChill
    README.md
  server/                           JAgentChill Server: kênh client, ghép cặp/ký, dự án, đồng bộ, job, workflow, film,
                                    ORC, provider tạo sinh, endpoint tool cho agent (MCP), giám sát gateway
  packages/protocol/                Zod schema dùng chung client ↔ server
  packages/editor-core/             model, command, undo, selection, placement, keyframe (TS thuần, không DOM)
  packages/render/                  scene builder, frame descriptor, compositor wasm, decode, audio mix, export
  packages/render-wasm/             crate Rust (wgpu) → wasm
  packages/media/                   probe, thumbnail, waveform, proxy, transcription
  packages/workflow/                engine workflow + tài liệu workflow
  packages/archify/                 fork archify mở rộng thành canvas workflow
  packages/film/                    domain sản xuất phim
  packages/ui/                      design system (React Native + web)
  packages/content/                 nội dung đi kèm
  packages/provider-kit/            hợp đồng và tiện ích cho provider tạo sinh (chạy trong server)
  apps/app/                         app Expo (iOS, Android, web)
  apps/desktop/                     Electron shell (khởi chạy JAgentChill Server)
  skills/                           skill cho agent
  docs/ (research, design, stories, decisions, product), openspec/, scripts/, deploy/
  .refs/, .dev/                     tham chiếu và scratch, không commit
```
- **Ranh giới:** không file nào của JAgentChill nằm trong `gateway/openclaw/` hay trong bản build của nó, và không file
  nào trong đó bị sửa. Nâng OpenClaw = đổi `gateway/OPENCLAW_VERSION`, chạy `scripts/gateway-pull.sh`, cài và build lại
  gateway, chạy test hợp đồng gateway của server. Không có allow-list vá upstream, không phụ thuộc chính sách dependency
  của workspace OpenClaw.
- **Server ↔ gateway:** server khởi chạy gateway theo `docs/gateway/embedding.md` (state dir riêng do server quản, token
  do server sinh, chỉ nghe loopback, `OPENCLAW_SKIP_CHANNELS=1`, `OPENCLAW_NO_RESPAWN=1`), nối bằng thư viện chính thức
  `@openclaw/gateway-client` (giao thức v4) với danh tính thiết bị Ed25519 của server và scope `operator.read`,
  `operator.write`, `operator.admin`, `operator.approvals`. Server viết cấu hình gateway (provider, runtime, run profile,
  `mcp.servers`). Mã thoát 78 của gateway → chạy `openclaw doctor --fix` một lần rồi thử lại, theo tài liệu embedding.
- **Tool cho agent:** server phục vụ endpoint MCP Streamable HTTP `/agent-tools/mcp` (bearer secret do server sinh, chỉ
  loopback) và tự đăng ký nó vào `mcp.servers.jagentchill` của gateway; agent thấy tool dưới tên `jagentchill__jc_*`.
  Client MCP của OpenClaw không gửi danh tính session. Server xác định session gọi tool bằng **gắn kết theo event**
  (spike S23, đã chạy thật với hai session đồng thời): mỗi session agent giữ một kết nối MCP riêng, và gateway báo mỗi
  lời gọi tool trên liên kết của server kèm `sessionKey`; server gắn kết nối MCP với session có lời gọi khớp và chỉ phục
  vụ lời gọi mà gateway đã báo. Tool `jc_*` **không** nhận tham số định danh nào từ model (không có handle do model mang:
  `chat.inject` và `workContext` không tới model, và bí mật nằm trong ngữ cảnh model thì lộ được).
- **Thứ không còn dùng:** plugin SDK của OpenClaw (`registerHttpRoute`, `registerTool`, hook, `api.runtime`). Kiểm quyền
  tool `jc_*` diễn ra ngay tại endpoint tool của server; lệnh/tool gốc của OpenClaw được kiểm qua RPC phê duyệt của
  gateway mà server là bên duy nhất trả lời.
- **Bản phân phối:** desktop và bản headless/Docker đóng gói JAgentChill Server + gateway đã build + một Node runtime;
  người dùng không cần cài OpenClaw riêng.
*Phương án đã cân nhắc:* (a) fork OpenClaw làm gốc repo và viết JAgentChill trong `extensions/`, `packages/`, `apps/` của
nó — bị chủ dự án bác: biến JAgentChill thành extension của OpenClaw; (b) plugin JAgentChill nạp vào gateway và sở hữu
kênh client (`docs/decisions/0001-…`, đã chạy được) — bị chủ dự án bác vì cùng lý do, và plugin ngoài cây không gọi được
lõi nếu không chép vào bản build của gateway; (c) chỉ dùng gói npm `openclaw` — không có mã nguồn gateway trong tay để
ghim, đọc và đóng gói.

### D2 — Topology: local-first, một host (JAgentChill Server + Gateway) cho một người vận hành
```
 ┌──────────── Desktop (Electron) ────────────┐        ┌──── Mobile (Expo) ────┐
 │ App UI (RN-web) ── editor-core ── render   │        │ App UI ── editor-core │
 │        │ kênh P (loopback, ký)             │  P     │   │ engine WebView    │
 │  ┌─────▼──────────────────────────────┐    │◄──────►│   │ (render, wasm)    │
 │  │ JAgentChill Server                   │  │ ký +   └───┴───────────────────┘
 │  │ ORC · workflow · film · sync · job   │  │ tailnet/LAN        ▲
 │  │ SQLite + blob store · FFmpeg worker  │  │                    │ ws ký
 │  │   └─► OpenClaw Gateway (tiến trình   │  │                    │
 │  │       con, loopback): agent, runtime │  │                    │
 │  └──────────────────────────────────────┘  │        ┌───────────┴───────────┐
 └────────────────────────────────────────────┘        │ Web (browser)         │
                                                       │ editor chạy độc lập;  │
                                                       │ nối Gateway khi cần AI│
                                                       └───────────────────────┘
```
- Editor chạy và lưu hoàn toàn trên từng thiết bị, không cần host (như OpenCut). Host chỉ cần cho: agent, AI,
  workflow, film, đồng bộ, export từ xa. "Host" = JAgentChill Server cùng Gateway OpenClaw mà nó giám sát; trong tài
  liệu này, chỗ nào nói client nối/ghép cặp với "Gateway" thì bên trả lời luôn là JAgentChill Server.
- JAgentChill Server chạy trên desktop (Electron khởi chạy nó bằng Node thật chứ không phải `process.execPath`; server
  giám sát Gateway theo `docs/gateway/embedding.md`) hoặc headless (Docker/CLI) trên máy chủ riêng của người dùng. Mobile và web là client đã ghép cặp.
- **Khả năng truy cập (reachability):** JAgentChill Server trên desktop mặc định chỉ nghe loopback. App desktop có cài đặt
  **"Network access"** với ba mức — "This computer only" (mặc định), "Tailnet", "Local network (encrypted)". Cổng
  của Gateway OpenClaw **luôn** ở loopback ở mọi mức và không bao giờ được chuyển tiếp ra ngoài; mức "Tailnet" bật cầu nối
  tsnet và mức "Local network" bật listener TLS của sản phẩm, cả hai chỉ dẫn tới JAgentChill Server (`/jagentchill/…`, D7). LAN không mã hoá không tồn tại. Ghép cặp thiết bị trên máy
  khác **bắt buộc** bật một mức khác loopback, và màn hình ghép cặp dẫn thẳng tới cài đặt này.
- **Web app** được JAgentChill Server phục vụ tĩnh (`/jagentchill/app/*`) và chỉ chạy trong secure context:
  `http://localhost`/`127.0.0.1`, hoặc HTTPS (TLS của server / Tailscale Serve với chứng chỉ trình duyệt tin). Cùng
  bundle đó build được thành static site độc lập để chỉnh sửa không cần Gateway.
- Chạy Gateway với `OPENCLAW_SKIP_CHANNELS=1` và `plugins.allow` chỉ gồm plugin provider/runtime của chính OpenClaw cần dùng và memory slot (không có `canvas`: widget do app tự vẽ; không có plugin nào của JAgentChill). **Run profile** do server viết vào cấu hình Gateway khi khởi động bằng `ensureRunProfile()` (chỉ siết chứ không nới); nội dung và mô hình quyền ở D25.
*Phương án khác:* cloud dùng chung — bị loại vì OpenClaw không phải ranh giới multi-tenant.

### D3 — App: Expo / React Native + react-native-web, desktop Electron
Giống JAgentDesk: một codebase UI cho iOS/Android/web; Electron tải bản web export qua scheme riêng, `contextIsolation`
bật, `nodeIntegration` tắt. Router: expo-router. State: zustand + React Query (push-driven). Style: react-native-unistyles
với token của `design-system`. Không tái dùng UI Lit/Swift/Kotlin của OpenClaw; chỉ tái dùng giao thức và
`@openclaw/gateway-client/browser`.
*Phương án khác:* Tauri (`apps/linux`) — nhẹ hơn nhưng WebView hệ thống không đảm bảo WebGPU/WebCodecs đồng nhất; Electron
(Chromium) cho engine hành vi giống hệt bản web.

### D4 — Tách editor-core khỏi render, engine chạy trong "surface"
- `editor-core`: TS thuần, không DOM, chạy trong JS runtime của app (trình duyệt hoặc Hermes). Chứa model, command/undo,
  selection, placement, snapping, keyframe, ripple — port từ OpenCut classic `apps/web/src/{timeline,commands,animation,
  core,params,...}`.
- `render`: cần WebGPU/WebGL2 + WebCodecs + wasm. Giao tiếp qua `EngineSurface` port (nhận scene patch, thời điểm, lệnh
  export; trả frame-ready, tiến độ, thumbnail).
  - Web/desktop: surface cùng luồng với app, canvas gắn thẳng vào DOM.
  - Mobile: surface là một **native view module do sản phẩm sở hữu** (`JagentchillEngineView`, Expo module — không dùng
    `react-native-webview` vì nó không lộ `WKURLSchemeHandler` hay intercept-with-response) bọc WebView toàn quyền
    engine (canvas preview + wasm + decode); UI timeline, toolbar, panel là React Native.
    - **Đường phục vụ media:** Android — trang engine và media được phục vụ từ `https://engine.jagentchill.localhost/`
      qua `shouldInterceptRequest` (không bao giờ resolve DNS; Android WebView không đăng ký được custom scheme dùng
      với Fetch); iOS — `jagentchill-engine://app/` qua `WKURLSchemeHandler`. Cả hai hỗ trợ single-range request và
      phải cho `isSecureContext === true` lúc engine init, nếu không là `engine/unsupported-runtime`.
    - **Đường trả dữ liệu nhị phân** (file export, thumbnail, still): Android — `WebMessagePort` với payload
      `ArrayBuffer` (khối ≤ 4 MiB); iOS — `fetch(PUT jagentchill-engine://sink/<streamId>?seq=n)` vào scheme handler;
      cả hai có dự phòng base64 JSON, ack theo khối, tối đa 2 khối chưa ack. Thumbnail do phía native ghi vào thư mục
      cache và React Native tham chiếu bằng `file://`.
    - **Đồng hồ:** event `transport.time {time, rate, playing, hostMono_ms}`; phía app ngoại suy theo đồng hồ monotonic
      native cho mỗi khung hiển thị.
- Ba port nền tảng: `StoragePort` (theo D15: web = IndexedDB + OPFS; desktop = thư mục thư viện dự án trên đĩa qua
  bridge Electron; iOS/Android = SQLite + file system của app), `MediaPort` (nhập/ghi hình/quyền), `EngineSurface`.
- **Hệ điều hành tối thiểu và codec** do **spike WebView (S6)** quyết định bằng ma trận pass/fail dưới đây; giá trị làm
  việc trước khi có kết quả: **iOS/iPadOS 26+** (WebKit mới có audio WebCodecs và WebGPU từ dòng 26 — cần xác nhận trong
  WKWebView) và **Android 12+** với Android System WebView ≥ phiên bản Chromium engine cần (giá trị làm việc: 121,
  ghim trong `docs/product/TOOLCHAIN.md`; thấp hơn thì app hiện "Update Android System WebView").

  **Ma trận spike S6** — chạy trên từng thiết bị tham chiếu (iPhone 12 / iOS 26; Snapdragon 778G 6 GB / Android 12+),
  trong chính `JagentchillEngineView`, trước mọi task render:

  | # | Tiêu chí | Pass khi | Nếu fail |
  |---|---|---|---|
  | 1 | Secure context trên scheme/host cục bộ | `isSecureContext === true`, wasm + worker chạy | **Chặn**: đổi cách phục vụ (loopback HTTP server trong app) rồi chạy lại spike |
  | 2 | WebGPU adapter | `requestAdapter()` trả adapter, compositor qua golden | Dự phòng **WebGL2** (đã có trong D6) |
  | 3 | Decode video `VideoDecoder` H.264 1080p30 | ≥ 1× thời gian thực, seek p95 ≤ 150 ms | **Proxy editing** (720p) bắt buộc trên thiết bị đó |
  | 4 | Decode HEVC 4K (định dạng quay mặc định của iPhone) | giải mã được | Proxy/mezzanine H.264 do Gateway tạo; nếu không có Gateway thì báo "không hỗ trợ định dạng" |
  | 5 | `AudioDecoder` + AAC | giải mã được AAC-LC 48 kHz | **Chặn** cho phát lại; nâng OS tối thiểu của nền tảng đó |
  | 6 | Encode `VideoEncoder` H.264 1080p30 | ≥ 0,5× thời gian thực | **Export trên Gateway đã ghép cặp** là đường duy nhất trên thiết bị đó |
  | 7 | Encode audio | AAC có; nếu không: Opus | Thứ tự dự phòng: Opus-in-MP4 → PCM 16-bit trong MOV → export trên Gateway; không bao giờ ghi MP4+PCM |
  | 8 | Bộ nhớ engine | 600 MiB không bị kill content process trong 10 phút phát 1080p | Hạ pool cache, ép proxy editing |
  | 9 | Đường trả nhị phân | sink 1 GiB ≥ 40 MiB/s; ghi định vị (positioned write) và 1 GiB bộ nhớ riêng của engine | Export luôn mux trong bộ nhớ riêng của engine rồi chuyển ra qua sink sau khi finalise (đường bình thường, quyết định B5); sink chậm → `binarySink: "base64"`; không có ghi định vị hoặc 1 GiB → chặn export trên thiết bị ở nền tảng đó (chỉ export trên host) cho tới khi sửa |
  | 10 | Bridge | seek round-trip p95 ≤ 8 ms; `transport.time` ≥ 30/s | Giảm tần suất event, tăng ngoại suy phía app |
  | 11 | Audio session / audio focus | iOS: nghe được khi gạt im lặng (`navigator.audioSession.type = "playback"` + category native); Android: giữ audio focus và phát được khi màn hình khoá theo quy tắc của app | **Chặn** trên nền tảng đó; tìm đường audio native |
  | 12 | Font emoji màu đi kèm | chuỗi 20 emoji Noto Color Emoji dựng qua đường text của engine trên cả hai máy, SSIM ≥ 0,98 | Không chặn phát hành (E5): vẽ emoji từ bitmap 512 px đi kèm tại đúng vị trí bố cục |
  | 13 | Suy luận trên thiết bị | `seg-person` ≥ 3 fps, `face-mesh` ≥ 8 fps trong WebView engine, tiến trình sống sau 10 phút | **Chặn** phát hành trên nền tảng đó cho tới khi model/runtime đạt (E3: host chỉ là bộ tăng tốc) |

  Kết quả ghi vào `docs/decisions/` và chốt số trong `updates-distribution` (OS tối thiểu) và `render-engine` (capability
  probe). Ba dự phòng được ghi nhận: **render WebGL2**, **proxy editing**, **export trên Gateway đã ghép cặp**.
*Phương án khác:* viết engine native (Metal/Vulkan + AVFoundation/MediaCodec) — hai engine phải khớp từng pixel với bản
web, chi phí gấp ba và sai lệch hình ảnh giữa thiết bị; bị loại. Dùng `react-native-webview` có sẵn — bị loại vì không
có đường phục vụ media theo range và không có đường trả nhị phân (`.refs/review/round1-C-architecture-security.md`
F-C21).

### D5 — Mô hình dữ liệu editor: mở rộng schema OpenCut classic, thời gian là tick nguyên
Định nghĩa chuẩn, đầy đủ và duy nhất của tài liệu dự án (schema 32) nằm trong capability **`project-document`**; mọi spec
khác chỉ tham chiếu tên trường của nó. Kho keyframe là `animations` theo đường dẫn thuộc tính dạng chấm khớp trường lưu
(`transform.position.x`, `transform.scale.x`, `transform.rotation`, `opacity`…); map `params` phẳng của classic v31 được
migration chuyển thành trường có kiểu. Tài liệu có cả trường cho template mode và multi-camera. Tóm tắt dưới đây chỉ để
định hướng.
Giữ `MediaTime` = số nguyên tick, 120 000 tick/giây; `FrameRate {numerator, denominator}`. Project → Scene → Tracks
`{overlay[], main, audio[]}` → Element. Mở rộng so với classic:
- Track: thêm `locked`, `name` sửa được, sắp xếp lại trong cùng vùng (overlay/audio); thêm loại `adjustment`, `caption`.
- Element: thêm `transitionIn/Out` (tham chiếu transition giữa hai clip kề trên cùng track), `crop {left, top, right,
  bottom}`, `flip {horizontal, vertical}`, `fadeIn/fadeOut` (chỉ audio; fade hình là clip animation),
  `retime {rate, maintainPitch, curve, reverse, smooth}` (đảo chiều chỉ lưu ở `retime.reverse`), `freeze {mediaId,
  sourceTime}` (phần tử vẫn là `type: "video"`), `masks[]` (nhiều mask, combine add/subtract/intersect/exclude),
  `adjustments`, `chromaKey {enabled, color, strength, edge, shadow, spill}`, `stabilization {enabled, level}`,
  `clipAnimation {in, out, combo}`, `background` (nền canvas **theo từng clip** trên main track; "Apply to all" ghi vào
  nền mặc định của project — đúng hành vi CapCut), `groupId`, `linkId` (liên kết video–audio đã tách),
  `filmLink` / `workflowLink` (nguồn gốc từ studio phim / workflow, giữ qua split, duplicate, paste), loại `compound`
  (tham chiếu scene), `adjustment`, `caption`. Không có loại phần tử `filter`: filter đứng riêng là phần tử `effect`
  với một entry `kind: "filter"`.
- Project: `cover`, `folders`, `trash`, `filmLink?`/`workflowLink?`, `schemaVersion` bắt đầu từ 32; đọc được dự án
  OpenCut classic v1–v31 qua chuỗi migration port nguyên (đã sửa lỗi gọi adapter ghi trong bản kiểm kê).
- Thời gian khung tính bằng phép chia nguyên có dư (`q = floor(n/num)`, `r = n mod num`,
  `ticks = q×(120000×den) + roundHalfAway(r×120000×den/num)`) để TypeScript (double) và Rust (`i64`) cho cùng kết quả ở
  dự án dài với fps không chuẩn; keyframe được lấy mẫu ở **đầu khung**.
Mọi thay đổi là `Command` có undo; preview dùng lớp `previewElements` rồi `commitPreview` thành một bước undo. Kết quả
của mỗi command được ghi ra ngoài dưới dạng **patch trạng thái** (xem D8), không phải bản thân command.
*Phương án khác:* nền canvas chỉ ở mức project như classic — bị loại vì CapCut đặt nền theo clip (CC-008…CC-011) và
config ưu tiên CapCut cho hành vi editor.

### D6 — Engine dựng hình
Port kiến trúc classic: scene builder (TS) → resolve (keyframe, frame video, text, mask) → `FrameDescriptor` → compositor
Rust/wasm trên wgpu (WebGPU, dự phòng WebGL2). Mở rộng crate wasm: thư viện shader effect/filter/transition, chỉnh màu
(basic, HSL, curves, wheels, LUT 3D), chroma key, nhiều mask, crop/flip, blend 17 mode giữ nguyên. Giải mã bằng
WebCodecs (mediabunny). Đồng hồ phát lại: `AudioContext` là đồng hồ chủ, playhead bám theo (sửa lỗi lệch hai đồng hồ
của classic). Export: WebCodecs trên thiết bị; ghi ra file theo luồng (File System Access / file native / đường trả
nhị phân của D4 trên mobile) thay vì giữ cả file trong RAM. Khi thiết bị không mã hoá được codec/độ phân giải yêu cầu
hoặc người dùng chọn, export chạy trên Gateway bằng **render host** (D11b) — chính engine này chạy trong Electron
`--render-host`, khung hình đẩy cho FFmpeg mã hoá; FFmpeg một mình không dựng được hình.

`render-engine` là nơi duy nhất định nghĩa thứ tự xử lý; các spec tính năng chỉ định nghĩa tham số:
- **Thứ tự stage mỗi layer:** `source` → `stabilise` → `crop` → `flip` → `transform` (transform phần tử × clip
  animation) → `chroma-key` → `matte` → `retouch` → `color-chain` → `filter` → `effects` → `masks` → `motion-blur` →
  `opacity` → `blend`.
- **Chuỗi màu:** LUT (có intensity) → basic → wheels → curves → HSL → pass không gian (sharpness, clarity, fade,
  vignette, grain).
- **Ghép nhiều mask:** add = max, subtract = acc×(1−m), intersect = min, exclude = |acc−m|.
- **Âm thanh:** `audio-editing` sở hữu định nghĩa chuỗi tín hiệu và mọi tham số (kể cả limiter và mixdown);
  `render-engine` sở hữu lập lịch, cơ chế khối, tính tất định và vị trí chạy limiter. Limiter là true-peak limiter với
  trần 0,98 và **độ lợi đơn vị dưới ngưỡng** (không nhân 0,98 cố định, không có quy tắc bỏ qua của classic), nên phát lại
  và export cho cùng mức âm lượng và mix nhỏ tiếng không bị đổi.
- **Pipeline SDR 8-bit** (Rec.709); nguồn HDR được tone-map khi giải mã. Xuất HDR là Non-goal (xem proposal).
- **Không có GPU** (`backend: "none"`): không dựng hình, không có đường Canvas2D; tham số vẫn chỉnh được. Dự phòng thật
  là WebGL2.
- **Dung sai:** preview = export với sai khác tối đa 1 mức mỗi kênh; golden-frame ≥ 99,5 % điểm ảnh trong 2/255, không
  điểm nào quá 16/255, SSIM ≥ 0,99, chỉ có giá trị chuẩn trên runtime CI (Linux, software rasterisation); khung có chữ
  giữa các OS và giữa thiết bị ↔ Gateway: SSIM ≥ 0,98. Chín tên font nền tảng luôn resolve về font mở đóng gói kèm
  engine để layout chữ giống nhau trên mọi nền tảng.
*Phương án khác:* để mỗi spec tính năng tự mô tả thứ tự xử lý — đã sinh ra hai thứ tự layer và hai thứ tự màu mâu thuẫn
(`.refs/review/round1-A-consistency.md` F-A23, F-A24); bị loại.

### D7 — Ghép cặp và ký kết nối: một kênh duy nhất do JAgentChill Server sở hữu, server chuyển tiếp mọi lưu lượng agent
Kiểm chứng mã nguồn OpenClaw (`docs/research/openclaw-plugin-feasibility.md`, `openclaw-agent-capabilities.md`) và hai
vòng review cho thấy: lõi không có hook lúc connect; `hello-ok` không mang chữ ký của Gateway; scope `operator.write` /
`operator.approvals` không phải ranh giới giữa các vai — một thiết bị giữ chúng có thể nhắn vào session workspace của
người khác rồi tự duyệt lệnh, và không ai biết thiết bị nào đã duyệt; kết nối tới qua loopback được lõi nới lỏng nhiều kiểm tra.
Vì lõi không được sửa, **thiết bị không bao giờ nối vào kênh gốc của Gateway và không giữ scope OpenClaw nào**.

- **Kênh P (kênh sản phẩm) là kênh client duy nhất**: WebSocket `/jagentchill/v1/ws` và các HTTP route `/jagentchill/v1/*`,
  do JAgentChill Server phục vụ trên cổng của chính nó. Mọi thứ đi qua đây: RPC sản phẩm, event, media, đồng bộ, job,
  **và cả lưu lượng agent** (tạo/gửi/steer/huỷ/patch session, lịch sử, stream, phê duyệt, câu hỏi). Server kiểm vai thiết
  bị, quyền sở hữu/hiển thị của session và scope `jagentchill.*`, rồi gọi Gateway **qua liên kết loopback của nó**
  (`@openclaw/gateway-client`, D1); server là bên duy nhất trả lời RPC phê duyệt của Gateway nên biết ai duyệt và cưỡng
  chế được "chỉ admin".
- **Cổng gốc của Gateway luôn chỉ nghe loopback**, chỉ dùng bởi JAgentChill Server (token do server sinh, lưu owner-only) và CLI `openclaw` của host.

Luồng:
1. **Offer** không chứa bí mật, không dùng setup code của OpenClaw:
   `jagentchill://pair#offer=<base64url JSON {v, gatewayId, gatewayPublicKey, addresses[{kind, url, tlsSha256?}], expires_ms}>`
   với `kind` ∈ `loopback | lan | tailnet`; hiển thị dạng QR, link hoặc mã ngắn (ở mức "chỉ máy này" chỉ có link và mã
   ngắn, để trình duyệt trên cùng máy ghép cặp được).
2. Thiết bị tạo khoá Ed25519: Keychain (iOS, macOS), Android Keystore, Electron `safeStorage` (Windows DPAPI, Linux
   keyring — không có keyring thì host/app báo rõ và dùng file owner-only sau khi người dùng xác nhận); web dùng WebCrypto
   Ed25519 non-extractable trong IndexedDB trên một origin chỉ phục vụ app (A2).
3. **Ghi danh qua HTTP route công khai của server** (`/jagentchill/v1/pair/*`): hai bên ký **bản ghi handshake** UTF-8 nối
   bằng xuống dòng: `JAGENTCHILL-HANDSHAKE-V1`, vai (`device|gateway`), `context`, `gatewayNonce`, `deviceNonce`, `ts`,
   `gatewayId`, `deviceId`, `devicePublicKey`, `protocolVersion`. Thiết bị kiểm chữ ký Gateway bằng `gatewayPublicKey`
   trong offer → xác thực hai chiều, có nonce của cả hai phía nên không replay được.
4. Thiết bị chưa tin cậy nhập **mã xác minh 6 số** hiển thị trên client đã tin cậy (gửi tới đúng kết nối đó, không
   broadcast): TTL 5 phút, tối đa 5 lần thử rồi huỷ yêu cầu, so sánh hằng thời gian, giới hạn tốc độ theo địa chỉ gốc.
5. Khi mã đúng: server ghi thiết bị với vai (`admin` / `editor` / `viewer`) và cấp **device token** (32 byte ngẫu nhiên,
   TTL 30 ngày, xoay khi còn dưới 7 ngày, quá hạn vẫn nhận kèm chữ ký hợp lệ trong 90 ngày rồi phải ghép lại; không bao
   giờ hợp lệ nếu thiếu chữ ký mới). Xoay khoá thiết bị đòi chữ ký của khoá CŨ trên khoá mới và ghi audit.
6. **Mỗi lần kết nối**: handshake ký hai chiều với nonce mới trên kênh P. `lan`: bắt buộc `wss` với ghim `tlsSha256` (app
   native); trình duyệt chỉ dùng `lan` khi host có chứng chỉ được trình duyệt tin. `tailnet`: WireGuard mã hoá đường
   truyền, cho phép `ws` trong tailnet với app native; trình duyệt dùng HTTPS với chứng chỉ `ts.net`.
7. **Ký theo yêu cầu** cho HTTP route: header deviceId, ts, nonce, chữ ký trên
   `JAGENTCHILL-REQUEST-V1\ngatewayId\nmethod\npath\nsha256(body)\nts\nnonce`; lệch giờ ±120 s; nonce một lần.
   Ngoại lệ không ký liệt kê tường minh: route ghi danh, link chia sẻ (token ngẫu nhiên + hạn + passcode tuỳ chọn + giới
   hạn tốc độ), webhook automation (HMAC theo trigger), asset tĩnh của web app, health.
8. **Thu hồi / đổi vai**: server đánh dấu, đóng mọi socket kênh P của thiết bị (mã 4403), huỷ truyền tải HTTP đang chạy,
   và mọi lời gọi lõi thay mặt thiết bị đó dừng ngay — không phụ thuộc lõi vì thiết bị không có pairing gốc nào.
9. **Không ngoại lệ loopback**: client trên cùng máy cũng ghép cặp và ký như mọi thiết bị.
10. **Đường truyền giống JAgentDesk hiện tại** (quyết định của chủ dự án): không có máy chủ relay; truy cập từ xa qua
    **node Tailscale nhúng (tsnet)**. Host: tiến trình con cầu nối tsnet (Go, server khởi chạy và giám sát, đủ macOS/
    Windows/Linux arm64+x64) là **reverse proxy giới hạn đường dẫn**: chỉ chuyển `/jagentchill/…` tới JAgentChill Server và
    gắn địa chỉ gốc của peer; Gateway OpenClaw và endpoint tool của agent không tới được từ tailnet. Mức "Local network (encrypted)" tương tự: một
    listener TLS của sản phẩm chỉ cho `/jagentchill/…`. Mobile (iOS và Android): module tsnet nhúng mở proxy loopback
    cho client JS; luồng: quét offer → đăng nhập Tailscale (tương tác hoặc auth key) nếu cần → handshake + mã 6 số.
    Desktop (mọi OS): proxy tailnet để tới host khác. Web: cần Tailscale ở mức OS, hoặc loopback, hoặc LAN có chứng chỉ
    tin cậy. Đường truyền nằm sau trừu tượng "loại địa chỉ" để sau này thêm loại relay mà không đổi handshake. Không mở
    cổng công khai.

**Spike gating:** liên kết server ↔ Gateway và endpoint tool MCP đã chạy thật (`docs/decisions/0002-…`); S2/S3/S4/S5 của
hướng plugin đã rút. Còn mở: S23 (gắn lời gọi tool MCP với session — D1), S20 (cầu nối reverse proxy có gắn địa chỉ peer + tsnet nhúng trên iOS/Android), S21 (chuyển tiếp event/phê duyệt của
agent qua liên kết Gateway với đủ độ trung thực trên từng runtime; runtime nào trượt thì không được đưa ra). S1 (connect bằng
bootstrap token) đã rút vì không còn kênh gốc cho client.
*Phương án khác:* (a) chép luồng JAgentDesk — thiếu giới hạn thử, không xác thực Gateway, khoá lưu file thường; (b) hai
kênh, thiết bị nối kênh gốc cho agent với scope OpenClaw theo vai — bị loại: scope không phải ranh giới vai, `editor` tới
được exec trên host và tự duyệt được (`.refs/review/round2-C1.md` R2-C1-01, `round2-C7.md` R2-C7-01/02); (c) lớp ký thành
RPC sản phẩm sau `connect` gốc — socket chưa chứng thực vẫn gọi được method lõi.

### D8 — Đồng bộ đa thiết bị
- Dự án: mỗi dự án có **nhật ký patch trạng thái** (kiểu JSON-patch trên tài liệu dự án chuẩn) do client sinh ra + snapshot
  theo revision; Gateway là điểm hẹn và không chạy lại command (kết quả command không đồng nhất từng byte giữa V8,
  JavaScriptCore và Hermes). Một dự án có **một người ghi tại một thời điểm** (lease 30 s, gia hạn bằng heartbeat); thiết bị
  khác xem trực tiếp hoặc xin chiếm khoá. Principal host (`agent:<sessionId>`, và `run:<runId>`, `film:<filmId>`, `automation:<automationId>` cho writer không có
  phiên chat) chỉ giữ lease khi không thiết bị nào giữ, và
  không bao giờ giành lease của thiết bị. Sửa offline tạo nhánh; khi nối lại mà revision gốc khác thì người dùng chọn giữ
  bản nào hoặc lưu thành bản sao (không tự trộn).
- Media: blob địa chỉ theo nội dung (sha256), truyền theo khối 4 MiB, tiếp tục được khi đứt, ký theo D7.7. Mobile mặc định
  tải proxy (720p) và tải bản gốc khi cần export tại chỗ.
*Phương án khác:* CRDT cho timeline — phức tạp, và chuẩn CapCut cũng là khoá một người sửa; nhật ký command chạy lại trên
Gateway — bị loại (`.refs/review/round1-C-architecture-security.md` F-C15).

### D9 — Chat agent: session Gateway, chọn runtime/model/mode ngay trong cuộc chat
Session agent là session OpenClaw, nhưng client chỉ nói chuyện với JAgentChill Server trên kênh P (D7): server chuyển tiếp
`sessions.*` / `chat.*` và event `agent` / `session.*` qua liên kết Gateway của nó, sau khi kiểm vai và quyền sở hữu session. Hành vi theo JAgentDesk (`docs/research/jagentdesk-agent-features.md`,
JD-CMP, JD-MID) hiện thực trên API có sẵn của OpenClaw (`docs/research/openclaw-agent-capabilities.md`):
- **Hàng điều khiển composer**: model browser gộp provider + model (tìm kiếm, yêu thích, gần đây), mode, mức thinking,
  feature của provider, skill, Team mode, Autonomous. Lựa chọn được nhớ theo thiết bị và theo provider.
- **Đổi giữa cuộc chat**: `sessions.patch {model, agentRuntime, thinkingLevel, permissionMode, toolOverrides}` rồi mới gửi
  (vì `chat.send` không mang `model`); UI gộp hai bước thành một. Đổi **runtime/provider** giữ nguyên session id và
  timeline, huỷ lượt đang chạy, đặt lại mode/thinking/feature, và chuyển ngữ cảnh bằng một bản tóm lược lịch sử đính vào
  lượt kế tiếp — bản tóm lược được **lưu bền** trong kho của server (JAgentDesk giữ trong RAM nên mất khi khởi động lại).
- **Khi lượt đang chạy**: `queueMode` `steer | followup | interrupt`; runtime không hỗ trợ steer (ACP) thì tự hạ xuống
  followup và UI nói rõ; đổi mode quyền bị từ chối trên lượt CLI đang chạy → xếp hàng cho lượt sau.
- **Mode**: bộ mode của sản phẩm (Ask, Plan, Edit mặc định, Auto) ánh xạ xuống `permissionMode` của OpenClaw và mode gốc
  của từng CLI/ACP khi runtime có; runtime thiếu mode nào thì mode đó bị mờ kèm lý do.
- **Rewind / fork / import**: rewind hội thoại, file hoặc cả hai; fork từ một điểm; nhập session có sẵn của CLI.
- UI theo Devin: chat trái, workspace phải với tab Timeline preview, Changes, Worklog, Diagram, Assets, Files, Terminal,
  Agents. Thay đổi do agent thực hiện trên dự án video đi qua hệ `Command` của editor thành một "đề xuất" có preview,
  chấp nhận/từ chối từng phần, luôn undo được.

### D10 — ORC: vai trò → profile → route, cho cả vai LLM và vai tạo sinh
Mô hình theo JAgentDesk (`OrchestrationConfig`): mỗi vai có danh sách profile `{runtime, provider, model, thinking?, mode?,
params}`, profile mặc định, route chính + dự phòng theo loại việc. Vai gồm vai điều phối (`supervisor`, `lead`, `peer`), vai
sáng tạo (`director`, `screenwriter`, `storyboard`, `editor`, `reviewer`), vai tạo sinh (`image`, `video`, `voice-tts`,
`voice-design`, `music`, `sfx`, `lipsync`, `transcription`, `translation`, `vision`) và vai tuỳ biến. Route theo loại việc
(planning, script, edit, search, research, audit, ui và các route tạo sinh như `image.character`, `video.first_last_frame`).
Lưu trong kho của server, ánh xạ xuống `agents.entries.*` và provider media của OpenClaw. Khác JAgentDesk: task brief có thể
do model soạn (JAgentDesk chỉ tách nhãn bằng regex), và hai công tắc `autoPrepareBrief` / `askWhenAmbiguous` có tác dụng
thật. Không chép model id mặc định; mặc định lấy từ catalog đang bật.

### D11 — Hàng đợi tác vụ duy nhất và FFmpeg phía host
Server sở hữu **một** hàng đợi (SQLite) cho mọi việc nền: tạo sinh ảnh/video/giọng, workflow, film, export từ xa, proxy,
transcription phía host, ghi hình WebM của canvas (`workflow.record`). Trạng thái `queued → running → succeeded | failed | cancelled`, có tiến độ, phục hồi sau khi
Gateway khởi động lại, giới hạn đồng thời theo provider. Một chính sách retry và ngân sách, do `generation-providers` sở
hữu: 3 lần thử mỗi route (lần đầu, rồi +2 s và +8 s), chờ 30 s rồi sang route dự phòng; ngưỡng duyệt mỗi lần gọi 0,50 USD ở mode Edit; ngân
sách session 5,00 USD ở mode Auto; ngân sách dự án/lượt chạy cảnh báo ở 80 % và chặn trước khi vượt; prompt duyệt hết hạn
sau 30 phút. Hợp đồng export từ xa do `export-share` sở hữu (`cross-device-sync` chỉ tham chiếu). FFmpeg (bản LGPL, tiến
trình ngoài) dùng cho mã hoá, proxy và ghép nối. **Mã hoá trên host không bao giờ bị chặn:** luôn có đường phần mềm miễn
phí bản quyền (VP9, AV1 + Opus qua libvpx / SVT-AV1 / libopus); H.264 có khi host có bộ mã hoá phần cứng hoặc đã tải
OpenH264 từ host chính thức của Cisco lúc cài đặt (admin đồng ý ở hộp thoại lần đầu; headless: lệnh CLI hoặc biến môi
trường) — không bao giờ hỏi lúc export. Job yêu cầu codec không có thì thất bại ngay với `export/codec-unavailable` kèm
danh sách thay thế; automation khai thứ tự codec ưu tiên. HEVC chỉ khi có phần cứng.

### D11b — Render host
FFmpeg không chạy được shader của engine, nên mọi việc dựng hình trên Gateway (export từ xa, render khung hình cho agent,
automation không người trông, thumbnail/proxy có hiệu ứng) dùng **một render host**: tiến trình con Electron
`--render-host` do server khởi chạy và giám sát, chạy chính engine surface, nói chuyện qua stdio pipe, đẩy khung hình thô
cho FFmpeg. Khi Gateway do desktop giám sát thì dùng Electron của app; bản headless/Docker (`deploy/jagentchill/`) đóng
gói kèm. Gateway chỉ quảng bá cờ `remote-render` khi render host khoẻ; thiếu thì tool phụ thuộc trả
`RENDERER_UNAVAILABLE` và UI nói rõ. Kho dữ liệu host: file SQLite của server dưới thư mục dữ liệu của JAgentChill Server (`node:sqlite`; tách khỏi state dir của Gateway, vốn
nằm ở `<dataDir>/gateway-state/`) và blob là file thường cạnh đó. Server tự giám
sát service của mình (khởi động lại 1 s / 5 s / 30 s) vì host không làm việc này.

### D12 — Engine workflow tổng quát; "một prompt → video" là một mẫu
OpenClaw không có gì chạy được đồ thị node (Lobster là pipeline shell tuyến tính, không gọi được agent), nên server sở hữu
**engine workflow dạng đồ thị** (`packages/workflow`): kho đồ thị, bộ lập lịch, executor theo loại node, duyệt,
event trạng thái.
- **Loại node**: `agent` (chạy một agent/persona với prompt, runtime/model theo ORC hoặc ghi đè), `team` (gọi một đội
  vai cố định), `tool`,
  `generate` (ảnh/video/giọng/nhạc), `script` (soạn/duyệt kịch bản, D14b), `editor` (thao tác timeline), `approval`
  (người duyệt, hoặc agent reviewer tự duyệt theo chính sách), `branch`, `loop`, `parallel`/`join`, `subworkflow`,
  `trigger`, `export`, `wait`, `human_input`, `notify`. Cạnh mang dữ liệu có kiểu; node khai báo schema vào/ra.
- **Ba cách tạo**: người dùng vẽ trên diagram; agent tự soạn từ ý định (agent phân tích intent, chọn pipeline, sinh đồ thị
  và nối các agent, rồi chờ duyệt hoặc tự chạy theo mode); hoặc dùng mẫu. "Một prompt → video" (brief → script → shot list
  → assets → voice → music → assemble → review → export) và pipeline phim là các **mẫu** chạy trên engine này.
- **Canvas workflow = fork archify và mở rộng** (quyết định của chủ dự án, 2026-10-05). archify (MIT) được fork vào
  `packages/archify` (giữ remote upstream riêng, thông báo bản quyền trong
  `THIRD_PARTY_NOTICES.md`) và mở rộng thành canvas sửa được: tái dùng ngôn ngữ thị giác, bộ hình học và
  định tuyến cạnh, hiệu ứng trace, xuất PNG/SVG/WebM, schema và validator; **bổ sung** chế độ toạ độ tự do, đường vẽ lại
  tăng dần (không biên dịch lại cả tài liệu mỗi lần kéo), lớp chỉnh sửa (kéo thả, nối cổng, palette, undo), overlay trạng
  thái chạy, API điều khiển từ app (message bridge), cử chỉ chạm, và token của design system. Renderer là SVG/DOM: chạy
  trực tiếp trong web và desktop (Electron), và trong WebView trên iOS/Android (cùng cách với engine dựng hình). Các
  phần archify tuyên bố ngoài phạm vi (sửa trực quan, auto-layout tổng quát, bề mặt mobile) là phần ta sở hữu trong fork.
  **Spike S19 (gating):** trình biên dịch/renderer của archify chạy được trong trình duyệt và WebView; vẽ lại khi kéo một
  node trong đồ thị 200 node / 400 cạnh đạt khung hình mục tiêu trên thiết bị tham chiếu (8 tiêu chí trong
  `workflow-diagram`). Mục tiêu gồm cả Safari và Firefox cho bản web. Nếu trượt ở bất kỳ đích nào: ghi kết quả và **chủ dự
  án quyết** giữa (a) sửa fork, (b) renderer riêng chỉ cho lớp nền tảng trượt, (c) renderer riêng mọi nơi — không tự động
  thay; renderer riêng (nếu chọn) nằm sau cùng giao diện component, giao thức message và mô hình intent nên các
  requirement về thao tác và animation không đổi. Trình duyệt trượt S19 được ghi là không hỗ trợ sửa canvas (vẫn có
  outline chỉ đọc). Fork ghim ở commit `594f608` (archify 3.0.1); catalogue logo thương
  hiệu để rỗng. Kiểm chứng mã nguồn cho thấy trình biên dịch archify không có điểm vẽ lại tăng dần (biên dịch đủ ~200
  node mất ~0,6 s), nên scene, cổng, tương tác, camera và đường vẽ lại tăng dần là code mới trong fork; phần tái dùng
  là hình học dùng chung, một hàm định tuyến, validator/schema, bộ xuất và ngôn ngữ thị giác.
  - Canvas tự do, vô hạn: node đặt ở toạ độ `{x, y}` bất kỳ, kéo thả từ palette, kéo để nối cổng → cổng, chọn nhiều bằng
    khung, nhóm/khung chú thích, snap lưới và snap căn hàng có đường dẫn hướng, pan/zoom (chuột, trackpad, pinch), minimap,
    auto-layout, undo/redo, copy/paste, phím tắt.
  - Cạnh là đường bezier có định tuyến tránh node, nhãn, và mũi tên theo kiểu dữ liệu của cổng.
  - **Animation**: node xuất hiện/biến mất, kéo có quán tính và bóng nâng, cạnh "chảy" khi dữ liệu đang đi qua, vòng tiến
    độ và nhịp sáng trên node đang chạy, chuyển trạng thái có màu và biểu tượng, camera tự bám node đang chạy, phát lại một
    lượt chạy theo thời gian. Mục tiêu 60 fps với 200 node / 400 cạnh trên thiết bị tham chiếu (xác nhận bằng S19); có chế
    độ giảm chuyển động.
  - Khi agent tự lập workflow, người dùng **nhìn thấy đồ thị được dựng dần** trên canvas (node và cạnh xuất hiện theo từng
    thao tác của agent).
  - Tài liệu workflow lưu toạ độ, kích thước, nhóm và viewport cùng với đồ thị. Xuất HTML tự chứa dùng chính fork; xuất
    sang **archify upstream thuần** (lanes × cột, bảy loại node) là một phép chiếu có auto-layout để tài liệu mở được bằng
    archify gốc; nhập tài liệu archify gốc tạo ra đồ thị có vị trí khởi đầu theo lưới. Ngoài ra xuất PNG/SVG/WebM.
- **Vai thiếu route thì giảm cấp, không chặn:** vai tuỳ chọn (`sfx`, `music`, `voice-design`, `lipsync`, nguồn stock) không
  có route → node `skipped` với lý do `no_route`, tổng kết lượt chạy liệt kê cái bị bỏ qua và cách thêm provider. Vai bắt
  buộc (LLM cho kịch bản/kế hoạch, ít nhất một trong tạo ảnh hoặc video, `voice-tts` khi có lời dẫn) mới chặn lúc bắt đầu
  kèm checklist cài đặt. Bộ âm thanh CC0 đi kèm là nguồn `sfx`/`music` dựng sẵn. Chế độ "Automatic" của mẫu một-prompt
  dùng chính sách duyệt `agent` cho bước kịch bản nên chạy rảnh tay.
- Kết quả của mẫu video là một dự án editor thật (clip, lời thoại, phụ đề, nhạc) có `workflowLink`.

### D13 — Sản xuất phim: viết mới theo hành vi
Miền dữ liệu riêng (Film → Episode → Clip → Panel; Character/Location/Prop + biến thể; VoiceLine; Speaker). Các bước theo
`waoowaoo-v0.4.1-pipeline.md` nhưng prompt, schema và code đều tự viết; thêm bước định hướng sáng tạo / style bible. Bước
kịch bản dùng `script-studio`. Bước cuối đổ panel video, lời thoại, phụ đề vào timeline editor (`filmLink`) và export
thành phim hoàn chỉnh; đạo cụ được dùng làm ảnh tham chiếu; undo ảnh panel hoạt động. Pipeline phim là một mẫu của engine
D12, nên từng bước có thể giao cho agent hoặc đội agent.

### D14 — Giao diện: cấu trúc CapCut, thị giác Devin
- Khung app, home, session, automations, settings: theo `devin-ui-reference.md`.
- Editor desktop/web: bố cục CapCut (tab tài nguyên trái, player giữa, inspector phải, timeline dưới) vẽ bằng token Devin.
- Editor mobile: theo `capcut-mobile-ui-reference.md`; `mobile-editor` là chủ duy nhất của toolbar, dải công cụ và sheet
  export trên mobile.
- File thiết kế: `docs/design/jagentchill-ui.html` (HTML tĩnh, đủ màn hình desktop + mobile, sáng + tối) là nguồn
  chuẩn cho coder; token ghi số thật.

### D14b — Script studio: người soạn, agent soạn, người duyệt hoặc agent tự duyệt
Kịch bản là tài liệu hạng nhất (`Script` → `Act?` → `Scene` → `Beat`/`Shot`, kèm lời thoại, lời dẫn, ghi chú hình ảnh, thời
lượng ước tính, nhân vật/bối cảnh tham chiếu), có phiên bản và diff.
- **Người dùng soạn**: trình soạn có cấu trúc + chế độ văn bản (nhập/xuất plain text, Fountain, `.docx` text), bảng shot
  list, ước lượng thời lượng, bình luận.
- **Agent soạn**: agent (vai `screenwriter`) lập kịch bản từ prompt/brief/tài liệu, tạo thành **bản đề xuất**; mọi lần sửa
  của agent là một phiên bản mới có diff.
- **Chính sách duyệt** đặt theo script, workflow hoặc mặc định host: `human` (chờ người duyệt, sửa, yêu cầu viết lại),
  `agent` (agent vai `reviewer` duyệt theo tiêu chí và ngưỡng điểm, tối đa N vòng sửa, ghi biên bản), hoặc `auto` (bỏ qua
  duyệt). Agent tự duyệt không đạt sau N vòng thì chuyển cho người.
- Kịch bản đã duyệt là đầu vào cho: tạo timeline nháp, mẫu "một prompt → video", pipeline phim, và node `script` trong
  workflow. Liên kết hai chiều giữa cảnh/shot và clip trên timeline.

### D15 — Lưu trữ
- **Web**: IndexedDB (dự án, metadata) + OPFS (media).
- **Desktop**: **thư mục thư viện dự án** trên đĩa, người dùng thấy và di chuyển được, truy cập qua bridge Electron (chỉ
  mục SQLite + file); hỗ trợ tham chiếu file ngoài (không sao chép) với relink.
- **iOS/Android**: SQLite + file system của app.
- **Host**: SQLite của server + thư mục blob dưới thư mục dữ liệu của JAgentChill Server, chỉ truy cập qua API của server.
Autosave debounce 800 ms; hết dung lượng khi lưu thì giữ bản trong bộ nhớ, báo lỗi chặn và không bao giờ ghi đè bản tốt
cuối cùng; snapshot phiên bản định kỳ; thùng rác 30 ngày. Gói dự án `.jagentchill`, gói template `.jctpl`, gói preset
`.jcpack`.

### D16 — Thư viện nội dung và connector
Không kèm nội dung CapCut. Đi kèm: effect/filter/transition/text template/hoạt ảnh do dự án tự viết (shader + preset), mỗi
thư viện **liệt kê đầy đủ** tên, nhóm, tham số trong spec hoặc `catalog.md` chuẩn cạnh spec; font Google (atlas như
classic); sticker cờ + shape; **bộ khởi đầu CC0** (nhạc, SFX, sticker) để editor dùng được khi không có Gateway. Âm thanh
mở rộng qua Freesound (khoá của người dùng, lọc giấy phép đúng); nhạc/ảnh/video stock qua provider cấu hình được. Nhập từ
Drive/Dropbox và đăng lên mạng xã hội là **connector** chạy trên Gateway bằng OAuth client do người dùng tự cấp. Người
dùng nhập được gói preset (LUT `.cube`, font, sticker, template).

### D17 — Cập nhật và phân phối
Desktop: electron-updater với bản ký + notarize; mobile: bản store + expo-updates (OTA cho JS); Gateway cập nhật theo
bản desktop. Tương thích: client và server thương lượng `protocolVersion` + cờ tính năng; field mới luôn optional.

### D18 — Chất lượng và harness
Cài repository-harness hiện tại mà không đụng `.claude/settings.json` hay `AGENTS.md` của upstream (luật agent của
JAgentChill ở `docs/product/AGENTS.md`, nạp qua `CLAUDE.md` mới); quy ước user story của repo:
`docs/stories/US-###-<slug>.md`, mỗi story trỏ tới requirement trong change OpenSpec. Test: unit với port giả có kiểu
(không `vi.mock`), golden-frame cho engine theo dung sai ở D6, e2e Playwright (web/desktop) và Maestro (mobile), test giao
thức ghép cặp, test hợp đồng runtime agent (cùng một kịch bản trên từng runtime). Cổng: typecheck, lint, unit, golden, e2e
khói, guard "cây `gateway/openclaw/` nguyên bản so với tag ghim", kiểm tra phủ checklist (mỗi mã PORT, CC và JD phải map tới requirement và task).
**Spike gating** chạy trước khi làm sâu, mỗi cái có tiêu chí pass/fail và đường lui được đặc tả trong
`diagnostics-quality`: S20–S21 và S23 (cầu nối, chuyển tiếp agent qua liên kết Gateway, gắn lời gọi tool với session — D1, D7; S2–S4 của hướng plugin đã rút), S5 (đã rút — plugin nạp từ ngoài cây gateway có đủ khả năng
SDK — D1), S6 (WebView mobile — D4), S7–S17 (runtime, multi-agent, terminal, endpoint tuỳ biến trên
Gateway thật), S18 (workflow báo kết quả về cuộc chat đang bận), S19 (fork archify trong trình duyệt/WebView), S22 (CLI
qua proxy bằng ACP + wrapper), các spike S24–S26 do review vòng 2 đề xuất (S23 nay là gắn lời gọi tool MCP với session), S27 (biến môi trường/lệnh của profile tuỳ biến tới harness `codex`/`copilot` và agent acpx) và S28 (media builtin của OpenClaw qua liên kết Gateway). S1 đã rút.

### D19 — Giấy phép
Mã JAgentChill dựa trên OpenClaw (MIT) và OpenCut classic (MIT): giữ thông báo bản quyền trong
`THIRD_PARTY_NOTICES.md` (file notices của upstream giữ nguyên). Không chép code JAgentDesk
(AGPL-3.0-or-later) — chỉ theo thiết kế; không chép gì từ waoowaoo. FFmpeg dùng bản LGPL như tiến trình ngoài. Giấy phép
phát hành của JAgentChill do chủ dự án quyết; thiết kế này không tạo ràng buộc copyleft.

### D20 — Runtime agent: hai cách dùng provider
Mỗi session/agent chạy trên một **runtime**, người dùng chọn ở model browser và đổi được giữa cuộc chat (D9):
1. **Qua CLI đã cài** (kiểu JAgentDesk): tái dùng backend `claude-cli`, `google-gemini-cli`, harness `codex`, `copilot`, và
   client ACP chung `acpx` (17 đích có sẵn + CLI tuỳ biến qua `agents.<id>.command`; OpenCode và các CLI khác đi đường
   này). Server không giữ credential: dùng chính đăng nhập của CLI. Server thêm: phát hiện CLI (có trên PATH **và** kiểm
   tra đăng nhập — JAgentDesk chỉ kiểm PATH), chẩn đoán, catalogue ACP một-chạm, "profile" tuỳ biến (extends + env +
   command + models), khám phá model, cache snapshot provider, bật/tắt/sắp thứ tự.
2. **Trực tiếp với provider**: API key hoặc OAuth qua auth profile của OpenClaw (`models.authSetApiKey`,
   `models.authLogin` + `wizard.*`), nhiều profile mỗi provider có xoay vòng, endpoint OpenAI-compatible tuỳ biến. Dùng
   runtime dựng sẵn `openclaw`, nên có đủ tool `jagentchill__*` (MCP), steer và mode.
3. **Proxy / router / aggregator là hạng nhất** (yêu cầu của chủ dự án: OpenRouter…, proxy API kiểu 9router): danh sách
   provider sinh từ manifest đi kèm (60 ở tag đang ghim, tự thêm khi nâng upstream); **bản ghi endpoint dùng chung**
   `{baseUrl, dialect, auth, headers, TLS, model list}` với dialect là các giá trị `models.providers.<id>.api` đã kiểm
   chứng (OpenAI Chat/Responses, Anthropic Messages, Google Generative AI, Ollama); preset sửa được cho proxy phổ biến;
   ghi đè base URL của provider chính hãng (chỉ với API key, không bao giờ gửi token đăng nhập tới địa chỉ lạ); profile
   CLI runtime đi qua proxy bằng agent ACP tuỳ biến do wrapper khởi chạy của sản phẩm đặt biến môi trường (spike S22;
   backend `claude-cli` / `google-gemini-cli` có sẵn xoá các biến đó nên không hỗ trợ proxy); failover giữa nhiều khoá/endpoint; cùng bản ghi endpoint dùng cho model
   tạo sinh. Endpoint được gọi từ máy chạy Gateway.
Model browser hiện cả hai nhóm, ghi rõ runtime, khả năng (tool của JAgentChill có dùng được không, steer, mode, đính kèm,
resume) và trạng thái sẵn sàng. Khác biệt khả năng giữa runtime được công bố thành **ma trận khả năng** sinh từ test hợp
đồng (D18), không giấu. Các RPC cấu hình provider đòi `operator.admin`; thiết bị không bao giờ giữ scope đó — server cung
cấp proxy hẹp `jagentchill.provider.*` trên kênh P, chỉ vai `admin` gọi được (xem D25).
*Phương án khác:* tự viết lớp bọc CLI như JAgentDesk (AgentClient/AgentSession riêng) — bị loại vì OpenClaw đã có
backend/harness/ACP và session thống nhất; chỉ viết thêm backend khi một CLI không đi được qua ACP.

### D21 — Multi-agent: đội vai cố định và agent tự do gọi nhau
- **Agent tự do**: tái dùng `sessions_spawn`, `sessions_send`, `sessions_yield`, `agents.create`,
  RPC `sessions.*` / `agent` của Gateway (server gọi qua liên kết của nó), giới hạn độ sâu/đồng thời của OpenClaw. Server thêm bộ tool quản lý agent kiểu JAgentDesk
  (`jc_agent_create`, `_list`, `_send`, `_status`, `_wait`, `_cancel`, `_archive`, `_set_mode`), **có kiểm tra quyền sở
  hữu** theo cây cha–con (JAgentDesk không kiểm), phòng chat giữa agent (tạo/đăng/đọc/chờ, mention), và cây session +
  track agent con trong UI. Chính sách ai-gọi-được-ai là preset trên `tools.agentToAgent` / `tools.sessions.visibility`
  (mặc định của OpenClaw là `all` → mặc định của JAgentChill là trong cùng cây).
- **Đội vai cố định**: OpenClaw chỉ có allowlist + hướng dẫn prompt, nên server sở hữu **mô hình đội và bộ điều phối**:
  `Team {roles, profiles (ORC D10), limits}`; luồng Supervisor → Lead → Peer với task brief, `bootstrap_lead`,
  `create_peer` (route + dự phòng, giới hạn peer **đồng thời** mỗi lead và tổng assignment mỗi brief), `handback` có cấu
  trúc (thay đổi, bằng chứng, điều chưa chắc, phản chứng), giải quyết bất đồng, `accept_result`; trạng thái lượt chạy lưu
  bền; cưỡng chế hình dạng đội **tại endpoint tool của server** chứ không chỉ bằng prompt: thành viên đội chỉ gọi nhau được qua tool
  `jc_agent_*` / `jc_team_*` (server kiểm hình dạng đội rồi mới gọi Gateway), còn `sessions_spawn` / `sessions_send` gốc bị
  tắt cho thành viên đội bằng tool policy của Gateway do server viết. Team mode trong composer biến
  agent hiện tại thành lead của một đội tạm.
- **Bàn giao / trả việc** là động từ hạng nhất do server định nghĩa (`handoff` chuyển quyền chủ trì kèm gói ngữ cảnh,
  `handback` trả kết quả), hiện thành trạng thái trên UI và trên diagram.
- Người dùng thấy toàn bộ: cột agent theo vai, timeline từng agent, can thiệp (nhắn, dừng, đổi model, duyệt).

### D22 — Workspace, file và terminal
Tái dùng `projects.*`, `worktrees.*`, `sessions.create {cwd, projectId, worktree}`, `fs.listDir`, `sessions.files.*`,
`sessions.diff`, `artifacts.*`, `terminal.*`. "Workspace" của JAgentChill gắn một thư mục làm việc trên host với dự án video
(và tuỳ chọn một repo): agent chạy trong cwd đó, có cây file, xem/sửa file (ghi có kiểm tra phiên bản), diff thay đổi,
worktree (branch-off / checkout-branch / checkout-pr) và script setup/service theo file cấu hình workspace. Terminal là
PTY trên host (xterm trên web/desktop, webview/lưới native trên mobile), có profile, scrollback, gắn lại sau khi kết nối
lại, và tool terminal cho agent. Terminal và ghi file ngoài workspace đòi `operator.admin` → đi qua proxy hẹp
`jagentchill.terminal.*` / `jagentchill.fs.*` trên kênh P (D25).

### D23 — Skills và usage
- **Skills**: tái dùng loader và RPC quản lý skill của OpenClaw (nguồn clawhub / npm / git / local, allowlist theo agent).
  Server thêm màn hình Skills, cài/cập nhật/gỡ (có cập nhật từ nguồn — JAgentDesk thiếu), lock file, bộ chọn skill trong
  composer (chèn tối đa 8 tham chiếu `$skill` mỗi lượt, viết lại cú pháp gọi theo runtime), skill đi kèm của JAgentChill
  (đạo diễn, biên kịch, storyboard, dựng phim, archify authoring), và tool tạo/sửa skill cho agent.
- **Usage**: tái dùng `usage.status`, `usage.cost`, `sessions.usage*`; server gộp theo cây agent, theo session, dự án,
  provider và runtime, hiển thị cửa sổ hạn mức gói của provider, và hợp nhất với sổ chi phí tạo sinh của D11 thành một nơi
  xem duy nhất.

### D24 — Automations
Bộ lập lịch do server sở hữu (RRULE + múi giờ, webhook HMAC theo trigger, theo dõi thư mục, sự kiện dự án) khởi chạy
session, workflow (D12), bước phim hoặc export preset. Lượt chạy không người trông dùng render host (D11b) và chính sách
duyệt `agent`/`auto`; cần người duyệt mà không có ai thì dừng ở trạng thái chờ và gửi thông báo.

### D25 — Mô hình quyền: quyền chạy lệnh có thật, kiểm soát theo vai
Phạm vi mới (CLI agent, terminal, workspace) nghĩa là sản phẩm **có** khả năng chạy lệnh trên host, giống JAgentDesk; quyết
định "cấm exec toàn cục" trước đây bị thay thế. OpenClaw nói rõ `operator.write` không phải ranh giới cách ly giữa người
với người, và một Gateway là một miền tin cậy — nên kiểm soát đặt ở các lớp sau:
- **Vai thiết bị** (D7): `viewer` chỉ xem; `editor` dùng editor, chat với agent sáng tạo, chạy workflow; `admin` thêm
  terminal, workspace agent, cấu hình provider/secrets/skill, quản lý thiết bị. Không thiết bị nào giữ `operator.admin` của
  OpenClaw hay bất kỳ scope OpenClaw nào (D7); **mọi** thao tác — kể cả chat với agent và phê duyệt — đi qua server trên
  kênh P, kiểm vai, quyền sở hữu session và scope `jagentchill.*` (gồm `jagentchill.host.exec` cho terminal, script
  workspace và git ghi) trong handler rồi mới gọi Gateway qua liên kết của nó (D1; spike S12). Session có quyền sở hữu: `editor`
  không nhắn được vào session workspace của `admin` và không duyệt được lệnh/terminal của nó.
- **Hai lớp agent**: *agent sáng tạo* (`jagentchill-director`, `-screenwriter`, `-editor`, `-producer`, …) chỉ có tool của
  server, không exec — mặc định cho mọi session; *workspace agent* (runtime CLI/ACP hoặc built-in với tool file/exec) chỉ
  tạo được bởi thiết bị `admin`, hoặc bởi `editor` khi host bật "Allow workspace agents for editors".
- **Mode và phê duyệt**: `permissionMode` + mode gốc của CLI + exec approvals; mode không người trông (bypass/full) phải
  bật tường minh theo session và hiện huy hiệu cảnh báo.
- **Run profile** (server viết vào cấu hình Gateway bằng `ensureRunProfile()`, chỉ siết; mọi session được tạo kèm `permissionMode` tường minh — `read-only` cho creative, `guarded` cho workspace — vì session không có mode chạy lệnh host không hỏi, xem `docs/decisions/0002-…` hàng 13): channel tắt, `plugins.allow` tối thiểu,
  `gateway.auth.mode: "token"` với token không rời host, `autoApproveLocal: false`, endpoint OpenAI-compatible tắt, agent
  mặc định là agent sáng tạo, `tools.sessions.visibility` giới hạn trong cây, terminal không thừa hưởng biến môi trường
  chứa bí mật của Gateway.
- **Bí mật**: file owner-only ghi nguyên tử trên host, tham chiếu bằng SecretRef, không bao giờ trả về client.
- **Egress**: một danh sách duy nhất do `security-privacy` sở hữu (cập nhật, tải font, Freesound, tải model, provider, push
  tuỳ chọn và tối thiểu nội dung, connector).

## Risks / Trade-offs

- [Engine trong WebView mobile: WebGPU/WebCodecs khác nhau giữa iOS và Android, giới hạn bộ nhớ] → spike bắt buộc ở nhóm
  task đầu của render: đo decode/encode 1080p30 và 4K trên iPhone và Android tầm trung; dự phòng WebGL2 đã có; export
  nặng chuyển sang Gateway; proxy 720p khi chỉnh sửa.
- [Khối lượng: 515 dòng port + 291 dòng CapCut + agent/workflow/film trên ba nền tảng] → không cắt phạm vi; chia theo
  capability với cổng kiểm chứng độc lập, mỗi dòng checklist có requirement và task riêng để theo dõi phủ.
- [Upstream OpenClaw đổi nhanh, giao thức Gateway/RPC có thể vỡ] → bám tag stable, ghim phiên bản `@openclaw/gateway-client` theo tag, test hợp đồng gateway của server
  chạy trong CI trước khi nâng tag.
- [Token Devin là ước lượng; Mobbin không có bản mobile] → `design-system` chốt số cụ thể; mobile theo quy tắc suy dẫn đã ghi.
- [32 dòng CapCut UNVERIFIED và các mục nguồn mỏng] → spec chốt hành vi cụ thể, đánh dấu [NEW] thay vì [CAPCUT].
- [Chi phí và độ trễ của provider tạo sinh] → ước tính chi phí trước khi chạy, hạn mức theo dự án, duyệt từng bước, cache
  kết quả theo hash đầu vào.
- [Sản phẩm có khả năng chạy lệnh trên host (CLI agent, terminal)] → mô hình quyền D25: vai thiết bị, hai lớp agent, proxy
  admin hẹp, mode + phê duyệt; agent sáng tạo mặc định không có exec.
- [Khả năng không đồng đều giữa runtime (steer, mode, tool, usage); mất ngữ cảnh khi đổi runtime] → ma trận khả năng sinh
  từ test hợp đồng, UI mờ điều khiển không hỗ trợ kèm lý do, bản tóm lược lịch sử lưu bền khi đổi runtime; spike S7–S16.
- [Engine workflow đồ thị và bộ điều phối đội là phần mới lớn nhất, OpenClaw không có sẵn] → một engine dùng chung cho
  workflow, mẫu video và pipeline phim; cưỡng chế hình dạng đội tại endpoint tool của server chứ không chỉ prompt.
- [`registerAgentHarness` là API thử nghiệm của OpenClaw và đang đổi] → không tự đăng ký harness; chỉ dùng backend/harness/ACP có sẵn.
- [Lỗi kế thừa từ classic (6 mục nghi vấn)] → mỗi mục có test tái hiện trước khi port phần liên quan.
- [Một người ghi mỗi dự án] → chấp nhận; nêu rõ trong UI khi dự án đang bị khoá bởi thiết bị khác.

## Migration Plan

Repo mới nên không có dữ liệu cũ của chính nó. Nhập dự án OpenCut classic: đọc bản xuất IndexedDB/OPFS schema v1–v31 và
chạy chuỗi migration lên schema 32. Rollback một bản phát hành: desktop giữ bản cài trước; schema dự án chỉ tiến, mỗi lần
migration lưu bản sao lưu trước khi ghi.

## Open Questions

1. Giấy phép phát hành của JAgentChill (mặc định trong spec: mã nguồn riêng, giữ thông báo MIT của bên thứ ba).
2. Có cần đăng nhập tài khoản không. Mặc định: không có tài khoản; danh tính = thiết bị đã ghép cặp với Gateway.
3. Bundle id, tên hiển thị, tài khoản Apple/Google để ký và phát hành (cần khi tới nhóm task phân phối).
