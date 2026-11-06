# 0004 — Bỏ workspace và terminal

Ngày: 2026-10-06. Quyết định của chủ dự án: "Bỏ workspace với terminal".

Lý do: JAgentChill là trình biên tập video. Workspace (thư mục mã nguồn, cây file, git, diff) và terminal là công cụ của agent
viết code như JAgentDesk; ở đây "không gian làm việc" của agent là dự án video. Đây cũng là bề mặt rủi ro lớn nhất (chạy lệnh
trên host).

Hệ quả:
- Capability `workspaces-terminal` không được build; mục 5.6 trong `tasks.md` không còn việc.
- Không còn agent lớp "workspace": mọi session agent là lớp creative. Server tự từ chối mọi yêu cầu chạy lệnh host của agent
  (đã có, `server/src/agents/sessions.ts`); không có nơi nào trên giao diện để tạo session workspace, không có tab Terminal /
  Files trong màn hình session, không có cài đặt "Allow workspace agents for editors".
- Scope `jagentchill.host.exec` không còn chức năng nào dùng tới ngoài việc trả lời phê duyệt; các CLI runtime (Claude Code,
  Codex, OpenCode) vẫn tự có khả năng chạy lệnh nên lớp chặn ở server được giữ nguyên.
- Giữ lại: skills, usage.
- Việc dọn còn lại: gỡ các tham chiếu tới workspace / terminal trong các spec khác (chat-agent, agent-runtimes,
  multi-agent-orchestration, server-api, security-privacy, app-shell-navigation, keyboard-shortcuts…), trong `design.md` D22/D25,
  và trong code đã có (tuỳ chọn `agentClass: "workspace"` ở relay, thẻ phê duyệt cho session workspace, tab workspace của màn hình
  session).
