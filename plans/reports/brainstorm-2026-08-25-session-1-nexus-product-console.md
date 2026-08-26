# Báo cáo brainstorm — Nexus Session 1 Product Console

- **Trạng thái:** Đã chốt, sẵn sàng chuyển sang planning
- **Cập nhật:** 2026-08-26
- **Nguồn yêu cầu:** [`session-1-brief.md`](../../session-1-brief.md)
- **Nguồn curriculum tham chiếu:** `../agentkit-product-studio/program/session-1.md` và `../agentkit-product-studio/program/student-persona.md` trong workspace cha

## 1. Outcome

Ship vertical slice đầu tiên của Nexus trên một Cloudflare link thật:

- một bootstrap Store;
- Operations Console cho operator tạo, sửa, liệt kê và mở lại digital Product;
- Product có thể không có Variants hoặc dùng ma trận nhiều thuộc tính;
- import Product và Variant combinations từ CSV, lặp lại không tạo bản ghi trùng;
- Product lưu giá gốc; Variant có thể override giá và delivery configuration;
- public API trả cùng active Products/Variants cho S2 Storefront, không reseed hoặc sao chép dữ liệu;
- original CSV và optional delivery files nằm trong private R2.

## 2. Các quyết định đã chốt

### 2.1 Public Console trong S1–S3

**Quyết định:** Không có login, session hoặc Owner authorization trong S1–S3.

**Hệ quả được chấp nhận:**

- bất kỳ ai truy cập được Console hoặc Console write API đều có thể tạo, sửa và import Product;
- không có actor-level audit hoặc tenant protection;
- tiêu chí “kiểm tra quyền Owner trước khi nhận file” trong brief được chủ động miễn cho S1;
- không được báo cáo authorization là đã hoàn thành;
- S4 mới thêm users, sessions, Store memberships và Owner/Staff authorization thật.

R2 vẫn private. Public Product API vẫn phải loại bỏ delivery configuration và mọi storage key.

**Các phương án không chọn:**

- Bootstrap Owner Secret: nhỏ và an toàn hơn nhưng vẫn tạo một auth layer tạm thời.
- Cloudflare Access: có identity ở edge nhưng tăng Zero Trust setup và dependency ngoài repo.

### 2.2 Slug là identity chống trùng của CSV

**Quyết định:** CSV bắt buộc có `slug`; D1 áp dụng `UNIQUE(store_id, slug)`.

**Quy tắc:**

- import lại cùng file không tạo Product mới;
- cùng slug xuất hiện trong file khác vẫn là duplicate;
- duplicate không ghi đè Product hiện có;
- duplicate trong cùng CSV chỉ tạo tối đa một Product;
- manual create sinh slug từ Product name và xử lý collision;
- slug giữ ổn định khi Product name thay đổi.

**Các phương án không chọn:**

- `external_id`: mạnh cho tích hợp nguồn ngoài nhưng mở rộng schema ngoài brief.
- fingerprint từ name/price/currency: dễ gộp nhầm hoặc tạo bản ghi mới khi Product được chỉnh sửa.

### 2.3 Private delivery file

**Quyết định:** Cho phép PDF hoặc ZIP, tối đa 25 MB.

**Boundary:**

- xác minh actual bytes; không tin filename hoặc browser Content-Type;
- PDF và ZIP phải có signature hợp lệ;
- object key do server sinh ngẫu nhiên;
- không dùng filename làm R2 path;
- không có public bucket URL;
- thay file luôn ghi object key mới; không overwrite object cũ;
- object đã được Order-item snapshot tham chiếu phải được giữ cho đến khi retention policy tương lai cho phép cleanup an toàn.
- public API không trả file key, filename hoặc delivery instructions.

### 2.4 Product lifecycle

Dùng ba status tối thiểu:

- `draft`;
- `active`;
- `archived`.

Chỉ `active` xuất hiện trong public API. Create dùng validated form thay vì tạo draft rỗng. Product phải có name, valid price, currency, status, access title và access instructions; public description và private file là optional.

### 2.5 Money contract

- D1 lưu Product `base_price_minor` và nullable Variant `price_override_minor` dưới dạng integer.
- Product sở hữu một ISO currency; Variant luôn kế thừa currency này.
- Unified CSV dùng decimal string theo currency: ví dụ USD `19.99`, VND `250000`.
- `variant_price_override` để trống nghĩa là kế thừa Product base price.
- Worker parse bằng decimal/string logic, không dùng floating-point arithmetic.
- Reject giá âm, malformed hoặc vượt currency precision.
- Public API trả integer minor units; consumer tự format.

