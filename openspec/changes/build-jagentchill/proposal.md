## Why

Cần một trình biên tập video đa nền tảng (desktop / mobile / web) hoạt động giống CapCut nhưng do mình sở hữu, chạy
local-first trên máy người dùng, và có lớp agent mà CapCut không có: chat agent điều khiển editor, workflow tạo video
từ một prompt, và studio sản xuất phim bằng AI với cấu hình provider/model theo từng vai trò. Mã nguồn mở sẵn có
(OpenCut classic) mới chỉ là một phần nhỏ của CapCut và chỉ chạy trên desktop web; OpenClaw cung cấp sẵn khung agent,
ghép cặp thiết bị và định tuyến model để dựng phần còn lại.

## What Changes

- `jagentchill` là repo riêng của sản phẩm; OpenClaw là gateway (khung agent) nguyên bản trong `gateway/openclaw/`, ghim
  theo tag và kéo về bằng script; toàn bộ code JAgentChill nằm ngoài cây đó (`server/`, `packages/`, `apps/`); JAgentChill có server riêng giám sát OpenClaw như tiến trình con, không phải plugin của OpenClaw.
- Port toàn bộ chức năng OpenCut classic (dự án, media, timeline nhiều track, preview, text, sticker/shape, mask,
  blend, effect, keyframe + graph editor, scene, bookmark, tốc độ, phụ đề, transcription, âm thanh, export, phím tắt,
  lưu trữ + migration), sửa các lỗi và phần dang dở đã ghi nhận trong bản kiểm kê.
- Nâng editor lên chuẩn CapCut (CC-001..CC-291): transition, filter, thư viện effect, chỉnh màu (basic/HSL/curves/
  wheels/LUT), speed curve, reverse, freeze frame, crop/mirror/rotate, chroma key, cutout, ổn định hình, viền/bóng/glow
  chữ, text template, hoạt ảnh vào/ra, fade và xử lý âm thanh, beat, voiceover, template, cover, compound clip, khoá
  track, export đa độ phân giải/fps/bitrate/codec/GIF/audio-only, xuất phụ đề.
- App đa nền tảng một codebase (Expo / React Native + react-native-web), desktop Electron, editor mobile theo cấu trúc
  thao tác của CapCut mobile; giao diện theo ngôn ngữ thị giác Devin.
- Kết nối web/desktop ↔ mobile qua Gateway với ghép cặp và **ký xác thực** (Ed25519, challenge có nonce, mã xác minh
  6 số, thu hồi; mọi lưu lượng đi qua kênh của JAgentChill Server, truy cập từ xa bằng Tailscale nhúng như JAgentDesk), đồng bộ dự án và media giữa các thiết bị, render từ xa trên máy desktop đã ghép cặp.
- Chat agent (session, streaming timeline, quyền tool, đính kèm, voice) có bộ tool thao tác trực tiếp lên editor; đổi
  provider / model / mức thinking / mode / skill ngay trong cuộc chat như JAgentDesk.
- Hai cách dùng provider: qua CLI agent đã cài (Claude Code, Codex, Gemini, Copilot, OpenCode và mọi CLI nói ACP) hoặc
  trực tiếp bằng OAuth / API key.
- Script studio: người dùng soạn kịch bản; agent tự lập kịch bản rồi chờ người duyệt hoặc tự duyệt bằng agent reviewer.
- Multi-agent: đội agent vai cố định (Supervisor → Lead → Peer, vai tuỳ biến) và agent tự do gọi nhau (spawn, nhắn tin,
  bàn giao, trả việc, phòng chat giữa agent).
- Engine workflow dạng đồ thị: người dùng vẽ hoặc agent tự lập pipeline từ ý định và tự nối các agent trên diagram;
  workflow tạo video từ một prompt và pipeline phim là các mẫu chạy trên engine này. Canvas workflow là bản fork
  archify mở rộng (toạ độ tự do, kéo thả node, animation, trạng thái sống), xuất được HTML tự chứa và tài liệu cho archify gốc.
- ORC: cấu hình profile / runtime / provider / model cho từng vai trò (điều phối, kịch bản, ảnh, video, giọng, nhạc,
  lip-sync, phụ đề…), có route chính + dự phòng, quản lý khoá API và theo dõi chi phí.
- Workspace / project, duyệt và sửa file, terminal PTY, skills và usage như JAgentDesk.
- Studio sản xuất phim (truyện → tập → nhân vật/bối cảnh/đạo cụ → kịch bản → storyboard → ảnh panel → video panel →
  giọng → lip-sync → đổ vào timeline → export phim), viết mới theo hành vi tham chiếu.
