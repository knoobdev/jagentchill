# JAgentChill — kế hoạch build

Cập nhật: 2026-10-05. File này là bản đọc được của kế hoạch. Chi tiết từng yêu cầu nằm trong
`openspec/changes/build-jagentchill/specs/`, danh sách việc đầy đủ nằm trong `openspec/changes/build-jagentchill/tasks.md`.

## 1. Sản phẩm là gì

Một app biên tập video dùng như CapCut, chạy ngang hàng trên web, desktop (macOS / Windows / Linux) và mobile
(iOS / Android), có agent AI làm việc cùng người dùng.

```
App (web / desktop / mobile)
   │  ghép cặp có ký
   ▼
JAgentChill Server (code của ta)  ──►  OpenClaw (bộ máy agent, chạy ngầm, nguyên bản)
```

- Biên tập video chạy ngay trên từng thiết bị, không cần server.
- Server cần cho: agent, AI tạo sinh, workflow, phim, đồng bộ giữa các thiết bị, xuất video từ xa.
- Chỉ có MỘT bản phát hành, đủ mọi chức năng. Không có bản MVP, không có "đợt sau".

## 2. Cấu trúc sản phẩm và thứ tự build

Sản phẩm có 4 khối. Một bản phát hành duy nhất gồm đủ cả 4. Thứ tự dưới đây là thứ tự làm.

### Khối 1 — Trình biên tập video (toàn bộ là chuẩn CapCut)

| Phần | Chức năng |
|---|---|
| Dự án | tạo, mở, đổi tên, nhân bản, xoá, thùng rác, thư mục, tìm kiếm, sắp xếp, ảnh bìa; khung hình (16:9, 9:16, 1:1, 4:5…), fps, nền màu / gradient / mờ / ảnh; nhập dự án OpenCut cũ; xuất / nhập gói dự án |
| Media | nhập video / ảnh / nhạc, kéo thả file, thumbnail, dạng sóng, thư mục, tìm kiếm, proxy, thay thế / nối lại file mất, kho nhạc và hiệu ứng âm thanh có sẵn |
| Timeline | nhiều track; track chính có nam châm; cắt, tách, trim, xoá ripple; bắt dính; chọn khung; nhóm; clip ghép; multi-camera; thay media; marker; nhiều scene; undo / redo; phát hiện chỗ cắt cảnh; cắt theo lời thoại |
| Xem trước | phát / dừng / tua, kéo-xoay-phóng trực tiếp trên khung hình, crop, lật, đường gióng, vùng an toàn, toàn màn hình |
| Chữ | chữ, tiêu đề, kiểu chữ, viền, bóng, nền, chữ cong, hiệu ứng chữ, hoạt ảnh vào / ra / lặp, mẫu chữ |
| Phụ đề | phụ đề tự động từ giọng nói, sửa theo bản lời, dịch, phụ đề song ngữ, kiểu karaoke, nhập / xuất SRT |
| Sticker và hình | sticker, emoji, hình khối, vẽ tay |
| Âm thanh | âm lượng, fade, tách tiếng khỏi video, khử ồn, đổi giọng, ducking, bắt nhịp nhạc, thu âm lồng tiếng, chuyển văn bản thành giọng |
| Hiệu ứng, bộ lọc, màu | hiệu ứng hình, bộ lọc, chỉnh màu (sáng, tương phản, HSL, đường cong, bánh xe màu), LUT, scope |
| Mask, hoà trộn, key | mask các dạng, chế độ hoà trộn, chroma key, tách nền |
| Chuyển động | keyframe mọi thông số, đồ thị đường cong, tốc độ thường và đường cong tốc độ, đảo ngược, đóng băng khung hình, chuyển cảnh |
| Template | dùng template, tạo template, thay nội dung theo ô |
| Tool AI trong editor | tách nền, khử ồn, tự cắt khoảng lặng, tự đổi khung hình theo chủ thể, nâng nét, ổn định hình |
| Xuất | độ phân giải, fps, codec, bitrate, chỉ xuất tiếng, GIF, ảnh bìa, hàng đợi xuất, chia sẻ |
| Engine | dựng hình thời gian thực, giải mã video, trộn tiếng, xuất file — dùng chung cho web, desktop, mobile |

Thứ tự làm bên trong khối: dự án → media → timeline + xem trước + engine → xuất → các phần còn lại. Lý do duy nhất của
thứ tự này là phụ thuộc kỹ thuật (không có timeline thì không có gì để gắn chữ, hiệu ứng, màu…).

### Khối 2 — Nền tảng

