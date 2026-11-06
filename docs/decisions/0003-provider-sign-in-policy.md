# 0003 — Đăng nhập provider: do chính sản phẩm thực hiện, qua luồng chính thức của hãng

Ngày: 2026-10-06. Lý do: chủ dự án lưu ý rằng đăng nhập OAuth qua một app bên thứ ba có thể làm khoá tài khoản ở một số
hãng (ví dụ Claude). Đã tra tài liệu chính thức của hãng và tài liệu OpenClaw đang ghim.

| Hãng | Kiểu đăng nhập | Trong JAgentChill | Căn cứ |
|---|---|---|---|
| Anthropic | Token gói Claude (setup-token / OAuth claude.ai) dùng trực tiếp bởi app khác | **Đóng** — không hiện để bấm, server từ chối | Claude Code "Legal and compliance": hãng không cho bên thứ ba đưa đăng nhập Claude.ai vào app của mình hay chuyển request qua thông tin gói Free/Pro/Max; không được thu, lưu, trung chuyển token. Tháng 4/2026 hãng đã thu hồi đăng nhập gói với mọi công cụ bên thứ ba và có tài khoản bị khoá. |
| Anthropic | Claude Code CLI do người dùng tự cài và tự đăng nhập, app chỉ khởi chạy bản nguyên gốc | Mở | Cùng trang: không cấm người dùng đăng nhập bản Claude Code không sửa đổi bằng gói của chính họ. |
| Anthropic | API key từ Claude Console | Mở | Cùng trang: nhà phát triển dùng API key. |
| OpenAI | "Sign in with ChatGPT" (Codex OAuth, device code) | Mở | OpenAI hỗ trợ dùng đăng nhập gói trong công cụ bên thứ ba. |
| OpenRouter | OAuth PKCE, API key | Mở | Luồng OAuth chính thức cho app bên thứ ba, trả về API key. |
| Google | Đăng nhập Gemini CLI / Antigravity trong app khác | **Đóng** (OpenClaw đang ghim cũng không còn đưa ra) | Điều khoản Google cấm; chỉ dùng API key. |

Hiện thực: `server/src/providers/sign-in-policy.ts` (test `server/test/sign-in-policy.test.ts`). Lựa chọn bị đóng vẫn hiện trong
danh sách với lý do, không bấm được; `provider.auth.login.start` từ chối với `UNSUPPORTED_FEATURE`, `details.reason: "provider-terms"`.

Chưa tra: điều khoản của GitHub Copilot (device code), MiniMax, Qwen với app bên thứ ba. Chính sách của Anthropic đã đổi
ba lần trong năm 2026 (tháng 2, tháng 4, tháng 5–6) nên cần tra lại trước mỗi bản phát hành.

Nguồn: https://code.claude.com/docs/en/legal-and-compliance ; https://www.theregister.com/software/2026/02/20/anthropic-clarifies-ban-on-third-party-tool-access-to-claude/5014546 ;
https://www.betterclaw.io/blog/openclaw-anthropic-subscription-ban ; https://thenewstack.io/sign-in-with-chatgpt/ ; `gateway/openclaw/docs/providers/{anthropic,openai,google,openrouter}.md`.

## Sửa theo chỉ đạo của chủ dự án (2026-10-06)

Không "chặn" đăng nhập. Yêu cầu: đăng nhập phải do chính sản phẩm thực hiện (như JAgentDesk: provider là CLI chính thức của
hãng, người dùng đăng nhập bằng CLI đó), KHÔNG mượn danh OpenClaw làm app OAuth. Giải pháp:

| Hãng | Cách đăng nhập trong app | Danh tính hãng nhìn thấy |
|---|---|---|
| Anthropic (gói Claude) | App bấm "Sign in" → server chạy `claude auth login` của Claude Code đã cài (bản nguyên gốc), chuyển URL / mã về thiết bị admin, người dùng đăng nhập trên trang của Anthropic; token nằm trong kho của Claude Code, sản phẩm không đọc, không lưu | Claude Code (chính chủ) |
| Anthropic (Console) | `claude auth login --console`, hoặc nhập API key | Claude Code / API key |
| OpenAI (gói ChatGPT) | Server chạy `codex login` của Codex CLI đã cài, chuyển URL về thiết bị | Codex CLI (chính chủ) |
| OpenRouter | OAuth PKCE do chính server JAgentChill thực hiện (callback về server của ta), hoặc API key | JAgentChill |

