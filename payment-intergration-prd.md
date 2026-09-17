Tích hợp cổng thanh toán cho sản phẩm. 

# Quy trình mua hàng

1. Khách hàng chọn sản phẩm, tạo đơn, generate mã thanh toán
2. Luồng thanh toán:  Đọc docs [https://docs.payfs.vn/vi/developers/quickstart](https://docs.payfs.vn/vi/developers/quickstart)
3. Khách hàng thanh toán xong, gửi email xác nhận thanh toán
4. sau 30 phút khách hàng không thanh toán thì gửi reminder cho khách

# yêu cầu khác

- Lưu logs payfs gửi về hệ thống  
- admin có cơ chế kiểm tra status của cổng thanh toán Payfs  
- khi không nhận được webhook thì chủ động call api lên payfs để kiểm tra

WEbhook key: pk_x7mA8Y02uFdTcXiO5RQBne_gBJ9jh2Mp  
Webhook Secret: whsec_jtlt8Hoed2jAuuavQJcD3Hvf4rQtyS-afP_LgzBN4xh  
Số Tài khoản: 558555858888   
Ngân hàng MB   
Chủ tk : Nguyễn Trung Đức
