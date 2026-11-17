# Đếm Hít Đất: hướng dẫn cài lên iPhone

App chạy hoàn toàn trên điện thoại: camera và video **không gửi đi đâu**. Lần đầu mở app cần có mạng để tải mô hình AI (khoảng 15 MB). Từ lần sau, app dùng được cả khi offline.

## 1. Đưa lên GitHub Pages (miễn phí, làm trên máy tính)

1. Đăng nhập (hoặc tạo tài khoản) tại https://github.com
2. Bấm **New repository**, đặt tên ví dụ `pushup`, chọn **Public**, rồi bấm **Create repository**.
3. Trong repo mới, bấm **uploading an existing file**.
4. Giải nén file zip, rồi **kéo toàn bộ nội dung bên trong** (gồm `index.html`, `app.js`, `counter.js`, `sw.js`, `manifest.webmanifest`, thư mục `vendor`, thư mục `icons`) vào trang upload. Bấm **Commit changes**.
   - Chú ý kéo *các file bên trong*, đừng kéo cả thư mục cha. `index.html` phải nằm ngay ở gốc repo.
5. Vào **Settings → Pages**. Ở mục *Build and deployment*, chọn Source = **Deploy from a branch**, Branch = **main**, thư mục **/ (root)**, rồi bấm **Save**.
6. Đợi 1–2 phút. Link app sẽ là: `https://<tên-github-của-bạn>.github.io/pushup/`

## 2. Cài lên iPhone

1. Mở link trên bằng **Safari** (bắt buộc dùng Safari).
2. Đợi dòng "Bấm Bắt đầu…" hiện ra (lúc này mô hình đã tải xong), bấm **Bắt đầu** và cho phép dùng camera.
3. Bấm nút **Chia sẻ**, chọn **Thêm vào MH chính** (Add to Home Screen).
4. Từ giờ mở app bằng icon trên màn hình chính.
   Mẹo: mở chế độ *Phân tích video* một lần khi còn mạng để app tải sẵn mô hình cho video.

## 3. Cách quay để đếm chính xác

| Góc quay | Đặt máy | Cách app đếm |
|---|---|---|
| **Ngang người** | Đặt máy dưới sàn, cách 1,5–2 m, thấy rõ vai, khuỷu tay, cổ tay và hông | Góc khuỷu tay: xuống ≤ 100°, lên ≥ 150° thì tính 1 rep. Nếu xuống chưa tới 100° rồi lên lại, app đếm là **rep chưa đủ sâu** |
| **Trước mặt** | Đặt máy dưới sàn phía trước đầu, cách khoảng 1,5 m, thấy rõ 2 vai và 2 cổ tay | Đo độ hạ của vai so với cổ tay, tự điều chỉnh theo biên độ của bạn |

- Nên để chế độ **Tự động**. App tự nhận ra bạn đang quay ngang hay quay trước mặt. Nếu app nhận sai, hãy chọn tay.
- Lên/xuống bình thường. Rep nhanh hơn 0,35 giây sẽ bị bỏ qua vì coi là nhiễu.
- Tay màu **xanh lá** nghĩa là đang ở tư thế lên, **xanh dương** nghĩa là đang xuống.

## 4. Chỉnh ngưỡng (nếu thấy đếm thiếu hoặc thừa)

Mở `counter.js` và sửa các số trong `DEFAULTS`:

- `sideDownAngle` (mặc định 100): tăng lên (ví dụ 110) nếu app hay bỏ sót rep khi quay ngang.
- `sideUpAngle` (mặc định 150): giảm xuống (ví dụ 140) nếu bạn không duỗi thẳng tay hẳn.
- `frontMinRange` (mặc định 0,45): giảm xuống nếu app bỏ sót rep khi quay trước mặt, tăng lên nếu app đếm thừa.

Sau khi sửa, upload lại file lên GitHub. Nhớ đổi `CACHE = 'pushup-v1'` trong `sw.js` thành `v2`, `v3`… để iPhone nhận bản mới. Sau đó mở app 2 lần (lúc có mạng) là app cập nhật.

## Ghi chú kỹ thuật

- Nhận diện tư thế: MediaPipe Pose Landmarker (Google, giấy phép Apache-2.0), chạy bằng WebAssembly/WebGL ngay trong Safari.
- Camera trực tiếp dùng mô hình *lite* (nhanh). Phân tích video dùng mô hình *full* (chính xác hơn) với 15 khung hình mỗi giây.
- App chặn gói thống kê sử dụng mà thư viện MediaPipe tự gửi về Google.
