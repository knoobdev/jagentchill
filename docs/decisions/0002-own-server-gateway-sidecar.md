# 0002 — JAgentChill Server riêng; OpenClaw là tiến trình con (thay thế 0001)

Ngày: 2026-10-05. Môi trường: macOS arm64, Node 24.17.0, pnpm 12.5.1, OpenClaw v2026.9.8 (`fc23bc864e`) nguyên bản trong
`gateway/openclaw/`. Mọi kết quả dưới đây là từ chạy thật (`node server/src/main.ts`, log `.dev/server-spike.log`), không
phải đọc mã. Lượt agent thật (hàng 6–8) chạy bằng runtime CLI `claude-cli/claude-sonnet-5` (Claude Code đã cài và đăng nhập sẵn
trên máy); chưa thử runtime API key / OAuth.

## Bối cảnh
0001 chứng minh được kênh client nằm trong một plugin của OpenClaw, nhưng plugin phải được chép vào `dist/extensions/` của
gateway mới gọi được lõi. Chủ dự án bác hướng đó: JAgentChill không được là plugin/extension của OpenClaw.

## Quyết định
```
App (web / desktop / mobile) ──ký, kênh client──► JAgentChill Server (server/, tiến trình của ta)
                                                     │  giám sát (child process) + giao thức Gateway qua loopback
                                                     ▼
                                              OpenClaw Gateway (gateway/openclaw/, nguyên bản, chỉ nghe loopback)
                                                     │  MCP Streamable HTTP (tool của JAgentChill)
                                                     └──────────────► JAgentChill Server /agent-tools/mcp
```
- JAgentChill Server sở hữu: kênh client (ghép cặp, ký, vai thiết bị), dự án, đồng bộ, hàng đợi job, workflow, film,
  ORC, provider tạo sinh, kho dữ liệu. Không có plugin JAgentChill nào trong OpenClaw.
- OpenClaw chỉ là bộ máy agent: session, runtime (API key / OAuth / CLI), model, sub-agent, terminal, phê duyệt. Server
  khởi chạy nó theo `docs/gateway/embedding.md`, viết cấu hình của nó, và là client DUY NHẤT của nó.
- Tool của JAgentChill cho agent được cấp qua MCP: server tự đăng ký endpoint của mình vào `mcp.servers.jagentchill`.

## Kết quả chạy thử
| # | Câu hỏi | Kết quả |
|---|---|---|
| 1 | Server khởi chạy gateway nguyên bản như tiến trình con (state dir riêng, token do server sinh, loopback, `OPENCLAW_SKIP_CHANNELS=1`)? | **Đạt** — `[gateway] ready` sau ~4 s. |
| 2 | Server nối bằng thư viện chính thức `@openclaw/gateway-client` (giao thức v4, token + danh tính thiết bị Ed25519 của server)? | **Đạt** — `[server] gateway linked`, không cần bước duyệt ghép cặp thủ công (loopback + token). |
| 3 | Server có đủ scope `operator.read/write/admin/approvals`? | **Đạt** — `models.list`, `config.get`, `tools.catalog`, `sessions.list`, `agents.list` đều trả kết quả. |
| 4 | OpenClaw nối được endpoint MCP của server và thấy tool? | **Đạt** — `openclaw mcp probe jagentchill --json` → `tools: ["jagentchill__jc_echo", "jagentchill__jc_server_info"]`, không có diagnostic. |
| 5 | Dừng server thì gateway dừng sạch? | **Đạt** — SIGTERM → `[shutdown] completed cleanly`, `gateway exited code=0`, không còn cổng nào nghe. |

