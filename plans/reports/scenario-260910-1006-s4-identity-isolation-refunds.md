# Báo cáo kịch bản: Danh tính, cô lập Cửa hàng, phân công và quyết định Hoàn tiền trong S4

Nguồn: [`session-4-brief.md`](../../session-4-brief.md)

## Hợp đồng kết quả

- **Kết quả:** Dữ liệu hiện có của Cửa hàng A được cung cấp cho các tài khoản Chủ cửa hàng (Owner) và Nhân viên (Staff) đã đăng nhập; Cửa hàng B dùng để chứng minh khả năng cô lập; Owner có thể phân công Đơn hàng và quyết định Yêu cầu Hoàn tiền; Staff được phân công có thể xử lý Đơn hàng trong phạm vi cho phép; Storefront công khai và luồng capability của Khách hàng vẫn hoạt động.
- **Ràng buộc:** Bảo toàn dữ liệu và lịch sử S1–S3, từ chối an toàn đối với truy cập riêng tư, dùng một bộ đánh giá quyền duy nhất ở phía máy chủ, tách biệt capability của Khách hàng với danh tính Console, không thực thi Yêu cầu Hoàn tiền đã được duyệt cho đến S5, đồng thời áp dụng phạm vi Cửa hàng tại tầng ứng dụng vì D1 không hỗ trợ RLS.
- **Ngoài phạm vi:** Xác minh thanh toán hoặc hoàn tiền thực tế (S5), biên nhận hoặc MCP (S6), thay capability của Khách hàng bằng phiên người dùng và tạo lại dữ liệu Cửa hàng A.
- **Ranh giới nghiệm thu:** Quyền truy cập phải được chứng minh tại ranh giới API/domain. Việc ẩn nút hoặc gắn nhãn route không phải bằng chứng phân quyền.

## Các điểm nối hiện tại định hình kịch bản

- Route Đơn hàng của Console hiện tạo ngữ cảnh `bootstrap_owner` cho mọi request trong [`apps/worker/src/console-order-routes.ts`](../../apps/worker/src/console-order-routes.ts).
- Các thao tác đọc và ghi Catalog hiện gắn cứng `BOOTSTRAP_STORE_ID`; vì vậy việc cô lập Cửa hàng trong S4 phải bao phủ cả Sản phẩm, import và file bàn giao, không chỉ Đơn hàng.
- `OrderContext` và các truy vấn Đơn hàng có điều kiện Cửa hàng tạo sẵn điểm nối cho bộ đánh giá quyền, nhưng các chốt lệnh hiện chỉ chấp nhận bootstrap actor hoặc Storefront Customer actor khớp với Đơn hàng.
- Truy cập trang riêng tư của Khách hàng hiện chỉ lưu bản băm capability và trả cùng một phản hồi từ chối `404` khi capability bị thiếu hoặc sai.
- Schema Hoàn tiền hiện chỉ cho phép trạng thái `pending`; S4 phải mở rộng sang các trạng thái đã quyết định, đồng thời bảo toàn hợp đồng một yêu cầu đang mở và lịch sử bất biến mà S5 cần.
- Working tree hiện có các chỉnh sửa không liên quan về định dạng tiền tệ. Báo cáo này không thay đổi hoặc diễn giải lại các chỉnh sửa đó.

Các chiều đã phân tích: Loại người dùng, Biên đầu vào, Thời điểm, Quy mô, Chuyển trạng thái, Môi trường, Chuỗi lỗi, Phân quyền, Toàn vẹn dữ liệu, Tích hợp, Tuân thủ, Logic nghiệp vụ.

Các chiều đã bỏ qua: Không có. Danh tính, multi-tenancy, lịch sử bền vững, quyền truy cập bằng capability của Khách hàng và các thành phần S5/S6 trong tương lai khiến cả 12 chiều đều có ý nghĩa.

## Kịch bản

