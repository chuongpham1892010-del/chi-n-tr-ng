# CHIẾN TRƯỜNG ONLINE — GÓI TRIỂN KHAI

Gói này chuyển phần phòng online từ mã phòng giả lập trên từng trình duyệt sang phòng có mã được quản lý bởi máy chủ Socket.IO. Gói gồm game HTML, máy chủ realtime, cấu hình Render và quy trình GitHub Pages.

## 1. Những gì đã được tích hợp

- Tạo phòng trên máy chủ với mã mời ngẫu nhiên 6 ký tự.
- Tham gia phòng từ thiết bị khác bằng cùng mã và cùng địa chỉ máy chủ.
- Phòng 2–4 người thật, tối đa 5 phe gồm cả bot; chủ phòng và người chơi có trạng thái sẵn sàng.
- Máy chủ quản lý thời lượng 30, 45 hoặc 60 phút, thời điểm bắt đầu và kết thúc.
- Gửi lệnh điều khiển quân, tuyển quân, xây tường, xây tháp canh, đội hình, chế độ chiến đấu, rút lui và triển khai lực lượng dự trữ.
- Chủ phòng điều phối mô phỏng và gửi ảnh chụp trạng thái trận cho các thiết bị khác khoảng mỗi 0,9 giây.
- Có xử lý mất kết nối, tự kết nối lại bằng mã token lưu trên thiết bị, bot tiếp quản phe bị ngắt kết nối và chuyển quyền điều phối khi chủ phòng rời mạng.
- Có endpoint kiểm tra máy chủ tại `/health`.

## 2. Giới hạn cần biết trước khi triển khai

**Đây là mô hình chủ phòng điều phối (host-authoritative), chưa phải máy chủ mô phỏng chuyên dụng.** Trình duyệt của chủ phòng vẫn chạy toàn bộ phép tính chiến trường; Render quản lý phòng, đồng hồ và chuyển tiếp lệnh/trạng thái. Vì vậy:

- Chủ phòng phải giữ game mở và duy trì kết nối. Nếu chủ phòng mất kết nối, người chơi đang kết nối tiếp theo sẽ tiếp quản từ trạng thái gần nhất đã đồng bộ.
- Nếu không còn người thật nào kết nối, trận sẽ tạm dừng.
- Trạng thái phòng hiện được giữ trong RAM của tiến trình máy chủ, chưa có cơ sở dữ liệu. Khi máy chủ khởi động lại hoặc triển khai phiên bản mới, các phòng đang chơi có thể mất.
- Chưa có tài khoản người dùng, xác thực danh tính hoặc chống gian lận ở mức máy chủ chuyên dụng. Không nên xem đây là kiến trúc thi đấu có xếp hạng/giải thưởng.
- GitHub Pages chỉ phục vụ giao diện tĩnh; nó không thể thay thế máy chủ Socket.IO.

Để vận hành lâu dài và chống gian lận tốt hơn, bước tiếp theo là chuyển `upd()` và trạng thái mô phỏng sang tiến trình máy chủ chuyên dụng, đồng thời lưu phòng/trận bằng cơ sở dữ liệu hoặc kho trạng thái bền vững.

## 3. Cấu trúc thư mục

```text
.
├── public/
│   └── index.html
├── server.js
├── package.json
├── render.yaml
├── Dockerfile
├── .dockerignore
├── .env.example
├── .github/workflows/pages.yml
├── scripts/check.js
└── test/server.test.js
```

## 4. Triển khai GitHub Pages (giao diện game)

1. Tạo một repository trên GitHub.
2. Tải **toàn bộ nội dung bên trong thư mục dự án này** lên repository, giữ nguyên các thư mục `public/` và `.github/workflows/`.
3. Chọn nhánh `main` làm nhánh chính và commit/push mã nguồn.
4. Vào **Settings → Pages → Build and deployment → Source**, chọn **GitHub Actions**.
5. Vào tab **Actions**, mở workflow `Deploy game to GitHub Pages`. Chờ lần chạy có dấu kiểm xanh.
6. Mở URL Pages GitHub hiển thị trong workflow. Tất cả thiết bị tham gia cùng một ván phải mở cùng URL game này.

Tài liệu chính thức: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

## 5. Triển khai máy chủ realtime trên Render