| 6 | Server đổi cấu hình gateway lúc đang chạy qua RPC? | **Đạt** — `config.get` → `config.patch {raw, baseHash}` đặt `agents.defaults.model.primary`; gateway phát `config.changed`. |
| 7 | Một lượt agent thật do server khởi tạo (`sessions.create` + `chat.send`) chạy tới cuối và server nhận stream? | **Đạt** — event `session.message`, `agent` (12), `chat` (4, kết thúc `state: "final"`); `chat.history` trả đủ transcript. |
| 8 | Agent gọi được tool MCP của JAgentChill Server? | **Đạt** — agent gọi `mcp__jagentchill__jc_echo`, log server `[agent-tools] jc_echo called`, câu trả lời cuối là đúng giá trị tool trả (`pineapple-42`). Event `agent` (`stream: "item"`, `kind: "tool"`, `phase: start/end`) mang `sessionKey`, `toolCallId`, `name` → dùng được để đối chiếu cho S23. |
| 9 | Ghép cặp + bắt tay ký trên kênh client của server khi gateway đang chạy? | **Đạt** — `server/scripts/live-pair.ts`: thiết bị giả lập ghép cặp bằng offer + mã 6 số in trên terminal host, `ready` vai `admin`, gọi `jagentchill.device.list`. |

| 10 | Toàn tuyến sản phẩm: thiết bị đã ghép cặp → kênh client có ký → server kiểm quyền sở hữu session → gateway → agent → tool MCP của server → stream về thiết bị? | **Đạt** — `server/scripts/live-chat.ts`: `jagentchill.session.create` (key `agent:main:jc:<uuid>`, `access: private`), `jagentchill.chat.subscribe`, `jagentchill.chat.send`; thiết bị nhận `jagentchill.chat.activity` (tool start/end `mcp__jagentchill__jc_echo`), `jagentchill.chat.stream` kết thúc `final` với `mango-17`; `jagentchill.chat.history` trả 4 message. |

| 11 | S23 — endpoint tool biết session nào đang gọi, không cần agent tự khai? | **Đạt** (runtime `claude-cli`) — `server/scripts/live-binding.ts`: hai session gọi `jc_session_whoami` cùng lúc, hai vòng; cả 4 lần mỗi session nhận đúng khoá của chính nó. Mỗi session giữ một kết nối MCP riêng (cùng `mcp-session-id` qua các lượt). |
| 12 | Đưa ngữ cảnh riêng của session tới model qua `chat.inject` hoặc `chat.send.workContext`? | **Không đạt** — model trả `NONE`; hai đường này không tới model trên runtime CLI. Vì vậy KHÔNG dùng handle do model mang theo. |

| 13 | Lệnh shell của agent trên host có bị chặn / hỏi duyệt không? (`server/scripts/spike-approval.ts`, runtime `claude-cli`) | **Mặc định: KHÔNG** — session tạo không kèm `permissionMode` chạy `echo … > /tmp/…` ngay, không có event phê duyệt nào. `permissionMode: "read-only"` → lệnh bị từ chối (`security=deny`), file không được tạo. `"guarded"` → bị từ chối vì trượt allowlist (`ask=off`), cũng không có yêu cầu phê duyệt. Hệ quả đã vào code: server luôn tạo session với `read-only` (creative) hoặc `guarded` (workspace). |

| 14 | Dừng server khi agent đang chạy có để lại gateway mồ côi không? | **Lần đầu: CÓ** (gateway còn "draining" tới 325 s, giữ cổng và state dir sau khi server đã thoát). **Sau khi sửa** (`server/src/gateway/supervisor.ts`: gateway chạy trong process group riêng, SIGTERM rồi SIGKILL cả nhóm sau 8 s, pid file để server lần sau dọn gateway cũ): SIGTERM giữa lượt agent → 0 tiến trình còn lại, 0 cổng nghe; SIGKILL server → lần khởi động kế dọn gateway cũ rồi liên kết lại. Token gateway chỉ nằm trong file cấu hình, không còn trong biến môi trường. |

