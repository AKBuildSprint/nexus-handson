# Báo cáo kịch bản kiểm thử: Buổi 4

Ngày: 2026-09-10. Chế độ: phân tích một lượt; người dùng không yêu cầu lặp theo số lần hoặc đến khi không còn kịch bản mới.

## Mục tiêu và phạm vi

Xây dựng các kịch bản QA có thể rà soát theo [đề bài Buổi 4](../../session-4-brief.md): gắn dữ liệu hiện có của Cửa hàng A với danh tính Chủ cửa hàng/Nhân viên đã đăng nhập, bảo đảm cách ly giữa các cửa hàng và phân công đơn hàng, bổ sung quyền quyết định hoàn tiền chỉ dành cho Chủ cửa hàng, đồng thời duy trì Storefront công khai và trang đơn hàng riêng tư của Khách hàng.

Đây là báo cáo kịch bản cho chức năng sắp triển khai, không phải danh sách lỗi hay kết quả chạy kiểm thử. Console dùng quyền khởi tạo ẩn danh hiện tại là hành vi đã được chấp nhận trong S1–S3. S4 phải thay thế cơ chế quyền này trước khi có thể mô tả hệ thống là an toàn để chia sẻ. Mức độ nghiêm trọng thể hiện tác động nếu kịch bản không đạt sau khi hoàn thành S4.

Ràng buộc: giữ nguyên bản ghi và liên kết riêng tư hiện có; dùng một bộ đánh giá quyền chung; thực thi phân quyền tại ranh giới máy chủ/lớp nghiệp vụ; chỉ thêm migration mới và giữ nguyên trách nhiệm của các package. [Đề bài S5](../../session-5-brief.md) phụ trách việc thực sự trả tiền, thay đổi quyền truy cập sản phẩm và tự động hóa. Triển khai MCP của S6, tạo bản demo xác thực mới, khởi tạo lại dữ liệu, triển khai lên môi trường và sửa mã nguồn đều nằm ngoài phạm vi báo cáo này.

Tiêu chí hoàn thành: cả sáu tiêu chí nghiệm thu của S4 đều có kịch bản cụ thể; mỗi chiều phân tích phù hợp có 3–5 tình huống kích hoạt kèm mức độ nghiêm trọng và hành vi mong đợi; các lựa chọn sản phẩm chưa thống nhất được nêu rõ.

Quy ước thuật ngữ: Chủ cửa hàng tương ứng với Owner, Nhân viên với Staff, Khách hàng với Customer, Cửa hàng với Store và Đơn hàng với Order. Giữ nguyên tên trường, mã trạng thái và tên kỹ thuật khi cần đối chiếu mã nguồn.

## Bằng chứng và những điểm hiện cần mở rộng

| Nguồn | Hiện trạng và ý nghĩa |
|---|---|
| [Đề bài S4](../../session-4-brief.md) | Sáu tiêu chí nghiệm thu là căn cứ chính. Tài liệu quy trình đầy đủ được dẫn tại ../session-4.md không có trong không gian làm việc này. |
| [README hiện tại](../../README.md) và [ghi nhận kết thúc S3](../260908-1845-s3-brief-reconciliation/phase-06-acceptance-and-deployed-continuity.md) | Console là bản demo dùng quyền khởi tạo ẩn danh. Nghiệm thu trước đó chỉ áp dụng cho môi trường cục bộ, theo ngoại lệ đã được chấp thuận rõ ràng về bằng chứng triển khai. |
| [Các route đơn hàng của Console](../../apps/worker/src/console-order-routes.ts) và [quy tắc chuyển trạng thái](../../packages/orders/src/transitions/order-transitions.ts) | Các route tạo ngữ cảnh cửa hàng/người thao tác theo cơ chế khởi tạo; hiện tại quy tắc chuyển trạng thái từ chối người dùng thật. S4 cần tích hợp danh tính thật và bộ đánh giá quyền. |
| [Truy vấn danh mục](../../packages/catalog/src/catalog-read.ts), [route sản phẩm](../../apps/worker/src/console-product-routes.ts), [route nhập dữ liệu](../../apps/worker/src/console-import-routes.ts), [dịch vụ tệp](../../packages/catalog/src/files/delivery-file.ts) | Các luồng danh mục riêng tư vẫn phụ thuộc vào cửa hàng khởi tạo, bao gồm truy vấn xem trước cấu trúc sản phẩm ghi cứng store_nexus. Chỉ thêm xác thực cho route đơn hàng sẽ để lại lỗ hổng cách ly cửa hàng. |
| [Điều phối lệnh](../../packages/orders/src/commands/order-commands.ts) và [lưu trữ lệnh](../../packages/orders/src/persistence/command-store.ts) | Danh tính người thao tác tham gia vào giá trị băm của nội dung lệnh. Việc kiểm tra quyền hiện diễn ra trước lô ghi dữ liệu; S4 cần kiểm thử điều kiện phân công/tư cách thành viên và quyền khi phát lại hoặc khôi phục lệnh. |
| [Migration đơn hàng](../../migrations/0006-order-brief-contract.sql), [migration thanh toán](../../migrations/0007-manual-payments.sql), [kiểu dữ liệu đơn hàng](../../packages/orders/src/order-types.ts) | Yêu cầu hoàn tiền chỉ có trạng thái pending; chỉ mục giới hạn một yêu cầu đang mở cũng chỉ áp dụng cho pending. Hợp đồng dữ liệu của nhật ký, lệnh và dữ liệu trả về cần được mở rộng đồng bộ qua migration mới. Phải giữ các ràng buộc về người thao tác cũ và bản chụp dữ liệu bất biến. |
| [Truy vấn đơn hàng](../../packages/orders/src/queries/order-read.ts) và [lưu trữ lệnh](../../packages/orders/src/persistence/command-store.ts) | Phát lại lệnh tái dựng yêu cầu pending ban đầu; GET hiện chọn dòng hoàn tiền đầu tiên mà không sắp xếp theo vòng đời. Khi có nhiều yêu cầu trong lịch sử, phải xác định rõ yêu cầu nào đại diện cho trạng thái hiện tại. |
| [Route Storefront](../../apps/worker/src/storefront-order-routes.ts) và [CORS](../../apps/worker/src/storefront-cors.ts) | Tạo đơn công khai được giới hạn trong Cửa hàng A. Truy cập riêng tư của Khách hàng kiểm tra mã quyền truy cập trước và trả về 404 không phân biệt các trường hợp bị từ chối. CORS không thay thế phân quyền Console. |
| [Kiểm thử lệnh hiện có](../../tests/integration/order-commands.test.ts), [kiểm thử migration](../../tests/integration/order-brief-migration.test.ts), [kiểm thử route](../../tests/integration/order-operations-routes.test.ts) | Mã kiểm thử hiện có bao phủ hoàn tác nguyên tử, phát lại lệnh, cách ly cửa hàng khởi tạo và việc yêu cầu hoàn tiền cùng tồn tại với hoàn tất đơn hàng. Đây là căn cứ kiểm thử hồi quy, không phải bằng chứng xác thực của S4. |