| # | Chiều | Kịch bản | Mức độ | Hành vi mong đợi |
|---:|---|---|---|---|
| 1 | Loại người dùng | Owner của Cửa hàng A đăng nhập lần đầu sau migration. | Cao | Owner thấy toàn bộ Sản phẩm, Khách hàng, Đơn hàng, Yêu cầu Hoàn tiền, bản ghi thanh toán và sự kiện lịch sử của Cửa hàng A từ trước S4 mà không cần seed lại hoặc làm sai lệch số lượng. |
| 2 | Loại người dùng | Staff đang hoạt động của Cửa hàng A mở một Đơn hàng hiện được phân công cho mình. | Cao | Các thao tác vận hành được phép xuất hiện và thực hiện thành công; quyết định Hoàn tiền và thao tác xóa chỉ dành cho Owner vẫn không khả dụng trên UI và bị máy chủ từ chối. |
| 3 | Loại người dùng | Staff bị vô hiệu hóa hoặc bị gỡ tư cách thành viên trong khi vẫn còn phiên chưa hết hạn. | Nghiêm trọng | Lần đọc hoặc ghi riêng tư tiếp theo phải đánh giá lại tư cách thành viên và từ chối an toàn; chỉ sở hữu phiên không đủ để truy cập. |
| 4 | Loại người dùng | Người gọi ẩn danh, không xác định hoặc có phiên sai định dạng yêu cầu bất kỳ tài nguyên `/api/console/*` nào. | Nghiêm trọng | Không được rơi về bootstrap. Phản hồi là lỗi xác thực và không để lộ sự tồn tại của Cửa hàng, bản ghi hoặc vai trò. |
| 5 | Biên đầu vào | Đăng nhập nhận trường trống, email Unicode khác kiểu viết hoa/thường, khoảng trắng thừa, mật khẩu quá dài, JSON sai hoặc khóa trùng. | Trung bình | Chỉ chuẩn hóa tại nơi hợp đồng quy định, giới hạn đầu vào trước tác vụ tốn kém và trả lỗi trường ổn định mà không phản chiếu bí mật. |
| 6 | Biên đầu vào | Người dùng Cửa hàng B đưa mã Sản phẩm, Đơn hàng, import hoặc file của Cửa hàng A đã encode, đổi kiểu chữ hoặc đoán được vào URL. | Nghiêm trọng | Mọi truy vấn đều phải có điều kiện Cửa hàng đã xác thực trước khi trả dữ liệu hoặc áp dụng hành động; phản hồi từ chối không hỗ trợ dò tìm tài nguyên. |
| 7 | Biên đầu vào | Lệnh phân công nhắm tới người dùng không tồn tại, Owner khi chỉ Staff hợp lệ, thành viên không hoạt động hoặc người dùng Cửa hàng B. | Nghiêm trọng | Lệnh bị từ chối nguyên tử; người được phân công trước đó và lịch sử không thay đổi. |
| 8 | Biên đầu vào | Quyết định Hoàn tiền nhận quyết định không xác định, trường thừa, ghi chú quá dài, JSON sai hoặc idempotency key không hợp lệ/đã dùng lại. | Cao | Kiểm tra nghiêm ngặt từ chối request trước khi ghi; phát lại cùng payload có cùng nghĩa trả kết quả gốc, còn payload không khớp trả conflict. |
| 9 | Thời điểm | Hai request của Owner đồng thời Duyệt và Từ chối cùng một Yêu cầu Hoàn tiền đang chờ. | Nghiêm trọng | Chỉ một quyết định cuối cùng được commit. Request thua nhận trạng thái chuẩn đã quyết định/conflict; chỉ có một sự kiện lịch sử quyết định. |
| 10 | Thời điểm | Owner phân công lại Đơn hàng trong khi người được phân công cũ gửi lệnh Fulfill hoặc Cancel. | Cao | Phân công và quyền thực hiện hành động được kiểm tra theo trạng thái giao dịch/hiện tại lúc commit; người cũ không thể commit nếu việc phân công lại thắng. |
| 11 | Thời điểm | Tư cách thành viên bị thu hồi sau khi xác thực nhưng trước khi thao tác riêng tư commit. | Nghiêm trọng | Quyền phải được đánh giá sát thao tác ghi trong cùng ranh giới nhất quán; việc thu hồi ngăn cả thay đổi lẫn sự kiện audit. |
| 12 | Thời điểm | Mất phản hồi khiến việc phân công hoặc quyết định Hoàn tiền bị thử lại từ một hay nhiều tab. | Cao | Retry có tính idempotent trả một kết quả chuẩn; không tạo lịch sử phân công/quyết định trùng hoặc trạng thái Khách hàng mâu thuẫn. |
| 13 | Quy mô | Cửa hàng B mới không có Sản phẩm, Khách hàng, Đơn hàng, phân công hoặc Hoàn tiền. | Thấp | Console hiển thị trạng thái trống trung thực và metric bằng 0 lấy từ máy chủ, không mượn dữ liệu Cửa hàng A. |
| 14 | Quy mô | Cửa hàng A có đủ Đơn hàng để vượt qua nhiều trang cursor cùng bộ lọc người được phân công, trạng thái và Hoàn tiền. | Cao | Số tổng hợp phản ánh toàn bộ tập đã lọc trong phạm vi Cửa hàng, cursor không thể vượt phạm vi và không bỏ sót hoặc lặp dòng khi phân trang. |
| 15 | Quy mô | Một Cửa hàng có nhiều Staff và Đơn hàng. | Trung bình | Danh sách chọn người phân công có giới hạn/có thể tìm kiếm, API danh sách/chi tiết tránh truy vấn thành viên cho từng dòng và chi phí phân quyền không tăng theo tổng số Cửa hàng. |
| 16 | Quy mô | Cửa hàng A và B cố ý dùng cùng slug, email, SKU, mã tham chiếu hoặc idempotency key hướng người dùng tại nơi schema cho phép. | Cao | Quy tắc duy nhất và phát lại được giới hạn theo đúng chủ sở hữu; một Cửa hàng không thể xung đột hoặc phát lại lệnh của Cửa hàng khác. |
| 17 | Chuyển trạng thái | Migration S4 chạy trên cơ sở dữ liệu S1–S3 thật của Cửa hàng A, gồm lịch sử cũ có actor `bootstrap_owner` hoặc không có mã người thật. | Nghiêm trọng | Mọi dòng được gắn với Cửa hàng A, lịch sử hiện có vẫn bất biến và được đánh dấu trung thực là legacy/bootstrap; không bịa việc quy trách nhiệm cho người thật. |
| 18 | Chuyển trạng thái | Owner phân công Đơn hàng chưa có người nhận cho Staff A, chuyển sang Staff B rồi bỏ phân công. | Cao | Mỗi trạng thái được lưu bền vững, phân công hiện tại rõ ràng và lịch sử bất biến ghi lại đúng Owner cùng người nhận trước/sau. |
| 19 | Chuyển trạng thái | Owner Duyệt yêu cầu đang chờ của Đơn hàng Paid hoặc Fulfilled. | Cao | Hoàn tiền chuyển thành `approved`; Đơn hàng vẫn Paid hoặc Fulfilled, chưa đảo ngược thanh toán/quyền truy cập và nội dung UI nói rõ vẫn chờ thực thi. |
| 20 | Chuyển trạng thái | Người dùng đăng xuất, trình duyệt sập hoặc phiên hết hạn giữa lúc điều hướng rồi mở lại trang. | Cao | Trạng thái riêng tư không được khôi phục từ cache phía client không an toàn; người dùng quay lại đăng nhập và sau đó chỉ tiếp tục trong tư cách thành viên hiện tại. |
| 21 | Môi trường | Cookie phiên được dùng trên HTTP cục bộ và HTTPS đã triển khai, gồm điều hướng URL trực tiếp và refresh. | Cao | Thuộc tính cookie phù hợp từng môi trường; cookie production dùng Secure/HttpOnly/SameSite theo thiết kế và không đặt token trong URL hoặc vùng lưu trữ mà JavaScript trình duyệt đọc được. |
| 22 | Môi trường | Owner và Staff thao tác ở múi giờ/locale khác nhau quanh thời điểm đổi giờ mùa hè hoặc qua ngày. | Trung bình | Timestamp audit lưu theo UTC và sắp xếp xác định; cách hiển thị có thể bản địa hóa nhưng không làm thay đổi thứ tự quyết định hoặc phân công. |
| 23 | Môi trường | Owner và Staff dùng bàn phím/trình đọc màn hình ở độ rộng 375 px. | Trung bình | Không có cuộn ngang; vai trò, người được phân công và trạng thái quyết định được đọc ra; focus tồn tại qua cập nhật thành công/lỗi; hành động chính vẫn dùng token accent. |
| 24 | Môi trường | Cùng một danh tính mở hai tab trình duyệt với trạng thái Đơn hàng, phân công hoặc thành viên đã cũ. | Cao | Máy chủ từ chối chuyển trạng thái cũ không còn quyền; UI tải lại trạng thái chuẩn thay vì ghi đè công việc mới hơn. |
| 25 | Chuỗi lỗi | Truy vấn phiên hoặc thành viên thất bại vì D1 không khả dụng hoặc trả lỗi bất ngờ. | Nghiêm trọng | Route riêng tư từ chối an toàn với lỗi không lộ thông tin ngoài incident; tuyệt đối không rơi về `bootstrap_owner`, Cửa hàng A hoặc truy cập ẩn danh. |
| 26 | Chuỗi lỗi | Lệnh phân công hoặc quyết định Hoàn tiền ghi được dòng trạng thái nhưng không lưu được lịch sử/idempotency. | Nghiêm trọng | Toàn bộ lệnh rollback. Trạng thái, lịch sử audit và bản ghi phát lại phải cùng commit hoặc cùng không được ghi. |
| 27 | Chuỗi lỗi | Migration S4 thất bại sau khi tạo bảng danh tính hoặc trong lúc xây lại ràng buộc Hoàn tiền/lịch sử. | Nghiêm trọng | Migration có tính giao dịch/có thể chạy lại an toàn, bản sao lưu cơ sở dữ liệu trước thay đổi vẫn khôi phục được và không có dòng S1–S3 bị gắn lại hoặc xóa một phần. |
| 28 | Chuỗi lỗi | Hạ tầng xác thực/phiên suy giảm trong khi Storefront công khai vẫn có lưu lượng. | Cao | Đọc Sản phẩm công khai và tạo Đơn hàng Cửa hàng A vẫn rõ ràng là công khai và hoạt động khi các dependency riêng của chúng khỏe mạnh; không route riêng tư nào vô tình bị mở. |
| 29 | Phân quyền | Người gọi giả mạo `user_id`, `role`, `store_id`, người được phân công hoặc actor trong header/body. | Nghiêm trọng | Danh tính, tư cách thành viên, Cửa hàng và actor được ghi chỉ đến từ phiên máy chủ đã xác minh và cơ sở dữ liệu; quyền do client cung cấp bị bỏ qua/từ chối. |
| 30 | Phân quyền | Capability Đơn hàng hợp lệ của Khách hàng được gửi đến endpoint Console hoặc kết hợp với mã Staff/Owner đoán được. | Nghiêm trọng | Capability chỉ cho phép các thao tác đọc/gửi yêu cầu Hoàn tiền dành cho Khách hàng trong allow-list đối với đúng một Đơn hàng và không bao giờ trở thành danh tính Console. |
| 31 | Phân quyền | Staff Cửa hàng A gọi trực tiếp endpoint Duyệt, Từ chối hoặc thao tác xóa được bảo vệ chỉ dành cho Owner. | Nghiêm trọng | Bộ đánh giá quyền trung tâm từ chối dù Staff là người được phân công và UI đã bị can thiệp; không trạng thái hay dòng audit được bảo vệ nào thay đổi. |
| 32 | Phân quyền | Owner hoặc Staff Cửa hàng B dùng mã đã biết để yêu cầu route danh sách, chi tiết, hành động, upload, import, Sản phẩm hoặc file của Cửa hàng A. | Nghiêm trọng | Mọi bề mặt riêng tư áp dụng cùng phạm vi Cửa hàng và trả từ chối không hỗ trợ dò tìm, không gây tác dụng phụ xuyên Cửa hàng. |
| 33 | Toàn vẹn dữ liệu | Mã nguồn cố tạo phân công cho người dùng không có tư cách thành viên đang hoạt động trong Cửa hàng sở hữu Đơn hàng. | Nghiêm trọng | Ràng buộc sở hữu kết hợp và validation của domain từ chối dòng; không thể tồn tại phân công mồ côi hoặc xuyên Cửa hàng. |
| 34 | Toàn vẹn dữ liệu | Tạo/mời thành viên trùng hoặc các lệnh phân công lại đồng thời nhắm cùng một Đơn hàng. | Cao | Quy tắc duy nhất của tư cách thành viên được định nghĩa rõ; mỗi Đơn hàng có đúng một phân công hiện tại chuẩn trong khi vẫn giữ lịch sử đầy đủ. |
| 35 | Toàn vẹn dữ liệu | Tên/email của người thật thay đổi hoặc tài khoản của họ bị vô hiệu hóa sau khi họ thực hiện hành động. | Nghiêm trọng | Bản ghi audit giữ định danh/tham chiếu actor bất biến và ý nghĩa lịch sử; đổi tên hiển thị không viết lại người đã thực hiện hành động trước đây. |
| 36 | Toàn vẹn dữ liệu | Sau khi Hoàn tiền đã được quyết định, có yêu cầu mới, chuyển trạng thái SQL trực tiếp không hợp lệ hoặc bước thực thi S5 trong tương lai. | Nghiêm trọng | S4 chỉ cho phép chuyển từ pending sang approved/rejected theo thiết kế, bảo toàn quy tắc một yêu cầu đang mở và cung cấp cho S5 bản ghi approved rõ ràng, không hỏng dữ liệu âm thầm. |
| 37 | Tích hợp | API Console trả lỗi phiên hết hạn/xác thực trong lúc UI danh sách hoặc chi tiết đang tải. | Cao | UI chuyển đến đăng nhập hoặc trạng thái hết phiên rõ ràng; không hiển thị Cửa hàng khác, trạng thái trống giả thành công hoặc dữ liệu riêng tư trong cache. |
| 38 | Tích hợp | CORS preflight của Storefront và tạo Đơn hàng công khai chạy sau khi Console được thêm xác thực. | Cao | CORS Storefront theo allow-list và header hợp đồng Đơn hàng hiện có vẫn hoạt động; API riêng tư của Console không nhận CORS wildcard/phản chiếu hoặc quyền truy cập credential từ Storefront. |
| 39 | Tích hợp | S6 sau này gọi bộ đánh giá quyền với cùng bộ actor, Cửa hàng, tài nguyên và hành động. | Cao | Bộ đánh giá không phụ thuộc framework và trả cùng quyết định như route HTTP; kiểm tra riêng theo route/UI không thể lệch khỏi nó. |
| 40 | Tích hợp | S5 đọc yêu cầu đã được S4 duyệt và Đơn hàng paid cũ thiếu bằng chứng thanh toán gốc. | Cao | S4 ghi quyết định bền vững nhưng không tuyên bố tiền đã di chuyển; S5 phân biệt được approved với rejected/pending và không tự động hoàn khoản `legacy_unrecorded`. |
| 41 | Tuân thủ | Kiểm tra log, lỗi, payload API, vùng lưu trữ trình duyệt hoặc URL sau lần đăng nhập thất bại và phiên thành công. | Nghiêm trọng | Không có mật khẩu, bản băm mật khẩu, token phiên thô, giá trị cookie hoặc capability của Khách hàng; log chỉ dùng mã an toàn/metadata incident. |
| 42 | Tuân thủ | Capability của Khách hàng đọc Đơn hàng sau khi phân công và quyết định Hoàn tiền. | Nghiêm trọng | Phản hồi chỉ chứa trường Đơn hàng và quyết định an toàn cho Khách hàng; loại bỏ danh tính Staff, thành viên, ghi chú nội bộ, dữ liệu phiên và lý do nội bộ của bộ đánh giá quyền. |
| 43 | Tuân thủ | Người dùng yêu cầu xóa/vô hiệu hóa trong khi hành động của họ được tham chiếu bởi lịch sử Đơn hàng/Hoàn tiền bất biến. | Cao | Có thể vô hiệu hóa/xóa quyền truy cập và dữ liệu cá nhân không cần thiết theo chính sách mà không xóa sự kiện audit bắt buộc về pháp lý/sản phẩm hoặc phá khóa ngoại. |
| 44 | Tuân thủ | Đăng nhập sai nhiều lần hoặc capability đoán được dùng để dò tài khoản, Cửa hàng hoặc Đơn hàng. | Cao | Phản hồi đồng nhất và sẵn sàng cho rate limit; không để lộ sự tồn tại của email, tư cách thành viên, vai trò, Đơn hàng hoặc capability qua nội dung hay chênh lệch thời gian. |
| 45 | Logic nghiệp vụ | Owner xử lý Đơn hàng Cửa hàng A chưa phân công hoặc đang phân công cho Staff. | Cao | Owner giữ quyền vận hành trên toàn Cửa hàng; phân công chỉ giới hạn công việc của Staff và không vô tình loại bỏ quyền giám sát của Owner. |
| 46 | Logic nghiệp vụ | Staff được phân công thực hiện từng hành động Đơn hàng không dành riêng cho Owner, còn Staff chưa được phân công thử gọi trực tiếp cùng hành động. | Cao | Ma trận hành động Staff đã thống nhất được áp dụng nhất quán: Staff được phân công chỉ thành công với chuyển trạng thái được phép; Staff chưa được phân công bị từ chối mà không có thay đổi. |
| 47 | Logic nghiệp vụ | Owner Từ chối một Yêu cầu Hoàn tiền đang chờ. | Cao | Hoàn tiền chuyển thành `rejected` đúng một lần, trạng thái Đơn hàng/thanh toán không đổi, trang Khách hàng hiển thị kết quả từ chối an toàn và retry không thể đảo thành Approved. |
| 48 | Logic nghiệp vụ | Owner Duyệt một Yêu cầu Hoàn tiền đang chờ, sau đó Khách hàng và Staff tải lại mọi bề mặt liên quan. | Cao | Mọi bề mặt hiển thị cùng một trạng thái Approved nhưng chưa thực thi; không nội dung nào nói tiền đã được trả và Staff không thể thực thi hoặc thay đổi quyết định. |