| 15 | S21 — yêu cầu phê duyệt lệnh host của agent tới được server và server trả lời được? (runtime `claude-cli`, session `guarded`, chính sách `security=allowlist, ask=on-miss` do server đặt qua `config.patch` + `exec.approvals.set`) | **Đạt, với một điều kiện phát hiện bằng chạy thật:** liên kết phải khai `caps: ["approvals", "exec-approvals", "plugin-approvals"]`; thiếu thì gateway không coi server là bên duyệt và tự từ chối, không phát event nào. Có caps: event `plugin.approval.requested` (kèm `sessionKey`, `toolCallId`, lệnh, `allowedDecisions`), server gọi `approval.resolve {id, kind, decision}` → `allow-once`: lệnh chạy, file được tạo; `deny`: lệnh bị chặn, file không có. `resolvedBy: "JAgentChill Server"`. |

| 16 | Phê duyệt đi trọn tuyến sản phẩm: thiết bị `admin` đã ghép cặp nhận yêu cầu và trả lời? | **Đạt** — `server/scripts/live-approval.ts`: server tự áp run profile lúc liên kết (`security=allowlist, ask=on-miss, askFallback=deny`); thiết bị nhận `jagentchill.approval.requested`, gọi `jagentchill.approval.resolve`. `allow-once` → file được tạo; `deny` → không có file. Bảng `audit` của server ghi đúng thiết bị đã quyết định cho cả hai lần. |

### Runtime, provider và routing (2026-10-06, `server/scripts/live-runtimes.ts`, `server/scripts/live-providers.ts`)
Máy thử: `claude` 2.1.289 (đã đăng nhập), `codex` 0.160.0 (đăng nhập ChatGPT), `opencode` 1.18.34 (6 credential), `gemini` 0.26.0;
không có `copilot`; không có API key nào trong môi trường. "Provider" của hàng 21–24 là STUB cục bộ
`server/scripts/stub-openai.ts` (nói giao thức OpenAI Chat Completions, không phải model) — mọi thứ trước lời gọi HTTP mang key là thật.

