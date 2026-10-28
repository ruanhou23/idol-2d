# Live2D Character Studio & Customizer ✨

Dự án độc lập trích xuất và tối ưu từ hệ thống animation 2D của **Project AIRI**, chuyên dùng để **tự setup ngoại hình nhân vật** (thay đổi quần áo, kiểu tóc, phụ kiện), điều khiển animation sống động và **soi chi tiết các góc nhìn & bộ phận gốc**.

---

## 🚀 Các Tính Năng Đầy Đủ

### 1. 👗 Quần Áo & Trang Phục (Outfits)
- **Presets trang phục**: Đầy đủ (Full), Áo cộc tay (Summer), Áo ba lỗ (Casual), Đổi dáng tay A/B.
- **Bảng màu nhuộm áo**: Mặc định, Navy Blue, Hồng Sakura, Xanh Bạc Hà, Tím Cyberpunk, Cam Nắng.
- **Thanh trượt Hue Shift (0° - 360°)**: Tùy biến toàn bộ dải màu trang phục theo thời gian thực.
- **Tùy biến từng lớp áo**: Bật/tắt chi tiết từng layer thân, tay áo, cổ áo.

### 2. 💇 Kiểu Tóc & Dáng Tóc (Hairstyles)
- **Presets kiểu tóc**: Tóc Dài Tự Nhiên, Tóc Ngắn / Bob, Tóc Tém / Tomboy, Buộc Gọn (Tied).
- **Dáng tóc & độ đung đưa**: Thanh trượt Mái trước (Hair Front), Tóc hai bên (Hair Side), Tóc sau (Hair Back).
- **Tùy biến từng lọn tóc**: Checkbox riêng cho từng part tóc.

### 3. 🎭 Biểu Cảm (Expressions)
- **Cảm xúc nhanh**: Bình thường, Vui vẻ, Má hồng (Blush), Nháy mắt (Wink), U sầu, Tức giận.
- **Tinh chỉnh chi tiết**: Má hồng (Cheek), Khuôn miệng cười (Smile), Độ cao lông mày (Brow).

### 4. ⚡ Animation & Phản Xạ (AIRI Engine)
- **Look-at Mouse**: Xoay đầu và mắt theo con trỏ chuột.
- **Auto Blink**: Chớp mắt tự nhiên bằng sóng sin mượt mà.
- **Breath**: Nhịp thở phập phồng điều hòa.
- **Idle Saccade**: Đảo mắt ngẫu nhiên tự nhiên như người thật.
- **Lip-Sync**: Thanh trượt độ mở miệng và nút test nói tự động.

### 5. 📐 Góc Nhìn & Bộ Phận Gốc (Inspector - MỚI!)
- **Góc nhìn Camera Cận Cảnh (Camera Focus)**:
  - 👤 **Cận Mặt (Face Focus)**: Tự động zoom lớn và căn giữa khuôn mặt để ngắm chi tiết mắt, miệng, biểu cảm.
  - 👚 **Thân Trên (Upper Body)**: Căn khung ngắm trang phục, phụ kiện ngực và tay áo.
  - 🧍 **Toàn Thân (Full Body)**: View toàn thể nhân vật.
  - 🔄 **Đặt lại góc xem**: Khôi phục vị trí mặc định.
- **Xoay Góc Các Bộ Phận (Angle Inspector)**:
  - Nút góc nhanh: ⬅️ Xoay Trái (-28°), 🎯 Trực Diện (0°), ➡️ Xoay Phải (+28°), ⬆️ Ngước Lên (+25°), ⬇️ Cúi Xuống (-25°).
  - Thanh trượt xoay chi tiết: Góc đầu X, Y, Z và góc thân Body X.
  - Tùy chọn **Khóa góc quay**: Giữ nguyên góc nhìn đã xoay mà không bị con trỏ chuột kéo theo.
- **Soi Riêng Bộ Phận Gốc (Solo Mode)**:
  - Chọn bất kỳ một bộ phận nào trong model (ví dụ: Mái trước, Áo, Mắt, Kính...) và bấm **"🔍 Soi Riêng"** -> Hệ thống sẽ ẩn tất cả các phần khác, chỉ hiển thị duy nhất bộ phận đó để kiểm tra hình vẽ gốc!
  - Nút **"Bật Lại Toàn Bộ"** để khôi phục.
- **Bản Vẽ Texture Gốc (Raw Texture Atlas)**:
  - Xem trước và bấm **"👁️ Phóng To Texture Gốc"** để mở modal hiển thị tấm ảnh vẽ 2D gốc (2048 x 2048 px) của nhân vật với đầy đủ các mảnh cắt rời.

---

## 🛠️ Hướng Dẫn Khởi Chạy

```bash
cd /home/ken/.gemini/antigravity/scratch/live2d-customizer
pnpm dev
```
Truy cập trên trình duyệt: **http://localhost:5180**
