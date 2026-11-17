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
| **Trước mặt** | Đặt máy dưới sàn phía trước đầu, cách khoảng 1,5 m. Tốt nhất là thấy rõ 2 vai và 2 tay | Kết hợp 4 tín hiệu: cổ tay so với vai, khuỷu tay gập lại, vai hạ xuống, đầu hạ xuống. Tự điều chỉnh theo biên độ của bạn |

- Nên để chế độ **Tự động**. App tự nhận ra bạn đang quay ngang hay quay trước mặt (dựa vào bề rộng vai và hướng mặt). Nếu app nhận sai, hãy chọn tay.
- Quay trước mặt mà **ở quá gần camera** (không thấy cổ tay) hoặc **bị che một bên vai**: app vẫn đếm được nhờ đầu, vai và khuỷu tay còn thấy. Dòng nhỏ trên màn hình cho biết app đang đếm "theo" những bộ phận nào.
- **Đặt máy sát mặt** (lúc xuống, đầu che gần hết camera): AI thường không nhận ra người ở tư thế này. App sẽ đếm "theo khung hình": so khung hình hiện tại với lúc bạn đang ở trên cao. Để chế độ này chạy tốt:
  - bắt đầu bằng tư thế **lên** (tay duỗi thẳng, thấy rõ mặt và vai) khoảng 1 giây;
  - đặt máy cố định, đừng để máy bị xô lệch giữa chừng.
- Quay trước mặt, app **tạm dừng đếm** khi:
  - bạn đang đứng (thấy rõ chân/hông thấp hơn vai nhiều);
  - tay giơ cao hơn vai (đang với tay chỉnh máy);
  - khung hình bị trượt, giật hoặc xoay (đang chỉnh máy);
  - không thấy người quá 0,4 giây (nếu đang không đếm theo khung hình), hoặc liên tục quá 2,5 giây (ví dụ lấy tay che máy).

  Sau đó app chờ khoảng 0,8 giây cho ổn định rồi mới đếm tiếp. Nếu tay vẫn thấy rõ mà không hề gập, việc đầu/vai di chuyển cũng không được tính.
- Nằm ở dưới quá 5 giây (nghỉ) thì lượt đó không được tính.
- Một rep có thể nhanh tới khoảng 0,5 đến 1 giây (đủ xuống và lên). Rep nhanh hơn 0,35 giây sẽ bị bỏ qua vì coi là nhiễu.
- Tay màu **xanh lá** nghĩa là đang ở tư thế lên, **xanh dương** nghĩa là đang xuống.

## 4. Chỉnh ngưỡng (nếu thấy đếm thiếu hoặc thừa)

Mở `counter.js` và sửa các số trong `DEFAULTS`:

- `sideDownAngle` (mặc định 100): tăng lên (ví dụ 110) nếu app hay bỏ sót rep khi quay ngang.
- `sideUpAngle` (mặc định 150): giảm xuống (ví dụ 140) nếu bạn không duỗi thẳng tay hẳn.
- `frontMinRange` (0,45), `frontElbowMinRange` (0,25), `frontHeadMinRange` (0,30): biên độ tối thiểu khi quay trước mặt, lần lượt cho cổ tay, khuỷu tay, và đầu/vai. Giảm xuống nếu app bỏ sót rep, tăng lên nếu app đếm thừa.
- `frontMaxSideSpeed` (2,0) / `frontMaxVertSpeed` (6,0): giảm xuống nếu app vẫn đếm lúc bạn chỉnh máy. Tăng lên nếu app hay báo "Máy đang di chuyển" khi bạn đang tập bình thường.
- `frontSettleSec` (0,8): thời gian chờ ổn định sau khi đứng dậy hoặc chỉnh máy.
- `frontImageMinRange` (0,25): biên độ tối thiểu khi đếm theo khung hình (đặt máy sát mặt). Tăng lên nếu app đếm thừa.
- `frontMaxBlindSec` (2,5): không thấy người lâu hơn mức này thì bắt đầu lại. Tăng lên nếu bạn xuống rất chậm và giữ lâu ở dưới.

Sau khi sửa, upload lại file lên GitHub. Nhớ đổi `CACHE = 'pushup-v3'` trong `sw.js` thành `v4`, `v5`… để iPhone nhận bản mới. Sau đó mở app 2 lần (lúc có mạng) là app cập nhật.

## Ghi chú kỹ thuật

- Nhận diện tư thế: MediaPipe Pose Landmarker (Google, giấy phép Apache-2.0), chạy bằng WebAssembly/WebGL ngay trong Safari.
- Camera trực tiếp dùng mô hình *lite* (nhanh). Phân tích video dùng mô hình *full* (chính xác hơn) với 15 khung hình mỗi giây.
- App chặn gói thống kê sử dụng mà thư viện MediaPipe tự gửi về Google.
