---
title: Nexus capability layout
date: 2026-09-09
summary: Restructure giữ behavior và phát hiện stale Wrangler deploy redirect
---

# Nexus capability layout

## Kết quả
Tách Nexus từ main hiện tại thành ba apps và hai business capabilities; giữ nguyên HTTP/API, migrations và behavior. Orders có queries, commands, persistence và transitions thực; root/scoped AGENTS ghi ownership, README giữ mental model.

## Quyết định và lỗi wiring
LSP folder rename trả overlapping edits nên dùng TypeScript AST để đổi module specifiers, không đổi source bodies. Cloudflare plugin tự thêm v3 vào persistState.path. Dry-run phát hiện root Wrangler redirect có thể chọn bundle cũ sau khi đổi Vite root; --cwd app lại gây source/deploy base-path conflict. Người dùng chọn deploy qua generated config cụ thể sau build, giữ root Wrangler là cấu hình nguồn và migration entrypoint, giữ nguyên forwarding --var/--name.

## Bằng chứng
Node 22 npm ci, typecheck, 142 workerd tests, 48 browser tests, 27 e2e tests, hai build và hai npm deploy dry-runs pass. Hai preview thực đọc local D1; 375px không scroll ngang, primary actions đúng accent/ink. Bảy migration hashes không đổi; 59 source bodies/styles không đổi ngoài imports; 23 SQL+binding expressions của commands trùng baseline. Review không còn Critical/Important; hai helper nội bộ bỏ export thừa.

## Giới hạn
Không deploy remote, không merge. Cảnh báo workerd foreign-key reset cũng xuất hiện ở baseline với suites pass. CI/PR readiness sẽ được kiểm tra trên PR; không coi local tests là CI. Lịch sử restructure cũ và worktrees chưa commit không bị sửa. AgentWiki/social không publish.

## Hoàn tất PR
[PR #12](https://github.com/AKBuildSprint/nexus-handson/pull/12) đã mở vào main, posted technical self-review và gắn `ready to ship stable` cho PR/issue #11. CI N/A: không có checks/workflows, main không protected; không gắn nhãn “CI green”. GitHub GraphQL chỉ trả 100 files nên review dùng REST pagination để đối chiếu đủ 123 files. Plan đạt 2/2 phases, 8/8 tasks; không merge.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
