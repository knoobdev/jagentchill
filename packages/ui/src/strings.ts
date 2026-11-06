/** Strings the components themselves render or announce, in the three UI languages. Screens supply every other string. */
const en = {
  close: "Close", cancel: "Cancel", retry: "Retry", copy: "Copy", copied: "Copied", clear: "Clear", clearSearch: "Clear search",
  search: "Search", noResults: "No results", results_one: "{n} result", results_other: "{n} results",
  noResultsFor: "No results for “{query}”", loading: "Loading…", loadingMore: "Loading more…",
  optionsFailed: "Couldn’t load options", create: "Create “{query}”", remove: "Remove {name}", unavailable: "unavailable",
  requiresHostSuffix: "requires a host", requiresHost: "Requires a host", connectHost: "Connect a host",
  copyDetails: "Copy details", somethingWrong: "Something went wrong ({code})",
  showAllLines: "Show all {n} lines", wrap: "Wrap", language: "Plain text",
  today: "Today", yesterday: "Yesterday", last7: "Last 7 days", last30: "Last 30 days", thisMonth: "This month",
  lastMonth: "Last month", custom: "Custom", apply: "Apply", chooseAtMost: "Choose at most {n} days",
  previousMonth: "Previous month", nextMonth: "Next month", month: "Month", year: "Year", openCalendar: "Open calendar",
  everyDay: "Every day", weekdays: "Weekdays", weekends: "Weekends", am: "AM", pm: "PM",
  hours: "Hours", minutes: "Minutes", seconds: "Seconds", dayPeriod: "AM or PM",
  breadcrumb: "Breadcrumb", hiddenSegments: "Show hidden pages", back: "Back",
  qrCode: "QR code", qrTooLong: "This code is too long to show — use the link instead", expired: "Expired", newCode: "New code",
  selected: "{n} selected", selectAll: "Select all", selectRow: "Select row", rowActions: "Row actions", sortBy: "Sort by {name}",
  discardTitle: "Discard changes?", discardBody: "What you typed will be lost.", keepEditing: "Keep editing", discard: "Discard",
  typeToConfirm: "Type {word} to confirm", applicationMenu: "Application menu",
  undo: "Undo", restored: "Restored", undoFailed: "Couldn’t undo", dismiss: "Dismiss", repeated: "{message} ({n})",
  unread: "unread", unreadCount: "{n} unread", more: "More", moreActions: "More actions", expand: "Expand", collapse: "Collapse",
  send: "Send", stop: "Stop", attach: "Attach", dictate: "Dictate", sendOptions: "Send options", moreSettings: "More settings", runOptions: "Run options",
  message: "Message", viewAsTable: "View as table", viewAsChart: "View as chart", other: "Other", series: "Series",
  pickFromPreview: "Pick from preview", eyedropper: "Pick a colour from the screen", saved: "Saved", reset: "Reset",
  saveColor: "Save current colour", opacity: "Opacity", hue: "Hue", format: "Format", color: "Colour", recent: "Recent",
  newTab: "New tab", closeTab: "Close {name}", addFilter: "Add filter", is: "is", badgeNew: "New", badgeBuiltIn: "Built-in",
  edit: "Edit", save: "Save", nOfM: "{n} of {m}", resize: "Resize panels", mixed: "Mixed values",
  mediaOffline: "media offline", muted: "muted", hidden: "hidden", locked: "locked", trimAdjusted: "Trim adjusted",
  play: "Play", pause: "Pause", zoomIn: "Zoom in", zoomOut: "Zoom out", zoom: "Zoom", addTransition: "Add transition",
  hideTrack: "Hide track", lockTrack: "Lock track", muteTrack: "Mute track", marker: "{color} marker", playhead: "Playhead",
  markerBlue: "Blue", markerGreen: "Green", markerYellow: "Yellow", markerOrange: "Orange", markerRed: "Red",
  markerPurple: "Purple", markerPink: "Pink", markerGrey: "Grey",
  speed: "Speed {value}", linked: "Linked", keyframes: "Keyframes", effects: "Effects", fromScript: "From a script",
  fromWorkflow: "From a workflow", fromFilm: "From a film", progress: "Progress", percent: "{n}%", required: "Required",
  characters: "{n} / {max}", startDate: "Start date", endDate: "End date", menu: "Menu", rename: "Rename",
  blockedImage: "Image blocked", openLink: "Open link", toggleOn: "On", toggleOff: "Off",
  commandSourceGateway: "Gateway", commandSourceJAgentChill: "JAgentChill", commandSourceSkills: "Skills", commandSourceClaude: "Claude Code", commandSourceClaudePersonal: "Claude Code · personal", commandSourceClaudeProject: "Claude Code · project", commandSourceCodexPrompt: "Codex · prompt", commandSourceCodex: "Codex", commandSourceProject: "Project", commandSourcePersonal: "Personal", commandSourceSkill: "Skill", commandSourceRuntime: "Runtime",
  commandsTitle: "Commands", commandKeys: "↑↓ to move · ↵ to run · Tab to complete · Esc to close",
  "Loading commands for {model}": "Loading commands for {model}", "No commands for {model}": "No commands for {model}",
} as const;