1. Đưa repository GitHub ở bước trên vào tài khoản Render. Repository phải chứa trực tiếp `package.json`, `server.js`, `render.yaml`, `Dockerfile` và thư mục `public/` ở thư mục gốc của dự án.
2. Cách khuyến nghị: trên Render chọn **New → Blueprint** và chọn repository chứa `render.yaml`. Blueprint này dùng Runtime `Node`, Build command `npm install` và Start command `npm start`; vùng dịch vụ là **Singapore**.
3. Nếu bạn đã tạo Web Service thủ công và đang chọn môi trường **Docker**, hãy bảo đảm `Dockerfile` nằm trong **Root Directory** mà Render đang dùng. Dockerfile trong gói này cài dependencies production, chép `server.js` cùng `public/index.html` và chạy `npm start`.
4. Nếu ZIP được giải nén thành thư mục lồng `chien_truong_online_project/` và bạn đã đẩy cả thư mục cha lên GitHub, hãy đặt **Root Directory** của Render thành `chien_truong_online_project`. Cách khác là đưa toàn bộ nội dung bên trong thư mục đó lên thẳng gốc repository rồi để Root Directory trống.
5. Dịch vụ phải chạy `server.js`. Mã đã bind `0.0.0.0` và dùng cổng `PORT` do Render cấp.
6. Sau khi deploy thành công, lưu URL dạng `https://ten-dich-vu.onrender.com`.
5. Trong Environment của Render, đổi `ALLOWED_ORIGINS` từ `*` thành origin của GitHub Pages, ví dụ `https://ten-tai-khoan.github.io`. **Chỉ nhập origin, không thêm đường dẫn repository `/ten-repo`.** Nếu dùng tên miền riêng, nhập origin tên miền đó. Có thể nhập nhiều origin, phân tách bằng dấu phẩy.
6. Mở `https://ten-dich-vu.onrender.com/health`. Kết quả hợp lệ có dạng JSON chứa `"ok":true`.

Tài liệu Render: https://render.com/docs/web-services và https://render.com/docs/blueprint-spec

`render.yaml` hiện chọn gói Free để thử nghiệm ở vùng Singapore. Gói miễn phí có giới hạn tài nguyên và có thể bị khởi động lại; với trận dài và nhiều quân, nên chọn gói phù hợp hơn và không coi gói Free là cấu hình production.

### Sửa lỗi `failed to read dockerfile: open Dockerfile: no such file or directory`

- Kiểm tra **Root Directory** trong phần Settings của Render. Thư mục này phải là nơi có file `Dockerfile` và `package.json` cùng cấp.
- Trong gói mới, `Dockerfile` đã được đặt cạnh `package.json`.
- Nếu bạn dùng Blueprint `render.yaml` thì cấu hình gốc chọn Node runtime, không cần Dockerfile. Không trộn cấu hình Node Blueprint với một Web Service thủ công đang trỏ nhầm Root Directory.
- Sau khi sửa Root Directory hoặc cập nhật repository chứa Dockerfile, chọn **Manual Deploy → Deploy latest commit**.

## 6. Kết nối game với máy chủ

1. Mở game GitHub Pages.
2. Chọn số người thật, số bot và thời lượng.
3. Trong ô **Địa chỉ máy chủ realtime**, dán URL Render, ví dụ `https://ten-dich-vu.onrender.com`, rồi bấm **Lưu địa chỉ máy chủ**.
4. Người tạo bấm **Tạo phòng online** và gửi mã 6 ký tự cho những người còn lại.
5. Mỗi thiết bị mở đúng URL GitHub Pages, nhập cùng URL Render, vào **Vào phòng bằng mã**, nhập mã phòng và bấm sẵn sàng.
6. Khi đủ người và tất cả đã sẵn sàng, chủ phòng bấm **Bắt đầu trận**.

Không dùng `localhost` trên một thiết bị và URL Render trên thiết bị còn lại. `localhost` chỉ trỏ về chính thiết bị đang mở trình duyệt đó.

## 7. Chạy thử trên máy tính

Yêu cầu Node.js 20 trở lên.

```bash
npm install
npm run check
npm test
npm start
```

Mở `http://localhost:3000`. Để điện thoại trong cùng Wi-Fi truy cập máy tính, cần dùng địa chỉ IP LAN của máy tính thay cho `localhost` và cho phép cổng máy chủ qua firewall. Truy cập qua mạng Internet vẫn cần deploy server công khai.

## 8. Kiểm tra sau khi deploy

- Mở `/health` và xác nhận `ok: true`.
- Dùng hai thiết bị tạo/vào cùng phòng; kiểm tra mã phòng hiển thị giống nhau.
- Kiểm tra trạng thái sẵn sàng, bắt đầu trận, di chuyển quân và tuyển quân từ từng phe.
- Thử 3–4 thiết bị, thử thêm bot, thử rời phòng ở lobby và kết nối lại khi trận đang chạy.
- Không đóng tab của chủ phòng trong lúc thử; thử chuyển quyền điều phối riêng sau khi đã xác minh luồng cơ bản.
- Kiểm tra log Render khi có lỗi kết nối hoặc phòng bị đóng.

## 9. Tình trạng kiểm thử của gói này

Đã kiểm tra cú pháp JavaScript trong HTML và `server.js` bằng Node.js. Đã kiểm tra cấu trúc YAML của Render và GitHub Actions. Có thêm `npm test` để kiểm tra vòng đời phòng, giải phóng ghế, đồng bộ Socket.IO và chuyển chủ phòng sau khi cài dependencies.

Trong môi trường tạo gói này, truy cập npm registry bị lỗi DNS (`EAI_AGAIN`), nên không thể cài Express/Socket.IO để chạy kiểm thử mạng thật tại đây. Trình duyệt kiểm thử tự động cũng bị môi trường chặn. Vì vậy **chưa xác nhận deploy thực tế hoặc test 3–4 thiết bị**. Cần chạy các bài kiểm tra ở mục 8 sau khi kết nối GitHub và Render.