## Phạm vi các chiều phân tích

Áp dụng cả 12 chiều: Nhóm người dùng, Đầu vào biên, Thời điểm và đồng thời, Quy mô, Chuyển trạng thái, Môi trường, Lỗi dây chuyền, Phân quyền, Toàn vẹn dữ liệu, Tích hợp, Tuân thủ, Quy tắc nghiệp vụ.

Không bỏ qua toàn bộ chiều nào. Tuân thủ chỉ giới hạn ở yêu cầu riêng tư và nhật ký của đề bài; báo cáo không đưa ra khẳng định về tuân thủ pháp luật. Không đưa vào các luồng OAuth riêng của nhà cung cấp, thực thi thanh toán bên ngoài và kiểm thử giao tiếp MCP vì S4 chưa lựa chọn các chức năng này. Kịch bản về cách truyền thông tin phiên/CSRF vẫn phụ thuộc vào lựa chọn xác thực.

## Các kịch bản

| # | Chiều phân tích | Kịch bản | Mức độ | Hành vi mong đợi |
|---|---|---|---|---|
| 01 | Nhóm người dùng | Chủ Cửa hàng A đăng nhập khi hệ thống đã có dữ liệu S1–S3. | Cao | Chủ cửa hàng thấy toàn bộ sản phẩm, khách hàng, đơn hàng và lịch sử hiện có, không cần khởi tạo lại dữ liệu hoặc thay ID. |
| 02 | Nhóm người dùng | Nhân viên Cửa hàng A mở đơn pending được giao, ghi nhận thanh toán thủ công rồi hoàn tất đơn. | Cao | Mỗi thao tác được phép đều thành công với danh tính Nhân viên thật và tuân theo quy tắc chuyển trạng thái hiện có; được giao đơn không đồng nghĩa với có quyền riêng của Chủ cửa hàng. |
| 03 | Nhóm người dùng | Khách hàng ẩn danh xem sản phẩm và tạo đơn trong khi Console yêu cầu đăng nhập. | Cao | Xem sản phẩm công khai và tạo đơn cho Cửa hàng A vẫn hoạt động mà không cần phiên Console; mã quyền truy cập riêng tư vẫn được trả về/sử dụng theo hợp đồng hiện tại. |
| 04 | Nhóm người dùng | Tài khoản hợp lệ nhưng không có tư cách thành viên, có vai trò không xác định hoặc chọn cửa hàng không xác định. | Nghiêm trọng | Từ chối đọc và ghi dữ liệu riêng tư khi không xác định được quyền. Không yêu cầu nào tự chuyển về quyền Chủ cửa hàng khởi tạo hoặc Cửa hàng A. |
| 05 | Đầu vào biên | Đăng nhập nhận thông tin xác thực rỗng, sai định dạng, quá dài hoặc giá trị phiên giả mạo. | Cao | Kiểm tra/xác thực thất bại, không cấp phiên hay trả dữ liệu riêng tư; xử lý lỗi không làm lộ thông tin xác thực hoặc bản ghi người dùng. Giới hạn cụ thể theo hợp đồng xác thực được chọn. |
| 06 | Đầu vào biên | Phân công dùng người nhận rỗng/không xác định, ID Khách hàng hoặc ID Nhân viên chỉ thuộc Cửa hàng B. | Nghiêm trọng | Không lưu phân công không hợp lệ hoặc xuyên cửa hàng. Chỉ cho phép không có người nhận nếu thao tác bỏ phân công đã được chấp thuận rõ ràng. |
| 07 | Đầu vào biên | Yêu cầu riêng tư gửi role=owner, actorId, storeId hoặc trường phân công ngoài hợp đồng cho phép của nội dung, header hoặc query. | Nghiêm trọng | Trường do bên gọi gửi không thể thay thế cửa hàng, người thao tác hoặc vai trò đã xác thực; kiểm tra lệnh nghiêm ngặt từ chối trường không được hỗ trợ. |
| 08 | Đầu vào biên | Tên, lý do hoàn tiền và giá trị tìm kiếm chứa tiếng Việt, dấu Unicode tổ hợp, mã đánh dấu, dấu nháy, ký tự phần trăm và gạch dưới. | Cao | Văn bản hợp lệ được giữ nguyên và hiển thị dưới dạng văn bản; tìm kiếm giữ cách hiểu ký tự theo tài liệu. Giá trị mã hóa không thể chèn SQL/script hoặc vượt kiểm tra ID/cửa hàng. |
| 09 | Thời điểm và đồng thời | Chủ cửa hàng giao lại đơn trong lúc Nhân viên cũ đang gửi thao tác thay đổi dữ liệu. | Nghiêm trọng | Có thứ tự thực thi nguyên tử rõ ràng: thao tác Nhân viên được chốt trước có thể thành công; thao tác đứng sau việc giao lại phải thất bại. Chỉ kiểm tra quyền trước đó không đủ để cho phép lần ghi sau. |
| 10 | Thời điểm và đồng thời | Hai phiên Chủ cửa hàng đồng thời Phê duyệt và Từ chối cùng một yêu cầu hoàn tiền pending. | Cao | Chỉ lưu một quyết định, đúng người quyết định và kết quả lịch sử. Thao tác thua nhận lỗi xung đột và không thể ghi đè bên thắng. |
| 11 | Thời điểm và đồng thời | Quyết định đã được chốt nhưng phản hồi HTTP bị mất; Chủ cửa hàng thử lại cùng khóa rồi bấm hai lần bằng khóa mới. | Cao | Không phát sinh quyết định/lịch sử trùng. Phát lại cùng khóa giữ kết quả ban đầu; khóa mới không thể quyết định lại yêu cầu đó. |
| 12 | Thời điểm và đồng thời | Tư cách thành viên hoặc phân công của Nhân viên bị thu hồi sau một thao tác thành công, rồi Nhân viên phát lại khóa lệnh cũ. | Nghiêm trọng | Kiểm tra quyền hiện tại trước khi trả kết quả phát lại. Kết quả thành công đã lưu không khôi phục quyền ghi bị thu hồi hoặc tạo thêm tác động phụ. |
| 13 | Thời điểm và đồng thời | Hai phiên Chủ cửa hàng cùng giao lại một đơn từ cùng trạng thái phân công ban đầu. | Cao | Phân công cuối cùng và lịch sử khớp với thứ tự chốt dữ liệu. Chính sách xử lý chỉnh sửa trên dữ liệu cũ phải báo xung đột hoặc cho phép rõ ràng lần chốt sau; không cập nhật nào âm thầm bỏ qua kiểm tra thành viên. |
| 14 | Quy mô | Cửa hàng B chưa có sản phẩm, khách hàng, đơn hàng hoặc Nhân viên đủ điều kiện nhận đơn. | Trung bình | Trạng thái rỗng chỉ phản ánh Cửa hàng B, không lấy bản ghi của Cửa hàng A. Chưa thể phân công cho đến khi có Nhân viên hợp lệ. |
| 15 | Quy mô | Danh sách đơn hàng có 0, 1, 25 và 26 dòng phù hợp, trong đó có một đơn gồm 10 dòng hàng. | Cao | Ranh giới phân trang không làm trùng đơn. Số liệu tổng hợp và hasOrders dùng cửa hàng/phạm vi đọc đã được cấp quyền cùng bộ lọc phía máy chủ, không tính từ trang hiện tại. |
| 16 | Quy mô | Con trỏ phân trang hoặc phản hồi danh sách đến chậm của Cửa hàng A được dùng lại sau khi đổi danh tính hoặc ngữ cảnh cửa hàng. | Nghiêm trọng | Truy vấn máy chủ vẫn giới hạn theo tư cách thành viên hiện tại, còn giao diện bỏ phản hồi của ngữ cảnh cũ. Con trỏ khác phạm vi bị từ chối hoặc được áp dụng lại phạm vi an toàn mà không lộ dữ liệu cũ. |
| 17 | Quy mô | Người hướng dẫn diễn tập migration với đơn/lịch sử đã có dữ liệu, tệp cần giữ lại và đợt nhập danh mục 500 dòng gần giới hạn. | Cao | Migration và ranh giới cửa hàng đã chọn hoạt động trong giới hạn thực tế của nền tảng, không mất bản ghi hoặc bỏ qua quyền; ghi lại số đo thực tế thay vì giả định. |
| 18 | Chuyển trạng thái | Chủ cửa hàng giao một đơn chưa có người nhận, rồi giao lại từ Nhân viên A1 sang A2. | Cao | Phân công mới được lưu, A2 nhận quyền thay đổi được phép, A1 mất quyền đó và lịch sử phân công ghi đúng Chủ cửa hàng thực hiện. |
| 19 | Chuyển trạng thái | Chủ cửa hàng quyết định yêu cầu hoàn tiền pending của đơn paid và đơn fulfilled, kiểm tra cả Phê duyệt lẫn Từ chối. | Cao | Yêu cầu chuyển sang approved hoặc rejected đúng một lần. Đơn vẫn ở paid hoặc fulfilled; phê duyệt được mô tả là đang chờ thực hiện hoàn tiền. |
| 20 | Chuyển trạng thái | Khách hàng gửi lại sau khi bị từ chối hoặc khi yêu cầu đã được phê duyệt vẫn chờ thực hiện. | Cao | Chính sách gửi lại đã thống nhất được thực thi nguyên tử. Yêu cầu đã phê duyệt không được vô tình cho phép thêm một lần trả tiền có thể thực thi; cần quyết định sản phẩm về từ chối/mở lại. |
| 21 | Chuyển trạng thái | Chủ cửa hàng quyết định yêu cầu không tồn tại, đã có quyết định hoặc thuộc đơn không đủ điều kiện; Nhân viên gọi trực tiếp cùng route. | Cao | Không tự tạo yêu cầu hoặc thay đổi trạng thái. Điều kiện nghiệp vụ và quyền Chủ cửa hàng được kiểm tra phía máy chủ, với hành vi từ chối/xung đột nhất quán. |
| 22 | Môi trường | Ở chiều rộng 375 px, Chủ cửa hàng đăng nhập, phân công và quyết định hoàn tiền; Khách hàng xem quyết định. | Trung bình | Trang không cuộn ngang và không có điều khiển chính ngoài tầm truy cập. Thao tác chính tiếp tục dùng nền color-accent và chữ color-accent-ink. |
| 23 | Môi trường | Người dùng bàn phím và trình đọc màn hình đăng nhập, chọn người nhận đơn, xác nhận và xử lý trạng thái bị từ chối/hết phiên. | Cao | Điều khiển có tên, thứ tự focus dễ dự đoán và thông báo lỗi/trạng thái dễ tiếp cận; quyền và quyết định không được thể hiện chỉ bằng màu sắc. |
| 24 | Môi trường | Trình duyệt dùng chung đăng xuất Cửa hàng A, bấm Quay lại và đăng nhập Cửa hàng B khi các yêu cầu cũ vẫn đang chờ. | Nghiêm trọng | Ứng dụng xóa nội dung riêng tư cũ, bỏ phản hồi lỗi thời và không nạp lại dữ liệu Cửa hàng A vào Cửa hàng B. Đăng xuất vô hiệu hóa phiên dùng cho yêu cầu riêng tư mới. |
| 25 | Môi trường | Console/API chạy trên một origin, Storefront trên origin khác, cả ở cục bộ và khi triển khai sau này; đồng hồ máy khách lệch máy chủ. | Cao | Phiên Console hoạt động theo chính sách truyền thông tin phiên/origin đã chọn; Storefront công khai vẫn độc lập. Hết hạn phiên dựa trên máy chủ và thời điểm quyết định không gây hiểu nhầm. |
| 26 | Lỗi dây chuyền | Tra cứu phiên hoặc tư cách thành viên lỗi trong lúc đọc hoặc sửa dữ liệu riêng tư. | Nghiêm trọng | Từ chối yêu cầu khi không thể xác minh quyền và trả lỗi vận hành đã loại thông tin nhạy cảm. Lỗi hạ tầng không bao giờ tự chuyển về quyền ẩn danh/khởi tạo. |
| 27 | Lỗi dây chuyền | Lưu trữ lỗi sau lần ghi phân công/quyết định hoàn tiền đầu tiên nhưng trước khi ghi xong lịch sử và sổ lệnh. | Nghiêm trọng | Thao tác không để lại quyết định, phân công, lịch sử hoặc bản ghi lệnh thành công dang dở. Thử lại sau khôi phục tạo đúng một kết quả hoàn chỉnh. |
| 28 | Lỗi dây chuyền | Trình duyệt hết thời gian chờ ngay sau thao tác phân công hoặc quyết định hoàn tiền. | Trung bình | Giao diện coi kết quả là chưa xác định, giữ định danh dùng để thử lại và tải lại trạng thái hiện tại. Không khẳng định đã trả tiền hoặc tự gửi quyết định trái ngược. |
| 29 | Lỗi dây chuyền | Migration trên dữ liệu hiện có thất bại hoặc phiên bản Worker ẩn danh cũ vẫn phục vụ yêu cầu trong lúc chuyển sang xác thực. | Nghiêm trọng | Diễn tập dùng bản sao lưu đã kiểm chứng và kiểm soát việc chuyển đổi thành phần ghi dữ liệu. Khôi phục giữ nguyên cấu trúc liên kết dữ liệu; không thành phần ghi cũ nào còn truy cập công khai có thể vượt phân quyền Console mới. |
| 30 | Phân quyền | Người gọi ẩn danh và người giữ mã quyền Khách hàng gọi trực tiếp endpoint sản phẩm, đơn hàng, xem trước cấu trúc, nhập dữ liệu và tệp bàn giao của Console. | Nghiêm trọng | Bộ đánh giá chung từ chối thao tác riêng tư bất kể nút có hiển thị, phương thức HTTP hay việc có mã quyền Khách hàng; yêu cầu bị từ chối không gây tác động phụ lên kho dữ liệu riêng tư. |
| 31 | Phân quyền | Nhân viên sửa trực tiếp đơn của Nhân viên khác hoặc đơn chưa phân công, gồm thanh toán, hoàn tất, hủy và gửi yêu cầu hoàn tiền. | Nghiêm trọng | Mọi thay đổi đơn đều kiểm tra tư cách thành viên và phân công hiện tại trên máy chủ. Các nhãn thao tác được phép cũng dựa trên cùng chính sách. |
| 32 | Phân quyền | Nhân viên gọi trực tiếp Phê duyệt, Từ chối, phân công/giao lại và các thao tác Xóa dữ liệu được bảo vệ đã thống nhất. | Nghiêm trọng | Từ chối quyền riêng của Chủ cửa hàng ngay cả với đơn được giao hoặc yêu cầu/khóa sao chép từ Chủ cửa hàng. Chủ cửa hàng thao tác thành công vẫn phải tuân theo trạng thái và ràng buộc lưu giữ dữ liệu. |
| 33 | Phân quyền | Chủ/Nhân viên Cửa hàng B gửi ID đơn/sản phẩm/biến thể của Cửa hàng A, trộn ID cha-con, slug hoặc mã tham chiếu thanh toán qua mọi luồng riêng tư có thể gọi. | Nghiêm trọng | Không dữ liệu, số đếm, thông tin tồn tại hay tác động phụ nào của Cửa hàng A vượt ranh giới. Cơ chế giới hạn theo cửa hàng bao phủ tra cứu, nối bảng, ghi và thao tác lưu trữ. |
| 34 | Toàn vẹn dữ liệu | Migration S4 gắn dữ liệu khởi tạo với Cửa hàng A, gồm Khách hàng, bản chụp dòng hàng, giá trị băm mã quyền, thanh toán, yêu cầu hoàn tiền và bản ghi chống xử lý lặp. | Nghiêm trọng | Giữ nguyên ID, mã tham chiếu, tổng tiền, định danh bản chụp/tệp và mọi quan hệ. Liên kết riêng tư hiện có vẫn cấp quyền cho đúng đơn ban đầu. |
| 35 | Toàn vẹn dữ liệu | Lịch sử khởi tạo cũ có ID người thao tác null, sau đó Chủ cửa hàng và Nhân viên mới thao tác bằng danh tính thật. | Cao | Sự kiện cũ vẫn được ghi nhãn trung thực là dữ liệu cũ/khởi tạo và gắn với Cửa hàng A qua ánh xạ chủ sở hữu rõ ràng; sự kiện mới ghi đúng người dùng đã xác thực. Migration không bịa ra lần đăng nhập trong quá khứ. |
| 36 | Toàn vẹn dữ liệu | Dữ liệu kiểm thử của A và B dùng cùng slug/SKU sản phẩm hoặc email Khách hàng; phân công/hoàn tiền cố trộn cửa hàng. | Nghiêm trọng | Định danh trong phạm vi cửa hàng được cùng tồn tại nếu lược đồ cho phép; định danh toàn cục giữ hợp đồng hiện có; không thể lưu quan hệ xuyên cửa hàng. Thiết lập B không khởi tạo lại A. |
| 37 | Toàn vẹn dữ liệu | Yêu cầu approved/rejected cùng tồn tại với các yêu cầu lịch sử, rồi Khách hàng phát lại lệnh gửi yêu cầu ban đầu. | Cao | Phát lại trả kết quả bất biến ban đầu; GET hiện tại chọn nhất quán yêu cầu/quyết định đang áp dụng. Truy vấn và ràng buộc duy nhất phải được cập nhật đồng bộ. |
| 38 | Tích hợp | Cùng người thao tác/tài nguyên/hành động được thực hiện qua điều hướng Console, HTTP trực tiếp và điểm gọi lệnh nghiệp vụ. | Nghiêm trọng | Bộ đánh giá chung và ngữ cảnh cửa hàng đáng tin cậy đưa ra quyết định nhất quán; bên gọi dịch vụ riêng tư không thể bỏ qua phân quyền. Khả năng tái sử dụng cho MCP sau này chỉ là điểm mở rộng, chưa triển khai trong S4. |
| 39 | Tích hợp | Bản dựng Console hoặc Storefront cũ gửi hợp đồng/nội dung yêu cầu trước đó trong lúc triển khai S4. | Cao | Máy khách được hỗ trợ vẫn hoạt động nhất quán; máy khách không tương thích nhận hướng xử lý tải lại/xung đột rõ ràng và không gây thay đổi dữ liệu. Mã quyền Khách hàng sai vẫn nhận 404 không phân biệt như hiện tại trước lỗi hợp đồng. |
| 40 | Tích hợp | Khách hàng dùng luồng tạo đơn công khai/đọc riêng tư/yêu cầu hoàn tiền khác origin, trong khi kẻ tấn công gửi thao tác ghi Console từ website khác. | Nghiêm trọng | Danh sách cho phép công khai và header mã quyền tiếp tục hoạt động. Phân quyền riêng tư độc lập với CORS; phiên dựa trên cookie cũng thực thi biện pháp chống CSRF đã chọn. |
| 41 | Tích hợp | Thêm xác thực tại ranh giới Worker nhưng truy vấn danh mục, xem trước cấu trúc, nhập CSV hoặc dịch vụ tệp vẫn ghi cứng store_nexus. | Nghiêm trọng | Mọi luồng riêng tư nhận cửa hàng đã chọn và đã xác minh qua ranh giới giới hạn phạm vi. Thao tác của B chỉ tác động B; Storefront công khai vẫn được gắn rõ ràng với A. |
| 42 | Tích hợp | Người đã đăng nhập dùng lại khóa của người khác hoặc Chủ cửa hàng mới thử lại khóa lệnh từ thời khởi tạo. | Cao | Phát lại không được âm thầm đổi danh tính người thao tác hoặc tạo thanh toán/quyết định trùng. Giữ ràng buộc nội dung/người thao tác và khóa cũ đã dành riêng theo tài liệu, hoặc xác định rõ cách chuyển đổi có phiên bản. |
| 43 | Tuân thủ | Khách hàng đọc quyết định approved/rejected rồi kiểm tra toàn bộ phản hồi, mã nguồn trang và dữ liệu lồng trong dòng hàng. | Nghiêm trọng | Chỉ có trường quyết định an toàn cho Khách hàng; không có danh tính Nhân viên/Chủ cửa hàng, phân công, ghi chú nội bộ, bằng chứng thanh toán bên ngoài hoặc khóa tệp riêng tư. |
| 44 | Tuân thủ | Đăng nhập hoặc truy cập bằng mã quyền thất bại và thông tin chẩn đoán được ghi vào log hoặc tài liệu QA. | Nghiêm trọng | Không ghi hoặc công bố bí mật phiên, thông tin xác thực, mã quyền Khách hàng nguyên gốc và URL đơn riêng tư; lỗi dùng mã chẩn đoán đã loại thông tin nhạy cảm. |
| 45 | Tuân thủ | Người dùng đổi tên hiển thị hoặc mất tư cách thành viên sau khi phân công hoặc quyết định hoàn tiền. | Cao | Nhật ký dành cho người có quyền vẫn giữ định danh người thật và thời điểm sự kiện ổn định, không phụ thuộc tên hiển thị hiện tại hoặc cấp lại quyền truy cập cho người dùng cũ. |
| 46 | Tuân thủ | Chủ cửa hàng dùng thao tác Xóa đã được chấp thuận với dữ liệu đang được lịch sử đơn hoặc bản chụp bàn giao bất biến tham chiếu. | Cao | Quyền Chủ cửa hàng không vượt qua toàn vẹn tham chiếu hoặc quy tắc giữ tệp. Cách xóa/lưu trữ đã chọn phải bảo toàn lịch sử cần thiết và bản chụp nội dung đã mua. |
| 47 | Quy tắc nghiệp vụ | Phê duyệt hoàn tiền cho đơn thanh toán thủ công hoặc đơn paid có trạng thái legacy_unrecorded. | Cao | Phê duyệt chỉ ghi một quyết định. Cả hai trường hợp đều không tạo bằng chứng đảo giao dịch hoặc đánh dấu đã trả tiền; việc thiếu bằng chứng thanh toán cũ vẫn được thể hiện rõ để S5 xử lý. |
| 48 | Quy tắc nghiệp vụ | Nhân viên được giao đơn thử hoàn tất đơn pending/canceled hoặc hủy đơn paid/fulfilled. | Cao | Phân công không vượt qua quy tắc chuyển trạng thái hiện có. Theo hợp đồng hiện tại, chỉ pending mới chuyển sang paid/canceled và chỉ paid mới chuyển sang fulfilled. |
| 49 | Quy tắc nghiệp vụ | Chủ cửa hàng giao đơn cho người là Nhân viên ở B nhưng là Chủ cửa hàng, không phải thành viên hoặc không hoạt động ở A. | Cao | Điều kiện nhận đơn dựa trên tư cách thành viên ở cửa hàng đích, không dựa trên vai trò toàn cục hoặc tư cách ở nơi khác. Phải quyết định rõ nếu hỗ trợ giao đơn cho Chủ cửa hàng. |
| 50 | Quy tắc nghiệp vụ | Trình duyệt đang đăng nhập B gửi đơn công khai với ID B được chèn vào, tổng tiền bị sửa hoặc giỏ hàng trộn cửa hàng. | Nghiêm trọng | Tạo đơn công khai vẫn giới hạn ở A và lấy tổng tiền từ bản chụp danh mục hợp lệ; danh tính Console không thể đổi cửa hàng đích. Dòng hàng/trường không hợp lệ không tạo đơn dang dở. |
| 51 | Quy tắc nghiệp vụ | Chủ cửa hàng phê duyệt hoàn tiền trong khi Nhân viên được giao đang hoàn tất cùng đơn paid. | Cao | Áp dụng chính sách rõ ràng về thứ tự và hoàn tất đơn. Bản thân phê duyệt không đánh dấu đơn refunded; giữ việc yêu cầu hoàn tiền cùng tồn tại với hoàn tất đơn trừ khi quyết định được chấp thuận chủ động thay đổi quy tắc này. |