## Ma trận bao phủ

| Chiều | Nghiêm trọng | Cao | Trung bình | Thấp | Tổng |
|---|---:|---:|---:|---:|---:|
| Loại người dùng | 2 | 2 | 0 | 0 | 4 |
| Biên đầu vào | 2 | 1 | 1 | 0 | 4 |
| Thời điểm | 2 | 2 | 0 | 0 | 4 |
| Quy mô | 0 | 2 | 1 | 1 | 4 |
| Chuyển trạng thái | 1 | 3 | 0 | 0 | 4 |
| Môi trường | 0 | 2 | 2 | 0 | 4 |
| Chuỗi lỗi | 3 | 1 | 0 | 0 | 4 |
| Phân quyền | 4 | 0 | 0 | 0 | 4 |
| Toàn vẹn dữ liệu | 3 | 1 | 0 | 0 | 4 |
| Tích hợp | 0 | 4 | 0 | 0 | 4 |
| Tuân thủ | 2 | 2 | 0 | 0 | 4 |
| Logic nghiệp vụ | 0 | 4 | 0 | 0 | 4 |
| **Tổng** | **19** | **24** | **4** | **1** | **48** |

## Mục tiêu kiểm thử ưu tiên cao nhất

1. Chứng minh không có fallback ẩn danh/bootstrap trên mọi bề mặt riêng tư của Console, gồm Sản phẩm, import và file bàn giao — không chỉ Đơn hàng.
2. Chứng minh khả năng cô lập Cửa hàng B bằng mã Cửa hàng A đã biết tại các ranh giới danh sách, chi tiết, lệnh, upload và xóa.
3. Chạy đua Duyệt với Từ chối và phân công lại với hành động Staff; xác nhận rollback chính xác và chỉ có một kết quả bất biến.
4. Chạy migration S4 trên bản sao cơ sở dữ liệu S1–S3 thật, rồi so sánh số dòng, liên kết Cửa hàng, lịch sử, thanh toán, capability và Hoàn tiền trước/sau.
5. Xác nhận payload Khách hàng sau khi duyệt/từ chối chứa kết quả quyết định an toàn và không có trường Staff, thành viên, ghi chú nội bộ hoặc phiên.
6. Chạy lại các hành trình đọc Sản phẩm, tạo Đơn hàng, capability riêng tư, CORS và giao diện 375 px của Storefront công khai sau khi thêm xác thực.

## Quyết định cần có trước khi lập kế hoạch triển khai

- Xác định chính xác ma trận hành động của Staff đối với Đơn hàng được phân công, ví dụ Mark Paid, Fulfill, Cancel và Staff có được gửi Yêu cầu Hoàn tiền thay Khách hàng hay không.
- Xác định “Delete” trong S4 bao gồm gì: xóa Sản phẩm, xóa file bàn giao, xóa người dùng/tư cách thành viên hay một tập endpoint dữ liệu được bảo vệ cụ thể.
- Chọn cơ chế cô lập D1 theo brief: lớp truy cập dữ liệu trung tâm luôn giới hạn theo Cửa hàng hoặc ranh giới Durable Object cho từng Cửa hàng.
- Xác định thời hạn phiên, cách thu hồi, khôi phục đăng nhập, cách seed/mời tài khoản cho tutor và một người dùng có thể thuộc nhiều Cửa hàng hay không.
- Xác định định tuyến Storefront công khai trong S4 vẫn cố ý cố định vào Cửa hàng A hay có bộ chọn/liên kết host công khai rõ ràng.

