# Quy trình Git

Repository dùng hai nhánh dài hạn:

- `main` giữ bản ổn định. Chỉ gộp `develop` vào `main` khi nhóm đã hoàn thành và kiểm thử phiên bản phát hành.
- `develop` tích hợp code từ backend, frontend, database và tài liệu.

Nhánh làm việc ngắn hạn được tạo từ `develop` với tên `feature/<ten-task>`, `fix/<ten-task>` hoặc `docs/<ten-task>`. Khi xong, mở pull request vào `develop`, kiểm tra build và review trước khi gộp. Xóa nhánh task sau khi merge.

## Clone và lấy code mới

```bash
git clone https://github.com/haiapril12005/EXE_AJG_Group.git
cd EXE_AJG_Group
git switch develop
git pull --ff-only
```

Nếu đã clone repo từ trước:

```bash
git fetch origin
git switch develop
git pull --ff-only
```

Nếu máy chưa có nhánh local `develop`, dùng `git switch --track origin/develop`.

## Làm một task

```bash
git switch develop
git pull --ff-only
git switch -c feature/ten-task
# sửa code, commit, push
git push -u origin feature/ten-task
```

Mở pull request từ `feature/ten-task` vào `develop`. Khi hoàn thành dự án, mở pull request từ `develop` vào `main`. Tránh commit trực tiếp vào `main` và không dùng `git pull origin develop` khi đang đứng ở `main`.
