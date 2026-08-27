# Báo cáo brainstorm — Nexus Session 2 Storefront và Orders

- **Trạng thái:** Đã chốt, sẵn sàng chuyển sang planning
- **Cập nhật:** 2026-08-27
- **Nguồn nền tảng:** [`session-1-brief.md`](../../session-1-brief.md), S1 Product Catalog hiện có và quyết định sản phẩm đã xác nhận trong trao đổi ngày 2026-08-27
- **Giới hạn tài liệu:** Không dùng S2 brief, S2 report hoặc S2 plan có sẵn làm nguồn quyết định.

## 1. Outcome

Ship S2 cho Nexus với một Storefront độc lập dùng chung backend và catalog của S1:

1. Operator sửa Product hoặc Variant trong Console thì Storefront đọc lại catalog hiện tại và phản ánh thay đổi.
2. Customer chọn một Simple Product hoặc một enabled Variant hợp lệ của Variant Product, nhập name/email và đặt một Order.
3. Server là monetary authority: xác thực selection, tự resolve effective price/currency, tính amount và total, rồi persist lịch sử mua.
4. Customer mở lại private Order page để xem reference, selection tại thời điểm mua, quantity, amount, currency, `pending_payment` và payment next-step tĩnh.
5. Cùng persisted Customer, Order, line và Variant selection xuất hiện trong Console.

## 2. Nền tảng S1 được tái sử dụng

### 2.1 Shared catalog và Console

- D1 đã sở hữu một bootstrap Store, Products, option groups/values và Variants; Product/Variant identities ổn định và scoped theo Store.
- Console hiện tạo/sửa catalog qua `/api/console/products`; S2 không tạo catalog store, catalog API hay price source thứ hai.
- `GET /api/storefront/products` đã trả Customer-safe projection của active Products, enabled/current-schema Variants, option selections và effective minor-unit prices.
- Public catalog query D1 khi nhận request và response dùng `Cache-Control: no-store`; Storefront refetch khi tải/trở lại surface là đủ để thấy catalog edit. Realtime synchronization không thuộc S2.

### 2.2 Server-side catalog truth và snapshot

- Catalog dùng integer minor-unit pricing; Product base price và nullable Variant override đã có effective-price rule.
- `createOrderItemCatalogSnapshotResolver()` đã xác thực Product active và, với Variant Product, Variant enabled/current-schema; resolver copy Product/Variant identity, SKU, selected option labels/values, effective price/currency, access content và immutable private-file key.
- S2 dùng resolver này ở server khi tạo Order. Browser không gửi hoặc quyết định monetary fields.
- Public catalog đã loại private delivery/storage fields. Internal Order-line snapshot giữ dữ liệu private cho S5, nhưng Customer Order response không được trả access content hoặc private-file identity.

### 2.3 Runtime conventions

- S1 đã có Cloudflare Worker, D1 `DB`, private R2 `FILES`, Worker route dispatch, JSON error envelope và workerd/browser test foundation.
- S1 dùng aggregate D1 writes qua `db.batch(...)`. S2 phải giữ yêu cầu atomic outcome cho Customer create/reuse, Order aggregate, private access và idempotency result; partial persistence là không chấp nhận được.

## 3. S2 capabilities cần bổ sung

1. **Storefront app độc lập:** một client build/deploy riêng, gọi shared Nexus API thay vì dùng hoặc sao chép Console bundle.
2. **CORS policy:** Worker chỉ chấp nhận configured Storefront origin cùng methods và headers thực sự cần cho Storefront request contract.
3. **Catalog shopping UI:** catalog browsing, Simple Product selection, required Variant selection, quantity `1–99`, Customer name/email form và submit/retry UX.
4. **Order aggregate:** Customer find-or-create theo normalized email scoped Store, latest-name update, Order `pending_payment`, exactly one line, purchase-time Customer snapshot, internal Catalog snapshot, initial history và static payment next-step.
5. **Private customer access:** private capability URL có thể mở lại; reference/email không cấp quyền; invalid/altered token và cross-Store reference không trả Order.
6. **Idempotent creation:** double submit/retry trả về cùng Order result và không ghi Order thứ hai.
7. **Console Orders:** API/UI để hiển thị cùng persisted Customer, `pending_payment` Order, line, quantity, amount và Variant selection.

## 4. Các quyết định đã chốt

### 4.1 App boundary và catalog ownership

**Quyết định:** Storefront là app độc lập, dùng chung backend/catalog hiện có với Console.

- Không tạo D1 catalog thứ hai, sync job, catalog replica hay Storefront-owned price table.
- Storefront dùng public catalog projection để hiển thị và lựa chọn; Order create route tự xác minh lại current catalog state.
- CORS là cần thiết vì Storefront có origin deploy riêng. Exact request contract được planning quyết định, không khóa header cụ thể trong báo cáo này.

### 4.2 One-line Order và selection rules

**Quyết định:** Mỗi Order có đúng một Product line; đây là deliberate simplification của S2.

- Quantity là integer từ `1` đến `99`.
- Simple Product không có Variant và không nhận Variant selection.
- Variant Product bắt buộc chọn một enabled Variant hợp lệ.
- S2 chứng minh hai journeys riêng: một Simple Product Order và một Variant Product Order.
- Cart, multi-line Order, mixed-currency aggregation và quantity ngoài giới hạn không thuộc S2.

### 4.3 Customer identity và purchase-time history

**Quyết định:** Customer nhập name và email. Server normalize email; trong cùng Store, normalized email tái sử dụng một Customer record.

- Name mới nhất cập nhật Customer hiện tại.
- Mỗi Order persist Customer data tại thời điểm mua; Customer profile thay đổi sau đó không rewrite lịch sử Order.
- Customer email/reference không phải credential để đọc Order.