## Tổng hợp

- Nghiêm trọng (Critical): 22.
- Cao (High): 26.
- Trung bình (Medium): 3.
- Thấp (Low): 0.
- Tổng: 51 kịch bản trên 12 chiều phân tích.

| Chiều phân tích | Nghiêm trọng | Cao | Trung bình | Thấp | Tổng |
|---|---:|---:|---:|---:|---:|
| Nhóm người dùng | 1 | 3 | 0 | 0 | 4 |
| Đầu vào biên | 2 | 2 | 0 | 0 | 4 |
| Thời điểm và đồng thời | 2 | 3 | 0 | 0 | 5 |
| Quy mô | 1 | 2 | 1 | 0 | 4 |
| Chuyển trạng thái | 0 | 4 | 0 | 0 | 4 |
| Môi trường | 1 | 2 | 1 | 0 | 4 |
| Lỗi dây chuyền | 3 | 0 | 1 | 0 | 4 |
| Phân quyền | 4 | 0 | 0 | 0 | 4 |
| Toàn vẹn dữ liệu | 2 | 2 | 0 | 0 | 4 |
| Tích hợp | 3 | 2 | 0 | 0 | 5 |
| Tuân thủ | 2 | 2 | 0 | 0 | 4 |
| Quy tắc nghiệp vụ | 1 | 4 | 0 | 0 | 5 |