| Phần | Chức năng |
|---|---|
| App | web, desktop (macOS / Windows / Linux), mobile (iOS / Android, giao diện biên tập dọc như CapCut mobile); khung app, cài đặt, phím tắt, thông báo, đa ngôn ngữ (en, vi, ja), cập nhật |
| Kết nối thiết bị | ghép cặp có ký bằng QR / link + mã 6 số; vai admin / editor / viewer; thu hồi thiết bị; đồng bộ dự án và media; truy cập từ xa qua Tailscale; xuất video trên máy host |
| Bảo mật | khoá thiết bị, lưu bí mật, nhật ký, duyệt lệnh host |

### Khối 3 — Agent

| Phần | Chức năng |
|---|---|
| Chat agent | chat, đổi provider / model giữa chừng, chế độ Ask / Plan / Edit / Auto, đính kèm, rewind / fork, agent sửa video qua đề xuất có duyệt từng phần |
| Provider | ba cách ngang nhau: CLI đã cài, đăng nhập OAuth trực tiếp với hãng, API key; thêm OpenRouter và proxy kiểu 9router; mỗi vai một provider / model (cả vai ảnh, video, giọng) |
| Nhiều agent | đội vai cố định, agent tự do gọi nhau, bàn giao việc, theo dõi cả đội |
| Công cụ | skills, usage và chi phí (không có terminal và workspace — đã bỏ) |

### Khối 4 — Sản xuất bằng AI

| Phần | Chức năng |
|---|---|
| Tạo sinh | ảnh, video, giọng nói, nhạc, hiệu ứng âm thanh qua nhiều provider |
| Kịch bản | người soạn, agent soạn, chờ người duyệt hoặc agent tự duyệt |
| Workflow | vẽ sơ đồ kéo thả có hoạt ảnh, agent tự tạo workflow và tự nối các agent, chạy và theo dõi |
| Một prompt ra video | gõ một câu, ra video hoàn chỉnh, có điểm dừng để duyệt |
| Phim | truyện → nhân vật và bối cảnh → storyboard → cảnh quay → lồng tiếng → âm thanh → dựng |
| Tự động hoá | chạy theo lịch, theo sự kiện |

Thứ tự giữa các khối: Khối 1 trước (đó là sản phẩm), Khối 2 làm song song vì nằm ở tầng khác, rồi Khối 3, rồi Khối 4
(Khối 4 cần cả editor lẫn agent).

## 2b. Các phase

Một bản phát hành duy nhất ở cuối; phase là các chặng làm việc. Một phase kết thúc khi mọi chức năng của nó chạy được
thật, không còn nút chết, khớp file thiết kế, có test.

| Phase | Nội dung | Kết thúc khi | Trạng thái |
|---|---|---|---|
| 1. Nền editor | định dạng file dự án, kho lưu dự án, bộ thành phần giao diện, khung app (sidebar, thanh trên, cài đặt, phím tắt) | mở app thấy đúng khung như thiết kế, mọi mục điều hướng mở ra màn hình thật | đang làm |
| 2. Dự án + media | màn hình Projects đầy đủ; nhập video / ảnh / nhạc, thumbnail, dạng sóng, thư mục, proxy | tạo dự án, nhập file, thấy chúng trong thư viện | media: đang làm phần lõi |
| 3. Timeline + xem trước + engine | timeline nhiều track với mọi thao tác cắt ghép; xem trước đúng hình và tiếng; undo / redo | dựng được một video nhiều clip và phát xem trước mượt | engine: đã biên dịch, chưa vẽ khung hình |
| 4. Xuất video | xuất MP4 / GIF / chỉ tiếng theo độ phân giải, fps, codec; hàng đợi xuất | file xuất ra phát được, đúng với xem trước | chưa làm |
| 5. Chữ, phụ đề, sticker, âm thanh | toàn bộ phần chữ, phụ đề tự động, sticker và hình, xử lý âm thanh | làm được video có chữ, phụ đề, nhạc nền, lồng tiếng | chưa làm |
| 6. Hiệu ứng và chuyển động | hiệu ứng, bộ lọc, chỉnh màu, mask, chroma key, keyframe, tốc độ, chuyển cảnh, template, tool AI trong editor | mọi chức năng trong danh sách đối chiếu CapCut chạy trên web | chưa làm |
| 7. Desktop + mobile | app macOS / Windows / Linux; app iOS / Android với giao diện biên tập dọc | cùng một dự án mở và sửa được trên cả 3 loại thiết bị | chưa làm |
| 8. Kết nối thiết bị | ghép cặp đầy đủ, vai, thu hồi, đồng bộ dự án và media, Tailscale, xuất trên host, thông báo, bảo mật | sửa trên máy này, mở tiếp trên máy kia | có ghép cặp trên web |
| 9. Agent | chat đầy đủ, provider qua CLI / OAuth / API key / proxy, đổi model giữa chừng, chế độ, agent sửa video có duyệt, đội agent, skills, usage (workspace và terminal đã bỏ theo quyết định 2026-10-06) | bảo agent sửa video và nó sửa đúng, với bất kỳ provider nào trong ba cách | có chat cơ bản qua 1 provider |
| 10. Sản xuất bằng AI | tạo ảnh / video / giọng / nhạc, kịch bản có duyệt, workflow kéo thả, một prompt ra video, phim, tự động hoá | gõ một câu, ra video hoàn chỉnh; làm được một tập phim từ truyện | chưa làm |
| 11. Hoàn thiện | đa ngôn ngữ, trợ năng, cập nhật và phân phối, chạy thử toàn bộ trên mọi nền tảng | bản cài đặt cho cả 6 hệ điều hành | chưa làm |