### 4.4 Order state và payment boundary

**Quyết định:** Order mới có status `pending_payment`.

- Customer thấy static payment next-step gắn với stable unique Order reference.
- Không có payment link, invoice, provider checkout, webhook hoặc external payment dependency.
- Không được báo cáo `pending_payment` là paid, fulfilled hoặc đã cấp delivery.
- S5 sở hữu payment và delivery; S2 chỉ giữ immutable internal snapshot mà S5 sẽ tiêu thụ.

### 4.5 Monetary authority

**Quyết định:** Browser không có monetary authority.

Khi create Order, server phải:

- validate Product/Variant selection hiện tại;
- resolve effective unit price và currency từ catalog;
- derive amount/total từ server price và accepted quantity;
- persist exact purchase-time monetary snapshot.

Catalog edit sau đó không thay đổi persisted Order amount, total, currency hoặc selection history.

### 4.6 Private customer Order page

**Quyết định:** Customer có private URL có thể mở lại được.

- Private access record chỉ giữ token hash/digest; raw token không được persist hoặc log.
- Token bị sửa/đoán không đọc được Order.
- Cross-Store reference không đọc được Order.
- Customer page chỉ trả reference, purchase-time selection, quantity, amount, currency, status và payment next-step.
- Customer page không trả access content, private-file key, filename hoặc bất kỳ private-file identity nào.

### 4.7 Atomicity và idempotency

**Quyết định:** Customer create/reuse, Order, line, internal snapshot, initial history, private access record và idempotency result là một atomic outcome.

- Failure tại bất kỳ bước nào rollback toàn bộ aggregate.
- Double submit/retry chỉ tạo một Order và trả lại cùng result.
- Exact request/idempotency protocol và token algorithm là planning detail, không phải product decision trong báo cáo này.

### 4.8 Catalog-to-Order delivery retention

**Quyết định:** Internal Order-line snapshot giữ purchase-time Product/Variant identity, SKU, option labels/values, effective price/currency, access content và immutable private-file key.

- Catalog edit không thay đổi persisted Order history.
- Delivery object có key đang được Order snapshot tham chiếu không được xóa.
- S2 không expose delivery content hoặc file identity cho Customer; S5 dùng internal snapshot để thực hiện delivery.

### 4.9 Console boundary

**Quyết định:** Anonymous Console của S1 tiếp tục là accepted teaching risk và chỉ dùng demo data.

- Console hiển thị persisted Customer, `pending_payment` Order, line, quantity, amount và Variant selection.
- Console không được hiển thị private customer capability URL/raw token, private-file key hay access snapshot.
- S4 sở hữu identity, permissions và Store-level authorization; S2 không thêm auth layer tạm thời.

## 5. Non-goals

- Payment provider, payment links, invoices, provider checkout, webhooks hoặc payment reconciliation.
- Delivery grant, private-file download, entitlement hoặc delivery lifecycle.
- Customer accounts, login, sessions, roles, Store membership hoặc authorization.
- Cart, multi-line Orders, mixed currencies và quantity ngoài `1–99`.
- Realtime catalog subscriptions, catalog duplication/synchronization hoặc Storefront-owned catalog persistence.
- Email delivery/recovery workflow cho private Order URL.

## 6. Acceptance evidence ở mức outcome

S2 hoàn thành khi có thể quan sát các journeys sau trên catalog chung:

1. Console sửa active Product/Variant; Storefront refetch và phản ánh catalog hiện tại.
2. Customer đặt một Simple Product Order với quantity hợp lệ; server persist `pending_payment` Order có server-decided monetary values.
3. Customer đặt một Variant Product Order với một enabled Variant hợp lệ; persisted Order và Console hiển thị purchase-time Variant selection.
4. Cùng normalized email tạo/reuse đúng Customer record; latest Customer name thay đổi nhưng old Order customer snapshot giữ nguyên.
5. Customer private URL mở lại đúng Order; reference/email đơn lẻ, token invalid/altered và cross-Store reference không đọc được Order.
6. Customer Order response không lộ access content hoặc private-file identity; Console không lộ private capability secret.
7. Retry/double submit chỉ có một persisted Order aggregate; injected write failure không để partial Customer/Order/access/idempotency state.
8. Catalog/Variant/delivery edit sau Order không thay đổi persisted Order history và không xóa delivery object còn được snapshot tham chiếu.

## 7. Chi tiết cố ý để planning quyết định

Các nội dung sau không thay đổi outcome hoặc architecture đã chốt, nên được để planning xác định theo pattern S1:

- exact HTTP routes, payload shape, status/error codes và CORS header set;
- D1 table/index/constraint shape, snapshot serialization và history representation;
- token generation/hash/digest algorithm, token transport và log redaction mechanics;
- exact idempotency request protocol;
- UI layout, component breakdown, test matrix, migration sequencing và deployment commands.

## 8. Rủi ro đã nhận thức

- Anonymous Console của S1–S3 không phù hợp production data; scope này chỉ chấp nhận demo data và không được mô tả là Owner-authorized.
- Bearer private URL cho phép Customer mở lại Order mà không có account hoặc email recovery; Customer cần giữ URL. Account/recovery thuộc scope identity sau này.
- `pending_payment` chỉ là recorded purchase intent/Order state trong S2; không tạo bằng chứng thanh toán hoặc quyền delivery.

## 9. Handoff

Direction đã chốt để planning:

- Storefront độc lập, shared Worker/D1 catalog;
- one-line `pending_payment` Order với quantity `1–99`;
- server-side validation, pricing và immutable Order snapshots;
- atomic, idempotent Order creation;
- private Customer Order page không lộ delivery data;
- minimal Console Orders surface dưới accepted anonymous-demo boundary.

Không còn product hoặc architecture decision blocking planning.