### 2.6 Một backend và một Product store

Console và public API dùng chung Cloudflare Worker, D1 và private R2.

Route boundary cần tách rõ:

- `/api/storefront/products`: active Customer-safe catalog projection;
- `/api/console/*`: Console reads/writes và private delivery configuration;
- `/console/*`: Operations Console UI.

`/api/console/*` vẫn public trong S1 theo quyết định 2.1. Việc tách route nhằm giữ public API ổn định và cho phép S4 thêm authorization mà không đổi contract của S2.

### 2.7 Product Variants là must-have của S1

**Quyết định:** Product Variants thay thế deliberate simplification trong brief và không còn là non-goal.

**Option matrix và scale:**

- Product có thể có 0–5 option groups; Owner quyết định số groups thực sự cần;
- mỗi group có tối đa 10 option values;
- mỗi Product chỉ có một active Variant schema;
- khi combine, Owner chọn các groups tham gia và lược bỏ groups không cần thiết;
- Console tính trước tổng Cartesian combinations;
- từ 11 đến 30 combinations, Console cảnh báo nguy cơ gây nhiễu cho Customer và yêu cầu Owner xác nhận;
- hard cap là 30 materialized combinations/Product; combination thứ 31 bị chặn;
- các giới hạn này là cố định trong S1; Admin Config để chỉnh giới hạn là future scope.

**Schema lifecycle:**

- rename group/value giữ stable ID và không regenerate;
- thêm/xóa group hoặc value là structural change, phải preview và regenerate;
- combinations không còn thuộc schema mới bị disabled, không hard-delete;
- Product không được tồn tại nhiều active group schemas;
- public API chỉ trả active schema cùng enabled Variants.

**Variant identity và availability:**

- mỗi Variant có stable ID và SKU bắt buộc, unique trong toàn Store;
- canonical combination chỉ xuất hiện một lần trong Product, kể cả khi dùng SKU khác;
- Variant có trạng thái enabled/disabled; S2 chỉ nhận enabled Variants của active Product;
- Product không có option groups vẫn là simple purchasable Product và không cần Variant record;
- khi generate trên website, hệ thống gợi ý SKU từ Product slug + option values; Owner được sửa trước khi save và server vẫn kiểm tra uniqueness.

**Pricing:**

- Product giữ base price;
- Variant có optional price override trong cùng currency với Product;
- effective Variant price dùng override nếu có, ngược lại dùng base price;
- nếu active Variants có nhiều effective prices, S2 hiển thị Product theo dạng “Từ …”.

**Delivery:**

- Product giữ default access title, instructions và optional private file;
- Variant mặc định dùng toàn bộ Product delivery configuration;
- Owner có thể bật override cho một Variant; khi override, Variant dùng access title/instructions và optional private file riêng như một cấu hình hoàn chỉnh;
- public API không được lộ default hoặc Variant delivery configuration.

### 2.8 Một CSV template cho simple và Variant Products

**Quyết định:** Operations Console bắt buộc có chức năng tải một file CSV template duy nhất cho cả hai loại Product.

- filename ổn định: `nexus-product-import-template.csv`;
- template chứa một exact ordered header row cùng một simple Product example và hai Variant rows của một Product example;
- simple Product để trống `variant_sku`, `variant_price_override`, `variant_status` và toàn bộ option columns;
- Variant Product dùng một row cho mỗi purchasable combination, bắt buộc có SKU và ít nhất một option name/value pair hoàn chỉnh;
- hệ thống tự detect loại Product từ dữ liệu từng `product_slug`, không yêu cầu cột type;
- nếu cùng một `product_slug` trộn simple row và Variant rows, hoặc có option pair thiếu name/value, import reject conflict thay vì đoán;
- file tải trực tiếp từ website phải import lại được mà không cần đổi header.

**Preview và persistence:**

- browser đọc CSV để preview Product type, row results và combination count;
- 11–30 combinations yêu cầu confirmation trước upload; trên 30 bị chặn;
- Worker không tin client preview: sau upload, Worker ghi original bytes vào R2 rồi tự parse/validate lại;
- Worker xóa R2 object nếu server validation hoặc D1 commit thất bại;
- S1 không tạo server-side preview session hoặc background cleanup.
- CSV request tối đa 1 MB và 500 data rows; browser và Worker cùng enforce.

**Existing Product semantics:**