Phase 1–6 làm theo thứ tự (cái sau cần cái trước). Phase 8 và 9 nằm ở phía server nên chạy song song được với 2–6.
Phase 10 cần cả 6 và 9. Phase 7 bắt đầu được từ khi Phase 3 có timeline.

## 3. Hiện trạng (2026-10-05)

Chạy được thật:
1. Server khởi động, tự bật và tự dọn OpenClaw.
2. Ghép cặp một trình duyệt với server bằng link + mã 6 số.
3. Chat với agent (qua Claude Code CLI đã cài trên máy), hiện các bước agent làm.
4. Duyệt / từ chối lệnh agent muốn chạy trên máy (mới chạy qua script).
5. Trang Devices: xem thiết bị, tạo QR / link ghép thiết bị mới.

Chưa có: toàn bộ phần biên tập video (mốc B–F), app mobile và desktop (G), đồng bộ và Tailscale (H), mọi thứ của
mốc I ngoài chat cơ bản, toàn bộ mốc J.

Đang làm: mốc A — định dạng file dự án + kho lưu dự án; bộ thành phần giao diện theo file thiết kế.

Số việc xong trong tasks.md: 0 / 391.

## 4. Cách kiểm tra "xong"

- Mỗi yêu cầu trong spec có các tình huống "KHI… THÌ…". Mỗi tình huống phải là một test tự động chạy đạt.
- Giao diện được chụp trên trình duyệt thật (rộng 1440 và 390, sáng và tối) rồi so với khung trong file thiết kế.
- Phần server được chạy thử thật với OpenClaw thật, không dùng dữ liệu giả.
- Không còn nút chết, màn hình trống, dữ liệu giả. Có nút thì nút phải chạy.
- Cuối mỗi mốc: đưa đúng các bước để bạn tự mở lên dùng thử. Bạn thấy thiếu gì thì nó thành việc mới.

## 5. Rủi ro thật

| Rủi ro | Vì sao | Cách xử lý |
|---|---|---|
| Engine dựng hình (mốc D, E) | Phần khó nhất: Rust/wasm + giải mã video, phải chạy được cả trên điện thoại; chưa có dòng code nào | Port từ OpenCut classic (đã chạy được trên web) thay vì viết mới; thử trên điện thoại thật sớm |
| Khối lượng | 2 225 yêu cầu; ước lượng 3–5 tuần chạy gần như liên tục với 2 coder, chưa có số đo thật | Đo lại sau 10 việc đầu; làm xương sống A–E trước để sớm có thứ dùng được |
| Chất lượng code do agent viết | Agent có thể viết cho test xanh mà dùng thật vẫn hỏng | Mỗi việc đều được chạy thử thật và so ảnh với thiết kế trước khi tính là xong; bạn dùng thử cuối mỗi mốc |
| Spec sai hoặc thiếu so với ý bạn | Spec do tôi viết từ nghiên cứu CapCut / OpenCut / JAgentDesk | Bạn dùng thử cuối mỗi mốc; thiếu gì thêm ngay |
| Mới chạy trên macOS + một provider | Windows, Linux, iOS, Android, API key, OAuth chưa chạy lần nào | Thuộc mốc G và I; cần máy thật và tài khoản (mục 6) |

## 6. Cần từ chủ dự án

- Tài khoản ký app Apple và Google (mốc G).
- Máy thật iOS và Android để chạy thử (mốc D trở đi).
- Key của các provider trả tiền muốn hỗ trợ (mốc I, J).
- Tài khoản Tailscale (mốc H).