## Đối chiếu tiêu chí nghiệm thu

| Tiêu chí Buổi 4 | Số kịch bản |
|---|---|
| Chủ Cửa hàng A đăng nhập và giữ nguyên dữ liệu/lịch sử hiện có. | 01, 34, 35 |
| Nhân viên xử lý công việc được giao; thao tác trực tiếp trên đơn của người khác/chưa phân công bị từ chối. | 02, 09, 18, 31, 48 |
| Cửa hàng B không thể đọc/thao tác qua URL hoặc ID của A. | 04, 16, 33, 41, 36 |
| Nhân viên không thể quyết định hoàn tiền/Xóa; Chủ cửa hàng quyết định một lần, ghi đúng người và không tuyên bố tiền đã được chuyển trả. | 10, 11, 19, 32, 47 |
| Trang Khách hàng tương ứng hiển thị quyết định an toàn; token đoán được/token khác và dữ liệu công khai không làm lộ thông tin riêng tư. | 19, 37, 39, 43 |
| Storefront công khai vẫn đọc sản phẩm và tạo đơn của A. | 03, 25, 40, 50 |

Với tiêu chí trang riêng tư, cần chạy rõ ràng ma trận mã quyền hiện có gồm thiếu/sai định dạng/sai đơn/đoán mã sau cả kết quả Approved lẫn Rejected, kết hợp header hợp đồng đúng phiên bản và lỗi thời. Phản hồi phải tiếp tục không phân biệt các trường hợp từ chối và không chứa trường riêng tư.