Các luồng OAuth do OpenClaw tự thực hiện (`openai` OAuth của OpenClaw, `openrouter-oauth` của OpenClaw, `setup-token` Anthropic
dùng trực tiếp bởi OpenClaw) không được dùng làm đường đăng nhập của sản phẩm.

## Bản chốt (2026-10-06, thay cho bảng "Sửa theo chỉ đạo" ở trên)

Ba cách dùng một provider, tách bạch: **(A) CLI của hãng cài trên host**, **(B) OAuth trực tiếp với hãng dưới danh tính
của JAgentChill**, **(C) API key**. Không có lựa chọn nào ghi "bị chặn"; luồng do OpenClaw tự đăng nhập không được đưa ra
và mang tên lựa chọn thay thế (`replacedChoices`, `login.start` trả `UNSUPPORTED_FEATURE` + `details.replacedBy`).

| Hãng | (A) CLI | (B) OAuth dưới danh tính JAgentChill | (C) API key |
|---|---|---|---|
| Anthropic | `claude-code` — "Claude Code on this host": server chạy `claude auth login --claudeai` của bản Claude Code nguyên gốc, chuyển URL về thiết bị admin, nhận mã dán lại rồi ghi vào stdin của CLI; token nằm trong kho của Claude Code | **Không có** — Anthropic không cấp OAuth cho app bên thứ ba (chủ dự án chốt: Anthropic chỉ CLI và API key) | `apiKey` |
| OpenAI | `codex-cli` (`codex login --device-auth`: URL + mã một lần), `codex-cli-browser` (`codex login`: callback 127.0.0.1:1455 trên host) | `chatgpt-sign-in` — "Continue with ChatGPT": Sign in with ChatGPT, nhánh "ChatGPT plan usage for open-source and locally hosted apps", đăng ký client động theo từng người dùng | `openai-api-key` |
| OpenRouter | — | `openrouter-sign-in`: PKCE do server thực hiện, callback về server | `openrouter-api-key` |