- Bộ khởi đầu CC0 (nhạc, SFX, sticker); connector nhập Drive/Dropbox và đăng mạng xã hội bằng OAuth client của người dùng.
- Công cụ AI trong editor, automations/lịch chạy, settings, thông báo, i18n (en/vi/ja), cập nhật desktop + OTA mobile,
  bảo mật, chẩn đoán và cổng chất lượng theo repository-harness.

## Capabilities

### New Capabilities

- `platform-skeleton`: bố cục repo JAgentChill, OpenClaw làm gateway nguyên bản trong `gateway/openclaw/`, nâng bản gateway, build, harness.
- `server-api`: JAgentChill Server — RPC, HTTP route, service nền, sự kiện, lưu trữ phía host, giám sát và liên kết Gateway OpenClaw, endpoint tool MCP cho agent.
- `device-pairing-signing`: định danh thiết bị, pairing offer, handshake ký, mã xác minh, thu hồi, kết nối lại.
- `cross-device-sync`: đồng bộ dự án, media và trạng thái giữa thiết bị; xung đột; render từ xa.
- `app-shell-navigation`: khung app kiểu Devin — sidebar, top bar, home composer, điều hướng, layout theo nền tảng.
- `design-system`: token, typography, component, overlay, theme sáng/tối, quy tắc mật độ.
- `project-document`: định nghĩa chuẩn và duy nhất của tài liệu dự án (schema 32) — mọi trường của project, scene, track, element, animation, effect, mask, transition, audio, template, multi-camera; ánh xạ từ OpenCut classic.
- `projects`: tạo/mở/đổi tên/nhân bản/xoá dự án, canvas, fps, nền, cover, scene, thư mục, thùng rác.
- `media-library`: nhập, phân tích, thumbnail, thư mục, tìm kiếm, relink, proxy, ghi hình/ghi âm.
- `timeline-editing`: track, phần tử, chọn, kéo, trim, split, ripple, snap, clipboard, nhóm, compound, khoá, bookmark.
- `preview-canvas`: phát, zoom/pan, tay nắm transform, snap, guide, crop, fullscreen, snapshot.
- `text-and-titles`: text, font, style, viền/bóng/glow, nền, template, hoạt ảnh chữ, sửa trên canvas.
- `captions-subtitles`: nhập/xuất phụ đề, auto caption, song ngữ, sửa hàng loạt, style caption.
- `audio-editing`: âm lượng, fade, tách audio, voiceover, thư viện nhạc/SFX, giảm ồn, beat, chuẩn hoá, waveform.
- `visual-effects-filters`: thư viện effect và filter, tham số, xếp chồng, effect layer.
- `transitions`: chuyển cảnh giữa clip, thời lượng, áp dụng tất cả, thư viện.
- `color-adjustment`: basic, HSL, curves, colour wheels, LUT, adjustment layer.
- `keyframe-animation`: keyframe, graph editor, easing, hoạt ảnh vào/ra/kết hợp cho clip.
- `speed-retime`: tốc độ hằng, speed curve, giữ cao độ, reverse, freeze frame, slow-mo mượt.
- `masks-blending-keying`: mask, feather, blend mode, opacity, chroma key, cutout.
- `stickers-shapes`: sticker, shape, thư viện, recent, tham số.
- `templates`: template dự án và template chữ/hiệu ứng, thay media, lưu template riêng.
- `render-engine`: scene graph, compositor GPU, giải mã, cache, mix âm thanh, độ chính xác khung hình, engine surface.
- `export-share`: export video/GIF/audio/ảnh, cấu hình, hàng đợi, export từ xa, chia sẻ.
- `project-storage`: lưu trữ local theo nền tảng, autosave, migration, sao lưu/khôi phục, quota.
- `keyboard-shortcuts`: phím tắt mặc định, gán lại, xung đột, bảng lệnh.
- `mobile-editor`: editor trên điện thoại/tablet theo cấu trúc CapCut mobile.
- `desktop-app`: Electron shell, giám sát Gateway, cửa sổ, menu, file association, deep link.
- `chat-agent`: session agent, streaming, timeline, quyền, đính kèm, voice, mode, workspace panel.
- `agent-editing-tools`: bộ tool để agent đọc và sửa dự án/timeline/media, preview và undo an toàn.
- `agent-runtimes`: runtime CLI (backend, harness, ACP) và runtime trực tiếp (OAuth/API key), phát hiện, chẩn đoán, profile, ma trận khả năng.
- `multi-agent-orchestration`: đội vai cố định, agent tự do gọi nhau, bàn giao/trả việc, phòng chat agent, giới hạn, giám sát.
- `agent-workflows`: engine workflow đồ thị, loại node, người vẽ hoặc agent tự lập, chạy, duyệt, mẫu.
- `script-studio`: soạn kịch bản bởi người và agent, phiên bản, chính sách duyệt người/agent/tự động, liên kết timeline.
- `skills`: cài/cập nhật/gỡ skill, nguồn, chọn skill theo lượt, skill đi kèm.
- `usage-tracking`: usage theo provider/runtime/session/agent/dự án, hạn mức gói, hợp nhất với chi phí tạo sinh.
- `workspaces-terminal`: workspace, worktree, cây file, xem/sửa file, diff, terminal PTY, script.
- `orc-model-routing`: vai trò, profile, route + fallback, mức thinking, giới hạn, UI cấu hình.
- `generation-providers`: provider ảnh/video/giọng/nhạc/lip-sync, khoá API, catalog model, hàng đợi, retry, ngân sách, chi phí.
- `prompt-to-video-workflow`: mẫu workflow một prompt → video trên engine `agent-workflows`, các bước, duyệt, chạy lại, đổ ra timeline.
- `workflow-diagram`: canvas workflow trên fork archify mở rộng — kéo thả node, nối cổng, animation, trạng thái sống, xuất.
- `film-production`: studio sản xuất phim theo bước, tài sản nhân vật/bối cảnh, storyboard, panel, giọng, lip-sync.
- `ai-editing-tools`: công cụ AI trong editor (cắt nền, auto reframe, TTS, nâng giọng, script-to-video, long-to-shorts…).
- `automations`: lịch chạy và trigger khởi động session/workflow.
- `settings-preferences`: preferences cá nhân, cấu hình host, kết nối, secrets, usage.
- `notifications`: thông báo trong app, hệ điều hành và push khi tác vụ cần chú ý.
- `i18n-accessibility`: locale, định dạng, RTL-ready, bàn phím, screen reader, tương phản.
- `updates-distribution`: đóng gói, ký, auto-update desktop, OTA mobile, cập nhật Gateway, tương thích giao thức.
- `security-privacy`: mô hình tin cậy, lưu khoá, sandbox tool, kiểm soát mạng, dữ liệu không rời máy.
- `diagnostics-quality`: log, chẩn đoán, hiệu năng, chiến lược test, cổng CI, user story theo harness.