- import là additive exact-match, không phải upsert;
- existing `product_slug` chỉ nhận SKU/combinations mới khi Product fields và active schema khớp;
- existing SKU cùng mapping là duplicate;
- SKU hoặc combination identity conflict reject toàn bộ Product row group;
- CSV không sửa Product/Variant đã tồn tại.

### 2.9 S2 Order và S5 delivery snapshot

- canonical public catalog route là `GET /api/storefront/products`;
- Product có Variants bắt buộc Customer chọn một enabled Variant; simple Product không cần Variant ID;
- lúc tạo Order, server snapshot Product ID/name, nullable Variant ID, Variant SKU, selected option labels/values, effective unit price/currency, copied access title/instructions và immutable private-file key;
- Product/Variant edits sau đó không thay đổi lời hứa của Order đã tạo;
- thay delivery file ghi R2 object mới; object key đã được Order-item tham chiếu không được xóa;
- S5 grant access từ Order-item snapshot, không resolve lại catalog hiện tại;
- private delivery configuration không xuất hiện trong public catalog hoặc Customer-safe Order response.

### 2.10 Frontend-first gate và deployment

- dùng Mobbin MCP để nghiên cứu catalog list, Product editor, Variant matrix và CSV import flows;
- dựng frontend prototype và kiểm tra browser trước backend/data implementation;
- backend/API/schema phases bị block cho đến khi user chốt design;
- sau approval, reconcile approved fields/states với routes, DTOs, D1 transactions, R2 lifecycle và cập nhật các phase còn lại trước khi code chi tiết;
- deploy trực tiếp bằng Wrangler CLI;
- tạo một Worker name với random suffix đúng một lần, persist trong `wrangler.jsonc` và reuse ở mọi deploy;
- nghiệm thu trên URL `*.workers.dev`; không cấu hình custom domain trong S1.

## 3. Data contract tối thiểu

### `stores`

Bootstrap Store có stable ID, unique slug, public identity fields và timestamps.

### `products`

Store-scoped Product gồm stable ID, slug, name, base price dạng integer minor units, currency, status, public description, default private delivery configuration và timestamps.

Các constraint bắt buộc:

- Product thuộc một Store;
- `UNIQUE(store_id, slug)`;
- non-negative integer base price;
- status thuộc tập giá trị cho phép.

### `product_option_groups` và `product_option_values`

- mỗi group thuộc một Product, có stable ID, display name và position;
- group name unique trong Product;
- tối đa 5 groups mỗi Product;
- mỗi value có stable ID, label và position;
- value label unique trong group;
- tối đa 10 values mỗi group.

### `product_variants` và combination membership

Mỗi Variant lưu stable ID, `store_id`, `product_id`, SKU, canonical combination key, enabled/disabled status, optional price override, optional complete delivery override và timestamps.

Các constraint bắt buộc:

- `UNIQUE(store_id, sku)`;
- `UNIQUE(product_id, combination_key)`;
- price override là non-negative integer hoặc null;
- Variant currency luôn kế thừa Product currency;
- membership table nối Variant với đúng một option value trong mỗi group của active schema.

### `imports`

Import record thuộc Store và lưu random R2 storage key, original filename, size, detected content type, added/duplicate/rejected counts và creation timestamp.

`store_id` phải có từ S1 để import history có thể được bind an toàn khi S4 thêm nhiều Store.

## 4. CSV contract

CSV hỗ trợ cả simple Product và Product Variants. Mỗi Variant row đại diện một purchasable combination.

Operations Console phải có nút tải `nexus-product-import-template.csv`. Đây là template duy nhất; không tạo hai schema hoặc hai file hướng dẫn cạnh tranh.

Exact ordered header row:

```csv
product_slug,product_name,base_price,currency,product_status,public_description,access_title,access_instructions,variant_sku,variant_price_override,variant_status,option_1_name,option_1_value,option_2_name,option_2_value,option_3_name,option_3_value,option_4_name,option_4_value,option_5_name,option_5_value
```

Template chứa một valid simple Product example và hai valid Variant rows của một Product example để minh họa auto-detection trong cùng file.

Money columns dùng decimal string theo Product currency. `variant_price_override` để trống nghĩa là dùng Product base price.

### Type detection và validation