### Căn cứ đã tra
- **Anthropic** (https://code.claude.com/docs/en/legal-and-compliance, mục "Authentication and credential use"): "Anthropic
  does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through
  Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate
  Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow."; và "Nor
  does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription".
  Mục "Can customers offer Claude Code in their products?": binary không được sửa, không được gỡ / hạn chế cách đăng nhập
  nào của nó, mỗi người dùng tự đăng nhập bằng thông tin của chính họ. → (A) đúng điều khoản: server chỉ khởi chạy
  `claude auth login` và chuyển tiếp thứ CLI in ra; sản phẩm không dùng client id của Claude Code, không đọc / lưu token.
- **OpenAI SIWC** (https://developers.openai.com/siwc/ ; `/siwc/request-client-id` ; `/siwc/token-sharing-open-source` ;
  `…/sign-in` ; `…/models-and-inference` ; `…/token-reference` ; `…/codex-app-server` ; `…/preview-limitations` ;
  `/siwc/ui-ux-guidelines`): nhánh website / client id cố định "is currently offered to a select group of commercial
  partners" (form https://openai.com/form/sign-in-with-chatgpt-interest/ — app trả phí hoặc host từ xa). Nhánh app chạy cục
  bộ dùng đăng ký động: authorize `https://auth.openai.com/api/accounts/authorize` với `client_id=dynamic_agent_client`,
  `agent_name_hint` (tên app, chỉ gửi lần đăng ký đầu), `ext_agent_host_id` (id của host, lưu lại), `resource=https://api.openai.com/v1`,
  scope `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`, PKCE S256, `state`, `nonce`;
  callback bắt buộc `http://127.0.0.1:<cổng>/auth/callback` (chỉ cổng được đổi, không dùng `localhost`) và trả kèm `client_id`
  được cấp (`oaiapp_…`, gắn với người dùng + workspace); đổi mã ở `https://auth.openai.com/api/accounts/oauth/token` (form,
  không client secret); kiểm ID token bằng JWKS; access token sống 1 giờ, refresh token 30 ngày; gọi
  `https://api.openai.com/v1/responses` với Bearer token (`store:false`, `stream:true`, nhiều tham số phải bỏ). Trang tài
  liệu không nêu điều kiện phê duyệt trước cho nhánh này; điều kiện "open-source / locally hosted" do chủ dự án tự đối
  chiếu. Hướng dẫn UI: nút "Continue with ChatGPT".
- **OpenRouter** (https://openrouter.ai/docs/use-cases/oauth-pkce): `https://openrouter.ai/auth?callback_url=…&code_challenge=…&code_challenge_method=S256&state=…`;
  "Localhost callbacks are supported on any port"; production dùng URL công khai; bỏ `callback_url` thì trang hiện mã để
  dán (bắt buộc có `code_challenge`); đổi mã ở `POST https://openrouter.ai/api/v1/auth/keys {code, code_verifier, code_challenge_method}` → `{key}`.

### OpenClaw (Gateway đang ghim) trình danh tính gì khi tự đăng nhập
| Luồng của Gateway | Danh tính | Đổi sang danh tính của ta được không |
|---|---|---|
| OpenAI `openai` / `openai-device-code` (Codex OAuth) | client id của Codex CLI `app_EMoamEEZ73f0CkXaXp7hrann`, `originator=openclaw` (`extensions/openai/openai-chatgpt-oauth-*.runtime.ts`) | Không — viết cứng |
| OpenAI `openai-token-sharing` (SIWC) | `agent_name_hint: "OpenClaw"`, callback `localhost:8080` (`extensions/openai/token-sharing-oauth.runtime.ts`) | Không — viết cứng; không có RPC nhận token do ta lấy |
| Codex harness (app-server) | `clientInfo {name: "openclaw", title: "OpenClaw"}` (`extensions/codex/src/app-server/client-initialize.ts`) | Không — viết cứng |
| OpenRouter `openrouter-oauth` | app OpenClaw (request kèm `HTTP-Referer: https://openclaw.ai`) | Không |
| GitHub Copilot device code | client id `Iv1.b507a08c87ecfe98` viết cứng | Không |
| MiniMax portal OAuth | client id viết cứng `78257093-…` | Không |
| xAI OAuth / device code | client id viết cứng `b1a00492-…` | Không |
| Chutes OAuth | `CHUTES_CLIENT_ID` (biến môi trường) | Có — đặt client id của ta |
| Microsoft Foundry (Entra) | `az login` của Azure CLI trên host | Là CLI của hãng |
Qwen ở bản ghim chỉ có API key. Các luồng Copilot / MiniMax / xAI / Chutes / Radius vẫn được liệt kê như trước, kèm
`identity: "The agent engine (OpenClaw)"` để UI nói rõ ai đang đăng nhập; chưa tra điều khoản của các hãng đó.

### Token ChatGPT plan tới model bằng đường nào
Gateway không nhận token / originator của ta cho các luồng của nó. Đường đã làm: server tự đăng nhập SIWC, giữ access /
refresh token trong `secrets/host-secrets.json` (0600), tự làm mới, và chiếu thành provider tuỳ biến `chatgpt-plan`
(`api: openai-responses`, `baseUrl: https://api.openai.com/v1`, `apiKey` là SecretRef file) với danh sách model lấy từ
`GET /v1/models` của tài khoản. **Chưa chứng minh bằng lượt thật**: runtime nhúng của Gateway có gửi tham số mà bản preview
từ chối hay không (`temperature`, `max_output_tokens`, system message…). Nếu có, đường thay thế là server tự chạy
`codex app-server` với `ACCESS_TOKEN` và `clientInfo {name: "jagentchill", title: "JAgentChill"}` như một runtime riêng.

### Kết nối key không tốn tiền
Lần chạy thật 11:53 ngày 2026-10-06 cho thấy `models.probe` của Gateway tự chọn model để thử key và đã chọn một model trả
phí của OpenRouter (`~anthropic/claude-fable-latest`). Từ nay key OpenRouter được kiểm bằng `GET https://openrouter.ai/api/v1/key`
(không sinh nội dung) cả khi kết nối lẫn khi bấm "Test"; `models.probe` không còn được gọi cho OpenRouter. Provider khác
giữ probe của Gateway. Lượt chat chạy đúng model của session: Gateway coi model đặt trên session là lựa chọn chính xác
(`docs/concepts/model-failover.md`: "Explicit user session selections are strict"), và server kiểm lại trước mỗi lượt.

### Không model nào thành mặc định khi provider sẵn sàng; không sinh nội dung nền (2026-10-06, bổ sung)
Người dùng chọn model. Server không tự đặt model mặc định và không để Gateway tự chọn:
- ORC không còn tự ghi profile mặc định: `orc.config.get` trả `suggested` (gợi ý theo role), chỉ `orc.config.update` từ thiết
  bị admin mới áp dụng. Profile `source: "auto"` do bản cũ tự ghi bị gỡ một lần lúc khởi động (audit `orc.defaults.cleared`).
  **Khác spec**: `orc-model-routing` (scenario "Default profiles from the enabled catalogue") yêu cầu tự đặt — chỉ đạo của chủ dự án thắng.
- `session.create` không có `ref` khi chưa có route: `NO_ROUTE` "Choose a model", không gọi Gateway.
- Gateway không có model mặc định thì tự lấy model của provider đã kết nối (`docs/gateway/config-agents/models.md`: "implicit
  fallback to a configured provider"). Vì vậy khi Director chưa có route, `agents.defaults.model.primary` được ghim là
  `jagentchill-unset/choose-a-model` (không thuộc provider nào): mọi thứ chạy "bằng model mặc định" sẽ lỗi thay vì tốn tiền.

Run profile `server/src/gateway/run-profile.ts`, ghi vào `openclaw.json` trước khi Gateway khởi động và được projection giữ
nguyên (đã chạy thật trên Gateway ghim, `.dev/run-si-bg`, `.dev/run-si-stub`):

| Khoá cấu hình | Tắt cái gì | Căn cứ |
|---|---|---|
| `agents.defaults.heartbeat.every: "0m"` | Lượt heartbeat trên main session mỗi 30 phút (1 giờ nếu có đăng nhập Claude) | `docs/gateway/heartbeat.md`; log `[heartbeat] disabled` |
| `tools.exec.notifyOnExit: false` | Lượt agent tự phát khi một lệnh nền kết thúc (event wake vẫn chạy dù heartbeat `0m`) | `docs/gateway/heartbeat.md`, `docs/gateway/background-process.md` |
| `agents.defaults.utilityModel: ""` | Recap phiên tự viết sau mỗi lượt, progress narration, tiêu đề tự sinh — vốn chạy bằng model "nhỏ" do Gateway tự suy ra từ provider | `docs/gateway/config-agents/models.md`; `src/gateway/session-activity-summaries.ts` (`admit` trả rỗng khi utility model bị tắt) |
| `cron.enabled: false` | Bộ lập lịch: heartbeat định kỳ, dreaming, "skill collection reviews" (skill-workshop). Đổi khoá này Gateway phải khởi động lại, nên ghi sẵn trong file | log `[skill-workshop] scheduled skill collection reviews are disabled…` |
| `plugins.entries.memory-core.config.dreaming.enabled: false` | Dreaming hằng đêm (viết Dream Diary bằng một completion trên model mặc định) | `docs/concepts/dreaming.md`; không còn `created managed dreaming cron job` |
| `memory.search.provider: "none"` | Embedding để index memory bằng provider có key (mặc định OpenAI) — không phải sinh nội dung nhưng tốn tiền trên model không ai chọn; còn tìm theo từ khoá | `docs/concepts/memory-search.md` |

Không tắt được bằng cấu hình / chưa xử lý: (1) những lời gọi nằm TRONG một lượt của người dùng và dùng đúng model của
session — compaction, memory flush trước compaction, Active Memory (kế thừa model của session), sub-agent; (2) tool của
runtime nhúng có thể gọi model khác trong lượt (`image`/`pdf` → `imageModel`, `mediaModels` tự suy ra provider có key) —
chưa rà chính sách tool; (3) `sessions.title.prepare` chỉ chạy khi client gọi, server không gọi. Automations của sản phẩm
sau này cần bật lại `cron` và tự chỉ định model.

Kiểm bằng log: Gateway chỉ ghi `[model-fetch]` cho request chậm (≥ ngưỡng) hoặc lỗi; đặt `OPENCLAW_DEBUG_MODEL_TRANSPORT=1`
cho tiến trình server thì MỌI request tới model đều có dòng `[model-fetch] start … model=… url=…` (không kèm key).
`server/scripts/live-openrouter.ts` yêu cầu biến này và fail nếu có request nào không phải model nó đã yêu cầu.