### Modified Capabilities

Không có — repo mới, chưa có spec nào trong `openspec/specs/`.

## Non-goals

- Không sửa mã nguồn OpenClaw và không đặt code JAgentChill trong cây của nó; không dùng các channel nhắn tin của nó.
- Không phải dịch vụ SaaS nhiều tenant: một Gateway là một miền tin cậy của một người vận hành; không có cloud dùng chung.
- Không sao chép code, prompt hay tài sản của waoowaoo; không dùng thương hiệu, logo hay asset của CapCut và Devin.
- Không kèm thư viện nhạc/sticker/template có bản quyền của CapCut; thư viện đi kèm chỉ gồm nội dung có giấy phép phù hợp.
- Không có mạng xã hội, feed template cộng đồng hay marketplace trả phí.
- Không gửi telemetry ra ngoài.
- Không xuất HDR: pipeline là SDR 8-bit, nguồn HDR được tone-map.
- Điện thoại và trình duyệt không làm host được: agent, workflow, tạo sinh và đồng bộ cần một host chạy trên hệ điều hành
  desktop hoặc máy chủ; không có dịch vụ do nhà phát hành host.
- Không phải ranh giới cách ly giữa nhiều người trên cùng một Gateway: thiết bị vai `admin` có quyền chạy lệnh trên host.

## Impact

- Repo mới `hdc/jagentchill`: monorepo riêng + OpenClaw làm gateway trong `gateway/openclaw/`; yêu cầu Node ≥ 24.16, pnpm 12, Rust (wasm32),
  Xcode, Android SDK.
- Phụ thuộc mới: Expo/React Native, Electron, wgpu/wasm-bindgen, mediabunny (WebCodecs), FFmpeg (LGPL, cho export/proxy
  phía host), Whisper ONNX, Tailscale (truy cập từ xa), các provider tạo sinh do người dùng cấu hình khoá.
- Giấy phép: OpenClaw MIT, OpenCut classic MIT, archify MIT; phần tái dùng từ JAgentDesk (AGPL-3.0-or-later) chỉ ở
  mức thiết kế trừ khi chủ dự án chọn AGPL cho JAgentChill — xem design.
- Người dùng cuối cần tự cấp khoá API cho provider tạo sinh; chi phí tạo ảnh/video do provider tính.
