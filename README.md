# JAgentChill

JAgentChill là ứng dụng biên tập video kết hợp AI agent, gồm giao diện Expo/React Native cho web và mobile, ứng dụng desktop Electron và server Node.js quản lý project, phiên agent, media và render.

## Yêu cầu

- Node.js **>= 24.17.0**.
- pnpm **12.5.1** (theo `packageManager` trong `package.json`).
- Mobile native: Xcode cho iOS hoặc Android Studio/Android SDK cho Android.
- Các chức năng agent cần runtime/CLI tương ứng được cài đặt và đăng nhập trên máy host.

## Cài đặt

```sh
git clone https://github.com/knoobdev/jagentchill.git
cd jagentchill
pnpm install --frozen-lockfile
```

Repo có sẵn font, media mẫu, WASM và thư viện native iOS nên lần clone đầu tương đối lớn.

## Chạy desktop

Từ thư mục gốc, build giao diện trước khi mở Electron:

```sh
pnpm --filter @jagentchill/desktop build:web
pnpm --filter @jagentchill/desktop dev
```

Desktop có cơ chế quản lý server riêng. Cấu hình provider và kết nối host trong ứng dụng khi sử dụng các tính năng AI.

## Chạy web và server riêng

Mở hai terminal tại thư mục gốc:

```sh
# Terminal 1: cho phép origin của Expo web kết nối server
JAGENTCHILL_DEV_ALLOWED_ORIGINS=http://localhost:8081 pnpm server
```

```sh
# Terminal 2
pnpm --filter @jagentchill/app web
```

Server mặc định lắng nghe tại `127.0.0.1:18910`. Nếu Expo chọn cổng khác, chỉnh `JAGENTCHILL_DEV_ALLOWED_ORIGINS` cho khớp origin hiển thị trong terminal. Kết nối/pair thiết bị với host qua giao diện ứng dụng.

Các biến cấu hình thường dùng (truyền qua môi trường shell; không mặc định nạp `.env`):

| Biến | Ý nghĩa / mặc định |
| --- | --- |
| `JAGENTCHILL_PORT` | Cổng server, `18910` |
| `JAGENTCHILL_DATA_DIR` | Dữ liệu server, `.dev/server-data` |
| `JAGENTCHILL_DEV_ALLOWED_ORIGINS` | Các origin web được phép, phân cách bằng dấu phẩy |
| `JAGENTCHILL_WEB_DIR` | Thư mục web export để desktop tải |
| `JAGENTCHILL_ANDROID_PACKAGE` | Application ID cho native build Android |
| `JAGENTCHILL_IOS_BUNDLE_ID` | Bundle ID cho native build iOS |

Dữ liệu chạy local và secret do server tạo nằm trong data directory. Giữ các dữ liệu này ngoài Git.

## Mobile

```sh
pnpm --filter @jagentchill/app start
```

Project sử dụng native module riêng, cần development build phù hợp để sử dụng đầy đủ tính năng. Các lệnh `ios`/`android` trong package chỉ mở Expo dev server cho nền tảng tương ứng. Trước khi tạo native build, đặt application ID/bundle ID qua hai biến môi trường ở trên và chuẩn bị toolchain của nền tảng.

## Kiểm tra

```sh
# Toàn workspace
pnpm test

# Chạy riêng server hoặc desktop
pnpm --filter @jagentchill/server test
pnpm --filter @jagentchill/desktop test

# Kiểm tra design tokens và độ tương phản
pnpm jagentchill:check:tokens
pnpm jagentchill:check:contrast
```

## Cấu trúc repo

| Đường dẫn | Nội dung |
| --- | --- |
| `apps/app` | Giao diện Expo, router, editor, web/mobile |
| `apps/desktop` | Electron shell, preload, đóng gói và desktop E2E |
| `server` | HTTP/WebSocket server, agent runtime, provider, project và render host |
| `packages` | Protocol, client, app/editor core, render/WASM, storage, media và UI dùng chung |
| `skills` | Hướng dẫn chuyên môn cho các agent trong sản phẩm |
| `scripts` | Công cụ font, icon, LUT và phục vụ web build |
| `openspec` | Đặc tả và kế hoạch thay đổi |
| `docs` | Kế hoạch, quyết định kiến trúc, thiết kế và nghiên cứu |

## Tài liệu liên quan

- [Kế hoạch phát triển](docs/PLAN.md)
- [Quyết định kiến trúc](docs/decisions/)
- [Thiết kế](docs/design/)
- [Nguồn gốc tài nguyên](docs/product/ASSET-PROVENANCE.md)
- [Đặc tả sản phẩm](openspec/)

README mô tả các lệnh và cấu hình hiện có trong repo; việc cấu hình provider, ký ứng dụng và phát hành cần thiết lập riêng theo môi trường triển khai.