## Các hạng mục cần kiểm chứng trước

1. Diễn tập migration trên dữ liệu S3 đã có sẵn và được sao lưu, bao gồm lịch sử cũ, khóa lệnh và các liên kết riêng tư đang hoạt động. Chủ động gây lỗi migration và chứng minh có thể khôi phục mà không cần đặt lại dữ liệu.
2. Kiểm tra trực tiếp ma trận người thao tác × cửa hàng × tài nguyên × hành động qua HTTP và bộ đánh giá quyền. Bao gồm xem trước cấu trúc sản phẩm, nhập CSV và thao tác với tệp bàn giao, không chỉ các endpoint đơn hàng.
3. Cho thao tác giao lại/thu hồi quyền chạy đồng thời với lệnh mới, phát lại lệnh dùng cùng khóa và các nhánh khôi phục khi xung đột. Kiểm tra dữ liệu và lịch sử đã lưu, không chỉ phản hồi HTTP.
4. Cho Phê duyệt/Từ chối và các quyết định trùng lặp chạy đồng thời; chủ động gây lỗi lô ghi dữ liệu. So sánh kết quả phát lại lệnh bất biến với phản hồi GET hiện tại dành cho Khách hàng và chứng minh tiền chưa được chuyển trả.
5. Dùng các phiên trình duyệt riêng biệt với tài khoản Chủ cửa hàng/Nhân viên/Cửa hàng B thật, cùng một phiên Storefront ẩn danh, để chứng minh cả sáu tiêu chí. Kiểm tra các luồng thao tác ở chiều rộng 375 px và bằng bàn phím.