| # | Câu hỏi | Kết quả |
|---|---|---|
| 17 | Catalogue model của Gateway có sẵn ngay sau khi khởi động? | **Không.** `models.list` trả rỗng cho tới khi gọi với `refresh: true`; model của `claude-cli`, `acp-*` biến mất sau mỗi lần cấu hình reload ("Unknown provider \"claude-cli\"") cho tới lần refresh kế. Server yêu cầu refresh một lần sau mỗi thay đổi, đọc lại tới khi đủ, và lặp lại lời gọi đặt model sau khi refresh. Đặt sẵn `agents.defaults.models["claude-cli/…"]` làm `models.list {refresh}` lỗi "Prepared synthetic auth is missing for anthropic" — không dùng. |
| 18 | Codex chạy bằng đăng nhập của CLI đã cài? | **Đạt, với điều kiện:** plugin `codex` phải bật (`plugins.entries.codex.enabled`) và `config.appServer.homeScope: "user"`; mặc định (`"agent"`) harness dùng Codex home riêng và báo `Runtime "codex" is not available`. Lượt thật qua kênh client: `openai/gpt-6-astra` + `agentRuntime: "codex"` → `codex-ok`. |
| 19 | OpenCode qua ACP (`acp-opencode`)? | **Đạt, với hai điều kiện phát hiện bằng chạy thật:** (a) thư mục `<stateDir>/workspace` phải tồn tại — Gateway khởi chạy agent ACP với cwd đó để hỏi danh sách model, và chỉ tự tạo nó ở session đầu tiên; thiếu thì provider `acp-opencode` mãi `unavailable` (server nay tạo thư mục lúc khởi động); (b) Gateway chỉ chạy runtime ACP gốc với `permissionMode: "full"` ("OpenCode uses its own permissions and requires Full access"; `nativeRuntimeConsent` cũng đòi Full access). Vì vậy session ACP cần thiết bị `admin` xác nhận `confirmFullAccess` và được ghi là unattended. Lượt thật: `acp-opencode/opencode/big-pickle` → `acpopencode-ok`. Bảng mode Ask/Plan/Edit/Auto của spec cho ACP không áp dụng được ở bản này. |
| 20 | Gemini CLI dùng đăng nhập riêng của CLI? | **Không ở bản này** — backend `google-gemini-cli` chạy bằng profile API key Google AI Studio (`docs/providers/google.md`); không có key nên không có model nào được liệt kê và chưa chạy được lượt nào. Snapshot báo `runtime/no-provider` kèm lời giải thích. `copilot`: chưa cài → `runtime/not-installed`. |
| 21 | API key đặt từ thiết bị `admin` tới được lời gọi provider mà không lộ? | **Đạt (với stub).** Key đi qua route ký `PUT /jagentchill/v1/secrets/{name}`, RPC chỉ mang tên secret; server gọi `models.authSetApiKey` (profile sinh ra là `<provider>:manual`, không phải `:default` như spec viết) rồi `models.probe` → `ok`; stub ghi "key accepted". Key không có trong 223 frame của hai thiết bị, log server/Gateway, `openclaw.json`, `config.json`; chỉ nằm ở `secrets/host-secrets.json` (0600) và kho auth của Gateway (`state/openclaw.sqlite`). Key sai → probe `auth` → `runtime/auth-failed`, profile và secret bị xoá. |
| 22 | Ghi đè base URL của provider đóng gói chỉ với `baseUrl`? | **Không đủ** — overlay `models.providers.<id>` không có `models` làm provider không còn model nào (`models.probe` → `no_model`, thử với `openrouter`, `deepseek`, `mistral`, `groq`). Overlay phải kèm `api` và `models`; `jagentchill.provider.override.set` vì thế nhận thêm `dialect`, `models`. |
| 23 | Endpoint tuỳ biến tương thích OpenAI dùng được trọn tuyến? | **Đạt (với stub).** Bản ghi endpoint → `models.providers.<id>` với `apiKey` là SecretRef file (`{source:"file", provider:"jagentchill", id:"/NAME"}`, provider khai trong `secrets.providers`); discover 2 model, test `resolve/connect/auth-and-models/completion/streaming/usage` đều pass; thiết bị `editor` chạy một lượt creative trên `builtin`. |
| 24 | Đổi model, rồi đổi runtime giữa cuộc chat có giữ session và lịch sử? | **Đạt.** Trong `builtin`: `sessions.patch {model}` giữ nguyên transcript (lượt 2 thấy cả hai marker). Sang `claude-code`: patch tại chỗ thành công (không phải tạo session mới), nhưng CLI KHÔNG thấy lịch sử cũ nếu không được đưa — bản tóm tắt bàn giao do server lưu và chèn đầu lượt kế là bắt buộc; có nó CLI trả đúng hai marker. `chat.history` 6 message, usage từng lượt lấy từ `usage` của message assistant cuối. |
| 25 | Đăng nhập provider (OAuth / device code) điều khiển từ xa được? | **Một phần.** `models.authLogin {sessionId, authChoice: "<provider>/<choiceId>"}` + `wizard.next` trả đúng các bước (note, note kèm `externalUrl`, `text`; với device code là `progress` kèm `deviceCode`, và `wizard.next` kế tiếp treo tới khi người dùng duyệt); `wizard.cancel` kết thúc. Chưa có lần đăng nhập nào được hoàn tất bằng trình duyệt — bước đó cần người. |
| 26 | Thiết bị `editor` có đọc/đặt được secret hay đổi routing? | **Không** — `SCOPE_DENIED` cho 10 method cấu hình, route secret trả 403, chuyển session sang `claude-code` bị từ chối trước khi gọi Gateway. |
| 27 | Vì sao Gateway từ chối "model not allowed" với mọi model Claude Code trừ một? | **Do allowlist.** Map `agents.defaults.models` không rỗng được Gateway hiểu là allowlist và ở lần ghi cấu hình kế tiếp được chuyển thành `agents.defaults.modelPolicy.allow` (đóng dấu `meta.migrations.modelPolicyAllowlist`). Một object `modelPolicy` không có `allow` (kể cả `{}`) = cho phép mọi model, và map `models` chỉ còn là metadata. Server chiếu `modelPolicy` không có `allow` trước khi Gateway khởi động và ở mỗi lần chiếu; server là nơi quyết định model nào chọn được (`assertSelectable`). Đo trên Gateway thật: tạo session + đổi model với mọi model Claude Code đều qua. |
| 28 | Vì sao Codex "lists no model" (và lại mất sau khi khởi động lại)? | **Hai nguyên nhân, cùng một lỗi của Gateway:** `models.list {refresh:true}` thất bại "Prepared synthetic auth is missing for anthropic" khi (a) còn một entry `agents.defaults.models["claude-cli/…"]`, hoặc (b) `agents.defaults.model.primary` là một model `claude-cli/…` tại lúc Gateway KHỞI ĐỘNG (đặt bằng `config.patch` lúc đang chạy thì không sao). Khi refresh hỏng, provider `openai` của Codex không bao giờ được liệt kê. Server: phép chiếu sở hữu toàn bộ map `models` (xoá entry lạ) và KHÔNG đặt model của CLI backend (Claude Code, Gemini CLI) làm `primary` — session và lượt Orc luôn nêu model của mình. Bật sẵn plugin `anthropic` trong cấu hình không sửa được (đã thử). Đo: route Director = Claude Code, khởi động lại → Codex 6 model, Claude Code 10. |
| 29 | Agent ACP (OpenCode…) có nhận được MCP server của mình không? | **Có, chỉ dạng stdio.** Plugin `acpx` chuyển `plugins.entries.acpx.config.mcpServers` (`{command,args,env}`) vào `session/new` của ACP, cả với session native; biến môi trường định danh session chỉ được chèn cho bridge do acpx tự quản. Harness ACP native không phát sự kiện `agent` cho tool call nên không gắn session theo "call được báo" — server gắn theo lease/pid của tiến trình agent. Tiến trình agent ACP chỉ khởi động ở prompt ĐẦU TIÊN, một tiến trình mỗi session. Đo với agent ACP giả lập (test double); OpenCode thật chưa chạy vì cần gửi prompt. Codex: harness đưa `mcp.servers` của Gateway vào cấu hình thread nên không cần bridge. |
| 30 | Tool "hỏi người dùng" riêng của runtime (`AskUserQuestion` của Claude Code) đi đâu? | Vào question manager của Gateway: sự kiện `question.requested` (payload = bản ghi câu hỏi), RPC `question.resolve {id, answers | cancel}`, `question.list/get`; cần scope `operator.questions` trên link (thiếu scope này → server không thấy câu hỏi → lượt treo, đúng lỗi của owner). Timeout mặc định 15 phút. Server chuyển thành thẻ câu hỏi của sản phẩm và trả lời ngược lại bằng `question.resolve`; session không hiển thị được thì huỷ ngay. Tái hiện không cần prompt bằng `question.request {sessionKey, questions}`. |
| 31 | Vì sao agent thấy tool Memory dù hồ sơ chạy đã tắt memory? | Cơ chế auto-enable plugin lúc khởi động: một entry `plugins.entries.<id>.config` có giá trị thuộc schema của plugin có tool mà không kèm `enabled:false` thì plugin được "enabled automatically" trong bản cấu hình runtime (không ghi file). Chính dòng `memory-core.config.dreaming` của hồ sơ chạy đã bật `memory-core`. Sửa: `plugins.slots.memory: "none"` + `memory-core.enabled: false`. Đo: Gateway nạp 18 plugin, không có `memory-core`, không còn dòng auto-enable; danh sách tool model nhận không có tool memory. (Gateway cảnh báo vô hại "plugin disabled but config is present".) |
| 32 | Sự kiện `chat` `state:"delta"` mang gì? | Chỉ delta ĐẦU của lượt có `message` đầy đủ; các delta sau chỉ có `deltaText` (phần thêm) và `replace:true` khi thay toàn bộ. Văn bản cộng dồn của lượt đi xuyên qua cả tool call (sau tool, văn bản gồm cả phần trước tool). Relay của server cộng dồn và gửi cho thiết bị toàn bộ văn bản ở mỗi delta; trước đó thiết bị chỉ thấy vài ký tự đầu (owner thấy "B"). |
| 33 | Cái gì thực sự tới được model làm ngữ cảnh project? | `chat.inject` và `chat.send.workContext` KHÔNG tới model (hàng 12). Tới được: (a) khối ngữ cảnh server đặt trước lời người dùng trong `chat.send` (đo bằng stub: request model nhận có tên project, id, canvas/fps, track; lặp lại mỗi lượt; bị cắt khỏi `chat.history` và `session.message` trước khi tới thiết bị); (b) `instructions` của MCP server. Runtime nhúng không đưa từng tool MCP cho model mà qua `tool_call`/`tool_search` (133 tool sau bề mặt gọn). |
| 34 | Gateway làm gì khi model im lặng? | "LLM idle timeout (120s)": sau 120 s không có byte nào, Gateway huỷ request và thử lại cùng model (tới 8 lần), phát sự kiện mới. Vì vậy ngưỡng "lượt im lặng" của server phải nhỏ hơn 120 s: đặt 60 s (đo: thông báo `turn-quiet` sau 66 s, một lần, lượt vẫn dừng được bằng `chat.abort`). |
| 35 | Banner "Nobody is editing this project" có chặn đề xuất của agent? | **Không.** Khi không thiết bị nào giữ lease, staging và submit không cần lease; lúc Accept host tự lấy lease `agent:<sessionId>`, áp dụng, nhả lease, thiết bị nhận revision mới (đo trong trình duyệt: banner vẫn hiện, thẻ đề xuất chuyển Applied, timeline có text). |