export type StringKey = keyof typeof en;
type Table = Record<StringKey, string>;

const vi: Table = {
  close: "Đóng", cancel: "Huỷ", retry: "Thử lại", copy: "Sao chép", copied: "Đã sao chép", clear: "Xoá", clearSearch: "Xoá tìm kiếm",
  search: "Tìm kiếm", noResults: "Không có kết quả", results_one: "{n} kết quả", results_other: "{n} kết quả",
  noResultsFor: "Không có kết quả cho “{query}”", loading: "Đang tải…", loadingMore: "Đang tải thêm…",
  optionsFailed: "Không tải được lựa chọn", create: "Tạo “{query}”", remove: "Gỡ {name}", unavailable: "không khả dụng",
  requiresHostSuffix: "cần có host", requiresHost: "Cần có host", connectHost: "Kết nối host",
  copyDetails: "Sao chép chi tiết", somethingWrong: "Đã xảy ra lỗi ({code})",
  showAllLines: "Hiện tất cả {n} dòng", wrap: "Xuống dòng", language: "Văn bản thuần",
  today: "Hôm nay", yesterday: "Hôm qua", last7: "7 ngày qua", last30: "30 ngày qua", thisMonth: "Tháng này",
  lastMonth: "Tháng trước", custom: "Tuỳ chỉnh", apply: "Áp dụng", chooseAtMost: "Chọn tối đa {n} ngày",
  previousMonth: "Tháng trước", nextMonth: "Tháng sau", month: "Tháng", year: "Năm", openCalendar: "Mở lịch",
  everyDay: "Mỗi ngày", weekdays: "Ngày thường", weekends: "Cuối tuần", am: "SA", pm: "CH",
  hours: "Giờ", minutes: "Phút", seconds: "Giây", dayPeriod: "Sáng hoặc chiều",
  breadcrumb: "Đường dẫn", hiddenSegments: "Hiện các trang bị ẩn", back: "Quay lại",
  qrCode: "Mã QR", qrTooLong: "Mã này quá dài để hiển thị — hãy dùng liên kết", expired: "Đã hết hạn", newCode: "Mã mới",
  selected: "Đã chọn {n}", selectAll: "Chọn tất cả", selectRow: "Chọn hàng", rowActions: "Thao tác với hàng", sortBy: "Sắp xếp theo {name}",
  discardTitle: "Bỏ thay đổi?", discardBody: "Nội dung bạn đã nhập sẽ bị mất.", keepEditing: "Tiếp tục sửa", discard: "Bỏ",
  typeToConfirm: "Nhập {word} để xác nhận", applicationMenu: "Trình đơn ứng dụng",
  undo: "Hoàn tác", restored: "Đã khôi phục", undoFailed: "Không hoàn tác được", dismiss: "Bỏ qua", repeated: "{message} ({n})",
  unread: "chưa đọc", unreadCount: "{n} chưa đọc", more: "Thêm", moreActions: "Thao tác khác", expand: "Mở rộng", collapse: "Thu gọn",
  send: "Gửi", stop: "Dừng", attach: "Đính kèm", dictate: "Đọc chính tả", sendOptions: "Tuỳ chọn gửi", moreSettings: "Cài đặt khác", runOptions: "Tuỳ chọn chạy",
  message: "Tin nhắn", viewAsTable: "Xem dạng bảng", viewAsChart: "Xem dạng biểu đồ", other: "Khác", series: "Chuỗi",
  pickFromPreview: "Chọn từ bản xem trước", eyedropper: "Chọn màu từ màn hình", saved: "Đã lưu", reset: "Đặt lại",
  saveColor: "Lưu màu hiện tại", opacity: "Độ mờ", hue: "Sắc độ", format: "Định dạng", color: "Màu", recent: "Gần đây",
  newTab: "Thẻ mới", closeTab: "Đóng {name}", addFilter: "Thêm bộ lọc", is: "là", badgeNew: "Mới", badgeBuiltIn: "Có sẵn",
  edit: "Sửa", save: "Lưu", nOfM: "{n} trên {m}", resize: "Đổi kích thước bảng", mixed: "Giá trị khác nhau",
  mediaOffline: "mất tệp nguồn", muted: "đã tắt tiếng", hidden: "đã ẩn", locked: "đã khoá", trimAdjusted: "Đã chỉnh điểm cắt",
  play: "Phát", pause: "Tạm dừng", zoomIn: "Phóng to", zoomOut: "Thu nhỏ", zoom: "Thu phóng", addTransition: "Thêm chuyển cảnh",
  hideTrack: "Ẩn track", lockTrack: "Khoá track", muteTrack: "Tắt tiếng track", marker: "Điểm đánh dấu {color}", playhead: "Đầu phát",
  markerBlue: "Xanh dương", markerGreen: "Xanh lá", markerYellow: "Vàng", markerOrange: "Cam", markerRed: "Đỏ",
  markerPurple: "Tím", markerPink: "Hồng", markerGrey: "Xám",
  speed: "Tốc độ {value}", linked: "Đã liên kết", keyframes: "Keyframe", effects: "Hiệu ứng", fromScript: "Từ kịch bản",
  fromWorkflow: "Từ workflow", fromFilm: "Từ phim", progress: "Tiến độ", percent: "{n}%", required: "Bắt buộc",
  characters: "{n} / {max}", startDate: "Ngày bắt đầu", endDate: "Ngày kết thúc", menu: "Trình đơn", rename: "Đổi tên",
  blockedImage: "Hình ảnh bị chặn", openLink: "Mở liên kết", toggleOn: "Bật", toggleOff: "Tắt",
  commandSourceGateway: "Gateway", commandSourceJAgentChill: "JAgentChill", commandSourceSkills: "Kỹ năng", commandSourceClaude: "Claude Code", commandSourceClaudePersonal: "Claude Code · cá nhân", commandSourceClaudeProject: "Claude Code · dự án", commandSourceCodexPrompt: "Codex · prompt", commandSourceCodex: "Codex", commandSourceProject: "Dự án", commandSourcePersonal: "Cá nhân", commandSourceSkill: "Kỹ năng", commandSourceRuntime: "Runtime",
  commandsTitle: "Lệnh", commandKeys: "↑↓ di chuyển · ↵ chạy · Tab hoàn tất · Esc đóng",
  "Loading commands for {model}": "Đang tải command cho {model}", "No commands for {model}": "Không có command cho {model}",
};