Sử dụng các lớp kiểm thử hiện có theo mức độ rủi ro trong [hướng dẫn kiểm thử](../../tests/AGENTS.md): kiểm thử thuần cho bộ đánh giá quyền, kiểm thử tích hợp D1/R2/HTTP, kiểm thử hợp đồng React trên trình duyệt và E2E với hai origin. Khi quyền bị từ chối, cần xác minh cả tính riêng tư của phản hồi lẫn việc trạng thái nghiệp vụ/lưu trữ liên quan không bị thay đổi. Muốn chứng minh ranh giới cửa hàng, cần một bộ dữ liệu kiểm thử Cửa hàng B thật, không chỉ giả lập ID cửa hàng.

## Kiểm chứng và giới hạn

Báo cáo này dựa trên việc đọc mã nguồn và một lượt rà soát độc lập, chỉ đọc, về các tình huống chạy đồng thời liên quan đến hoàn tiền/migration. Không chạy kiểm thử ứng dụng, migration, ghi cơ sở dữ liệu, khởi động máy chủ hay triển khai. Các chỉnh sửa định dạng tiền tệ và kiểm thử hiện có được giữ nguyên.

Báo cáo đã hoàn tất trong phạm vi xây dựng các kịch bản. Báo cáo không chứng minh bất kỳ kịch bản S4 nào đã vượt qua kiểm thử. Các liên kết mã nguồn và số lượng kịch bản được kiểm tra khi viết báo cáo. Tài liệu S3 cũ có liên kết đến tệp contracts.md không tồn tại trong bản mã nguồn này; vì vậy, báo cáo dựa trên các đề bài, mã nguồn và kiểm thử hiện có.