Ghi chú tên tool: runtime nhúng của OpenClaw thấy tool là `jagentchill__jc_echo`; runtime CLI (Claude Code) thấy là
`mcp__jagentchill__jc_echo`. Spec gọi tool theo tên gốc `jc_*`; tiền tố do runtime thêm.

## Chưa chứng minh (spike còn mở)
- **S23 trên các runtime khác.** Cơ chế đã chọn (`server/src/agents/tool-binding.ts`): gateway báo mỗi lời gọi tool trên
  liên kết của server (event `agent`, `kind: "tool"`, có `sessionKey`); server gắn kết nối MCP với session có lời gọi
  khớp, và chỉ phục vụ lời gọi mà gateway đã báo. Model không tham gia quyết định. Mới chạy trên `claude-cli`; runtime
  nhúng, Codex, Gemini, ACP chưa thử. Hai session gọi lần đầu cùng một tool trong cùng khoảnh khắc → lời gọi trả lỗi
  "gọi lại" (nhánh `ambiguous`), chưa quan sát được trong lần chạy thật.
- Phê duyệt trên các runtime khác `claude-cli` (S21); loại `exec.approval.*` của runtime nhúng chưa quan sát được.
- Runtime API key với provider thật (mới chạy với stub cục bộ), OAuth hoàn tất bằng trình duyệt, Gemini CLI, Copilot.
- `@openclaw/gateway-client` hiện import theo đường dẫn từ cây gateway đã build; bản phân phối sẽ dùng gói npm ghim cùng
  phiên bản.
- Windows và Linux.

## Hệ quả
- `plugins/jagentchill-gateway/` và `scripts/gateway-plugin-build.sh` bị xoá; 0001 chỉ còn giá trị lịch sử.
- Thứ trước đây dựa vào plugin SDK chuyển sang server: tool agent → MCP; hook trước-khi-gọi-tool → kiểm quyền ngay tại
  endpoint tool của server (tool `jc_*`) và qua RPC phê duyệt của gateway (exec/tool gốc); run profile → server viết cấu
  hình gateway; provider tạo sinh bổ sung → chạy trong server.
- Đường dẫn `/jagentchill/v1/*` của kênh client giữ nguyên, nay do server phục vụ trên cổng của chính nó.