const ja: Table = {
  close: "閉じる", cancel: "キャンセル", retry: "再試行", copy: "コピー", copied: "コピーしました", clear: "クリア", clearSearch: "検索をクリア",
  search: "検索", noResults: "結果がありません", results_one: "{n} 件", results_other: "{n} 件",
  noResultsFor: "「{query}」の結果はありません", loading: "読み込み中…", loadingMore: "さらに読み込み中…",
  optionsFailed: "選択肢を読み込めませんでした", create: "「{query}」を作成", remove: "{name} を削除", unavailable: "利用できません",
  requiresHostSuffix: "ホストが必要", requiresHost: "ホストが必要です", connectHost: "ホストに接続",
  copyDetails: "詳細をコピー", somethingWrong: "問題が発生しました（{code}）",
  showAllLines: "全 {n} 行を表示", wrap: "折り返す", language: "プレーンテキスト",
  today: "今日", yesterday: "昨日", last7: "過去 7 日間", last30: "過去 30 日間", thisMonth: "今月",
  lastMonth: "先月", custom: "カスタム", apply: "適用", chooseAtMost: "{n} 日以内で選択してください",
  previousMonth: "前の月", nextMonth: "次の月", month: "月", year: "年", openCalendar: "カレンダーを開く",
  everyDay: "毎日", weekdays: "平日", weekends: "週末", am: "午前", pm: "午後",
  hours: "時", minutes: "分", seconds: "秒", dayPeriod: "午前または午後",
  breadcrumb: "パンくずリスト", hiddenSegments: "非表示のページを表示", back: "戻る",
  qrCode: "QR コード", qrTooLong: "このコードは長すぎて表示できません。リンクを使用してください", expired: "期限切れ", newCode: "新しいコード",
  selected: "{n} 件選択中", selectAll: "すべて選択", selectRow: "行を選択", rowActions: "行の操作", sortBy: "{name} で並べ替え",
  discardTitle: "変更を破棄しますか？", discardBody: "入力した内容は失われます。", keepEditing: "編集を続ける", discard: "破棄",
  typeToConfirm: "確認のため {word} と入力", applicationMenu: "アプリケーションメニュー",
  undo: "元に戻す", restored: "復元しました", undoFailed: "元に戻せませんでした", dismiss: "閉じる", repeated: "{message}（{n}）",
  unread: "未読", unreadCount: "未読 {n} 件", more: "その他", moreActions: "その他の操作", expand: "展開", collapse: "折りたたむ",
  send: "送信", stop: "停止", attach: "添付", dictate: "音声入力", sendOptions: "送信オプション", moreSettings: "その他の設定", runOptions: "実行オプション",
  message: "メッセージ", viewAsTable: "表で表示", viewAsChart: "グラフで表示", other: "その他", series: "系列",
  pickFromPreview: "プレビューから選択", eyedropper: "画面から色を選択", saved: "保存済み", reset: "リセット",
  saveColor: "現在の色を保存", opacity: "不透明度", hue: "色相", format: "形式", color: "色", recent: "最近",
  newTab: "新しいタブ", closeTab: "{name} を閉じる", addFilter: "フィルターを追加", is: "が", badgeNew: "新規", badgeBuiltIn: "内蔵",
  edit: "編集", save: "保存", nOfM: "{n} / {m}", resize: "パネルのサイズ変更", mixed: "複数の値",
  mediaOffline: "メディアがオフライン", muted: "ミュート中", hidden: "非表示", locked: "ロック中", trimAdjusted: "トリムを調整しました",
  play: "再生", pause: "一時停止", zoomIn: "拡大", zoomOut: "縮小", zoom: "ズーム", addTransition: "トランジションを追加",
  hideTrack: "トラックを非表示", lockTrack: "トラックをロック", muteTrack: "トラックをミュート", marker: "{color}のマーカー", playhead: "再生ヘッド",
  markerBlue: "青", markerGreen: "緑", markerYellow: "黄", markerOrange: "オレンジ", markerRed: "赤",
  markerPurple: "紫", markerPink: "ピンク", markerGrey: "グレー",
  speed: "速度 {value}", linked: "リンク済み", keyframes: "キーフレーム", effects: "エフェクト", fromScript: "台本から",
  fromWorkflow: "ワークフローから", fromFilm: "フィルムから", progress: "進行状況", percent: "{n}%", required: "必須",
  characters: "{n} / {max}", startDate: "開始日", endDate: "終了日", menu: "メニュー", rename: "名前を変更",
  blockedImage: "画像はブロックされました", openLink: "リンクを開く", toggleOn: "オン", toggleOff: "オフ",
  commandSourceGateway: "Gateway", commandSourceJAgentChill: "JAgentChill", commandSourceSkills: "スキル", commandSourceClaude: "Claude Code", commandSourceClaudePersonal: "Claude Code · 個人", commandSourceClaudeProject: "Claude Code · プロジェクト", commandSourceCodexPrompt: "Codex · prompt", commandSourceCodex: "Codex", commandSourceProject: "プロジェクト", commandSourcePersonal: "個人", commandSourceSkill: "スキル", commandSourceRuntime: "ランタイム",
  commandsTitle: "コマンド", commandKeys: "↑↓ 移動 · ↵ 実行 · Tab 補完 · Esc 閉じる",
  "Loading commands for {model}": "{model} のコマンドを読み込み中", "No commands for {model}": "{model} のコマンドはありません",
};

export const STRINGS: Record<"en" | "vi" | "ja", Table> = { en, vi, ja };
export type UiLanguage = keyof typeof STRINGS;

export function languageOf(locale: string): UiLanguage {
  const code = locale.toLowerCase().slice(0, 2);
  return code === "vi" || code === "ja" ? code : "en";
}

export type Translate = (key: StringKey, values?: Record<string, string | number>) => string;

/** A translator for a locale. `{n}` and other placeholders are replaced by the given values. */
export function translator(locale: string): Translate {
  const table = STRINGS[languageOf(locale)];
  return (key, values) => (values ? table[key].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? "")) : table[key]);
}

/** "12 results", "1 result", "No results". */
export function resultCount(t: Translate, count: number): string {
  return count === 0 ? t("noResults") : t(count === 1 ? "results_one" : "results_other", { n: count });
}
