"use client";

import { formatUserCode } from "../../app-frame";
import { AdminCard, AdminNotice, AdminPageHeader, fmtDate, RefreshButton, useAdminData } from "../admin-ui";
import type { AdminOverview } from "../types";

export default function AdminSystemPage() {
  const { data, error, loading, reload } = useAdminData<{ overview: AdminOverview }>("/admin/overview");
  const o = data?.overview;

  return (
    <>
      <AdminPageHeader
        title="Hệ thống"
        description="Tài khoản quản trị và quy tắc cấp quyền."
        actions={<RefreshButton loading={loading} onClick={reload} />}
      />
      {error && <AdminNotice>{error}</AdminNotice>}

      {o && (
        <div className="admin-grid-2">
          <AdminCard title={`Quản trị viên (${o.rules.current_admins}/${o.rules.max_admins})`} description={`Còn trống ${o.rules.remaining_slots} chỗ`}>
            <ul className="admin-simple-list admin-admin-list">
              {o.admins.map((admin) => (
                <li key={admin.id}>
                  <div className="admin-person">
                    <span className="admin-avatar" aria-hidden="true">{(admin.full_name || admin.email).trim().charAt(0).toUpperCase()}</span>
                    <span><strong>{admin.full_name || "Quản trị viên"}</strong><small>{admin.email} · ID {admin.user_code || formatUserCode(admin.id)}</small></span>
                  </div>
                  <small className="admin-muted">Từ {fmtDate(admin.created_at)}</small>
                </li>
              ))}
            </ul>
          </AdminCard>

          <AdminCard title="Quy tắc cấp quyền Admin">
            <ol className="admin-rules">
              <li><strong>Đã xác thực email</strong><span>Tài khoản phải xác nhận OTP email trước.</span></li>
              <li><strong>Tối đa {o.rules.max_admins} Admin</strong><span>Giới hạn được kiểm tra ngay trong database.</span></li>
              <li><strong>Chỉ cấp qua CLI</strong><span>Cần khóa bí mật máy chủ; không thể tự cấp quyền từ giao diện.</span></li>
            </ol>
            <div className="admin-commands">
              <span>Cấp quyền (theo email hoặc mã ID 8 số)</span>
              <code>npm run admin:grant -- &lt;email_hoặc_mã_ID&gt;</code>
              <span>Thu hồi</span>
              <code>npm run admin:revoke -- &lt;email_hoặc_mã_ID&gt;</code>
              <span>Xem danh sách</span>
              <code>npm run admin:list</code>
            </div>
          </AdminCard>
        </div>
      )}
    </>
  );
}