## Các câu hỏi chưa được chốt

1. **Danh tính và ranh giới cửa hàng:** Dùng phương thức đăng nhập/cấp tài khoản nào để tạo tài khoản Chủ cửa hàng/Nhân viên, và người hướng dẫn sẽ diễn tập với một lớp bao tập trung giới hạn theo cửa hàng hay ranh giới bằng Durable Object? Cần chốt cơ chế vô hiệu hóa phiên và cách chọn cửa hàng đáng tin cậy trong cùng hợp đồng này.
2. **Ma trận quyền và Xóa:** Nhân viên được đọc mọi đơn trong cùng cửa hàng hay chỉ đơn được giao, và được thực hiện những thao tác nào với danh mục/nhập dữ liệu/tệp? Xóa cụ thể áp dụng cho tài nguyên được bảo vệ nào? Các route sản phẩm hiện không có Product DELETE; đã có DELETE cho tệp bàn giao. Giữ các chức năng quản lý trong phạm vi điều hướng Products/Orders được phép.
3. **Xung đột phân công:** Có hỗ trợ bỏ phân công không, Chủ cửa hàng có thể là người được giao không, và hai thao tác giao lại đồng thời dựa trên dữ liệu cũ phải báo xung đột hay cho phép lần chốt sau ghi đè? Các thao tác thay đổi dữ liệu và phát lại lệnh sau khi bị thu hồi quyền vẫn phải bị từ chối.
4. **Vòng đời yêu cầu hoàn tiền:** Khách hàng có được gửi yêu cầu mới sau khi bị từ chối không? Việc phê duyệt có chặn hoàn tất đơn không, và trạng thái nào được tính là đang mở khi yêu cầu đã được duyệt nhưng chờ thực hiện? Chỉ mục hiện chỉ áp dụng cho pending và dữ liệu hoàn tiền trả về chưa có thứ tự xác định không thể tự quyết định các chính sách này.
5. **Quyền sở hữu lịch sử:** Nên liên kết lịch sử của Chủ cửa hàng khởi tạo trước đây với Chủ Cửa hàng A mới như thế nào để vẫn phản ánh đúng nguồn gốc lịch sử, giữ các ràng buộc người thao tác null và định danh lệnh hiện có?
6. **Chuyển đổi máy khách:** S4 có thể mở rộng hợp đồng đơn hàng hiện tại mà vẫn tương thích hay cần đổi phiên bản? Cần xác định cách xử lý máy khách cũ và chính sách 401/403/404 cho Console riêng tư mà không làm suy yếu hợp đồng từ chối truy cập bằng mã quyền Khách hàng hiện có.