- hệ thống group rows theo `product_slug` rồi tự detect Product type;
- simple Product có đúng một row, với toàn bộ Variant và option columns để trống;
- Variant Product có một row cho mỗi purchasable combination; mỗi row bắt buộc có globally unique `variant_sku`, `variant_status` và ít nhất một option name/value pair hoàn chỉnh;
- `product_status` nhận `draft`, `active` hoặc `archived`; `variant_status` nhận `enabled` hoặc `disabled`;
- cùng `product_slug` không được trộn simple row và Variant rows;
- option name/value phải xuất hiện thành cặp; thiếu một phía là rejected row;
- một Product có tối đa 5 distinct option groups, mỗi group tối đa 10 values và tối đa 30 explicit Variant rows;
- rows của cùng `product_slug` phải thống nhất Product-level fields;
- CSV không import private delivery files hoặc Variant delivery overrides.
- file tối đa 1 MB và 500 data rows;
- derive Cartesian set từ distinct option values; Variant rows phải cover mỗi combination đúng một lần;
- warning/cap dùng derived Cartesian count, không chỉ raw row count;

Mỗi row nhận đúng một outcome:

- `added`;
- `duplicate`;
- `rejected`.

Response có aggregate counts cùng row number, Product slug, Variant SKU khi có, outcome và rejection reason.

### Additive exact-match

- Product dedupe dùng D1 `UNIQUE(store_id, slug)`;
- Variant dedupe dùng `UNIQUE(store_id, sku)`;
- canonical option combination cũng unique trong Product;
- existing Product chỉ nhận new Variants khi Product fields và active schema khớp;
- same SKU cùng Product/combination là duplicate;
- same SKU trỏ mapping khác, hoặc new SKU trỏ existing combination, là identity conflict;
- Product/schema conflict reject toàn bộ rows của `product_slug`;
- import không update ngầm Product hoặc Variant hiện có.

### Browser preview

1. Browser parse file để hiển thị detected type, row preview và combination count.
2. Trên 30 combinations/Product bị chặn.
3. Từ 11 đến 30 yêu cầu explicit confirmation.
4. Preview chỉ phục vụ UX; server không tin kết quả client.

### Server import consistency

1. Enforce hard limit 1 MB/500 data rows và kiểm tra bytes thay vì tin tên/MIME.
2. Lưu original bytes vào R2 dưới random key.
3. Parse và validate lại Product, option và Variant rows.
4. Kiểm tra confirmation flag và hard cap 30.
5. Classify added, duplicate và rejected rows theo Product transaction group.
6. Ghi import metadata cùng valid Product groups vào D1 atomically.
7. Nếu server validation hoặc D1 commit thất bại, xóa R2 object.

File-level failure không tạo catalog/import records. Với structurally valid CSV, một invalid Product group bị reject toàn group; Product groups hợp lệ khác vẫn được commit và report.

## 5. Public API boundary

Canonical catalog route: `GET /api/storefront/products`.

Public Store projection chỉ gồm stable Store identity.

Public Product projection gồm Customer-safe fields:

- stable Product ID;
- slug và name;
- currency;
- base, minimum và maximum effective price ở dạng minor units;
- public description;
- active option groups và values có trong enabled Variants;
- enabled Variants với stable ID, SKU, selected option-value IDs và effective price.

Simple Product không có option groups trả base price và empty Variant collection. Active Product có Variant schema nhưng không còn enabled Variant bị loại khỏi purchasable catalog.

Không được trả Product/Variant access title, instructions, private-file key, R2 metadata, delivery override mode hoặc import information.

## 6. Non-goals

S1 không xây:

- inventory, stock tracking hoặc fulfillment theo số lượng;
- Customer Storefront UI;
- Cart, checkout, Customer, Order hoặc Payment;
- Customer access grant;
- external delivery adapter;
- users, login, sessions hoặc Owner/Staff roles;
- multi-Store administration và Store isolation testing;
- public hoặc permanent file URL;
- CSV update/upsert semantics;
- Admin Config cho giới hạn groups/values/combinations;
- background import jobs hoặc import dashboard;
- backend/Product store thứ hai.
- custom domain hoặc deploy wrapper; deployment dùng Wrangler CLI trực tiếp;

## 7. Acceptance evidence

Planning và implementation phải giữ các bằng chứng hoàn thành sau:

1. Trên Cloudflare link thật, tạo simple Product, quay lại list, mở lại, sửa, refresh và thấy dữ liệu persisted.
2. Tạo Product có 1–5 option groups, tối đa 10 values/group và một active schema.
3. Từ 11–30 combinations, Console cảnh báo và chỉ tiếp tục sau explicit confirmation; combination thứ 31 bị chặn.
4. Structural schema edit preview/regenerate đúng; obsolete combinations bị disabled và public API chỉ trả active schema.
5. Website gợi ý editable SKU; duplicate SKU hoặc duplicate canonical combination bị từ chối.
6. Variant không override dùng Product base price; Variant override dùng đúng decimal input, integer minor-unit storage và effective price.
7. Variant không override delivery dùng Product default; complete override dùng cấu hình riêng và cả hai đều vắng khỏi public API.
8. `GET /api/storefront/products` trả active Products, enabled Variants, option selections và effective minor-unit prices.
9. Console tải được đúng một `nexus-product-import-template.csv` với exact ordered header, một simple example và hai Variant example rows.
10. Hai loại example trong cùng template được auto-detect/import đúng; Owner không cần sửa header hoặc thêm type column.
11. Browser preview áp dụng warning/cap trước upload; server revalidates sau R2 write.
12. Mixed simple/Variant rows, incomplete option pairs hoặc Product/schema conflicts reject toàn Product group với reason rõ ràng.
13. Additive exact-match thêm SKU mới vào matching Product nhưng không update catalog hiện có.
14. Import cùng file lần hai thêm zero records; identity conflicts không bị tính nhầm là duplicate.
15. CSV Variant group cover đúng full Cartesian matrix; sparse/extra combinations bị reject theo Product group.
16. Invalid file/server validation/D1 failure không để lại partial catalog records, import record hoặc orphan blob.
17. PDF/ZIP hợp lệ tối đa 25 MB được lưu bằng random key; oversized hoặc mismatched bytes bị reject.
18. S2 Order snapshot giữ exact Product/Variant selection, effective price, copied access content và immutable private-file key.
19. Thay Product/Variant file sau Order creation không xóa object được snapshot hoặc đổi lời hứa của Order.
20. Public và Customer-safe responses không chứa private delivery configuration.
21. Báo cáo cuối nói rõ Console/write routes public và real authorization chờ S4.
22. Mobbin-backed frontend prototype được user approve trước khi backend/data work bắt đầu; approval làm input cho phase reconciliation.
23. CSV 1 MB/500-row boundaries bị enforce ở browser và Worker.
24. Wrangler deploy dùng một persisted randomly suffixed Worker name và trả một `workers.dev` URL; không có custom domain.

## 8. Rủi ro đã chấp nhận

Public Console cho phép anonymous mutation và anonymous R2 upload. Size/type validation chỉ giảm resource abuse, không thay thế authorization. Variant generation/import được bounded ở 30 combinations/Product; 11–30 vẫn cần explicit UX-risk confirmation. Real authorization chờ S4.

## 9. Handoff

Bước tiếp theo là tạo Vertical Slice Plan từ contract này. Plan phải giữ nguyên:

1. Product Variants là must-have; một active schema/Product.
2. Tối đa 5 groups, 10 values/group và 30 materialized combinations.
3. Từ 11–30 combinations phải cảnh báo/xác nhận; trên 30 bị chặn.
4. Product base price và optional Variant override; CSV dùng decimal, D1/API dùng minor units.
5. Product delivery mặc định và optional complete Variant override.
6. Website gợi ý editable SKU; CSV bắt buộc Store-unique SKU.
7. Một downloadable unified CSV template với auto-detection và browser preview.
8. Import là additive exact-match, không upsert.
9. S2 Order snapshot khóa Variant, options, price, copied access content và immutable private-file key lúc tạo Order.
10. Public Console.
11. Private PDF/ZIP delivery files, tối đa 25 MB.
12. Frontend/Mobbin design approval gate chặn backend; các phase sau được reconcile sau approval.
13. CSV hard limit 1 MB và 500 rows.
14. Direct Wrangler CLI deploy với persisted random Worker name trên workers.dev.

## 10. Validation

**Kết quả ngày 2026-08-26:** `READY_FOR_PLANNING` ở mức product/document contract; chưa phải runtime verification.

- [`session-1-brief.md`](../../session-1-brief.md) sở hữu bounded Variant, money, unified CSV, import và private-file rules.
- [`session-2-brief.md`](../../session-2-brief.md) sở hữu canonical Storefront route và immutable Product/Variant Order-item snapshots.
- [`session-5-brief.md`](../../session-5-brief.md) sở hữu entitlement grants từ các snapshots đó.
- Không còn route, Variant-limit, price-unit, import-upsert hoặc delivery-resolution conflict đã biết giữa ba contracts.
- Public Console/anonymous mutation vẫn là accepted risk, không phải authorization đã hoàn thành.

## Câu hỏi chưa giải quyết

Không có.
