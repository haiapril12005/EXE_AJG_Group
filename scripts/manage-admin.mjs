import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: new URL("../backend/.env", import.meta.url) });

const MAX_ADMINS = 3;
const MIGRATION_FILE = "supabase/migrations/007_admin_role.sql";

const supabaseUrl = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !secretKey) {
  console.error("Thiếu SUPABASE_URL hoặc SUPABASE_SECRET_KEY trong backend/.env.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const [action = "list", rawEmail = ""] = process.argv.slice(2).filter((arg) => arg !== "--");
const email = rawEmail.trim().toLowerCase();

function deriveUserCode(id) {
  const clean = String(id).replace(/[^0-9a-fA-F]/g, "").padEnd(32, "0");
  const head = Number.parseInt(clean.slice(0, 7), 16) || 0;
  const tail = Number.parseInt(clean.slice(25, 32), 16) || 0;
  const seed = head ^ tail;
  return String(10_000_000 + (seed % 90_000_000));
}

function usage() {
  console.log("Cách dùng lệnh quản lý tài khoản Admin (chỉ chạy qua CLI với SUPABASE_SECRET_KEY):");
  console.log("  npm.cmd run admin:list                              # Xem danh sách Admin hiện tại (tối đa 3)");
  console.log("  npm.cmd run admin:grant -- <email_hoặc_mã_ID_8_số>  # Gán quyền Admin (yêu cầu đã xác thực OTP & < 3 Admin)");
  console.log("  npm.cmd run admin:revoke -- <email_hoặc_mã_ID_8_số> # Thu hồi quyền Admin của tài khoản");
}

function isMissingMigrationError(error) {
  const msg = String(error?.message ?? "");
  return error?.code === "PGRST202" || /is_admin|grant_admin_role|revoke_admin_role/i.test(msg);
}

async function fetchUsersForCli() {
  let res = await supabase.from("users").select("id,user_code,email,full_name,is_admin,created_at").order("created_at", { ascending: true });
  if (res.error && /user_code/i.test(res.error.message)) {
    res = await supabase.from("users").select("id,email,full_name,is_admin,created_at").order("created_at", { ascending: true });
  }
  if (res.error) {
    if (isMissingMigrationError(res.error)) {
      console.error(`Chưa chạy migration quản trị. Hãy chạy ${MIGRATION_FILE} trong Supabase SQL Editor trước.`);
      process.exit(1);
    }
    throw res.error;
  }
  return (res.data ?? []).map((u) => ({
    ...u,
    user_code: u.user_code && /^[0-9]{7,8}$/.test(u.user_code) ? u.user_code : deriveUserCode(u.id)
  }));
}

async function listAdmins() {
  const users = await fetchUsersForCli();
  const admins = users.filter((u) => u.is_admin);
  console.log(`=== DANH SÁCH QUẢN TRỊ VIÊN (${admins.length}/${MAX_ADMINS}) ===`);
  if (!admins.length) {
    console.log("Chưa có tài khoản quản trị nào.");
  } else {
    for (const [index, admin] of admins.entries()) {
      console.log(`${index + 1}. [ID: ${admin.user_code}] ${admin.email} (${admin.full_name || "Chưa đặt tên"})`);
    }
  }
  console.log(`Số vị trí Admin còn trống: ${Math.max(0, MAX_ADMINS - admins.length)}/${MAX_ADMINS}`);
}

async function grantAdmin(targetIdentifier) {
  const isCode = /^[0-9]{7,8}$/.test(targetIdentifier);
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetIdentifier);
  if (!targetIdentifier || (!isCode && !isEmail)) {
    console.error("Vui lòng nhập địa chỉ email hoặc mã ID 8 chữ số hợp lệ. Ví dụ: npm.cmd run admin:grant -- 81047992");
    process.exit(1);
  }

  const users = await fetchUsersForCli();
  const targetUser = users.find((u) => u.email.toLowerCase() === targetIdentifier || u.user_code === targetIdentifier);
  const adminCount = users.filter((u) => u.is_admin).length;

  if (!targetUser) {
    console.error(`TỪ CHỐI [USER_NOT_FOUND]: Không tìm thấy tài khoản với "${targetIdentifier}" trên hệ thống.`);
    process.exit(1);
  }

  // Step 2: Check email confirmation status in auth.users
  const { data: authData, error: authError } = await supabase.auth.admin.getUserById(targetUser.id);
  if (authError || !authData?.user) {
    throw authError ?? new Error("Không kiểm tra được trạng thái xác thực trong auth.users");
  }
  if (!authData.user.email_confirmed_at) {
    console.error(`TỪ CHỐI [EMAIL_NOT_CONFIRMED]: Tài khoản "${targetUser.email}" (ID: ${targetUser.user_code}) chưa xác thực mã OTP qua email.`);
    process.exit(1);
  }

  if (targetUser.is_admin) {
    console.log(`Tài khoản "${targetUser.email}" (ID: ${targetUser.user_code}) đã là Quản trị viên (${adminCount}/${MAX_ADMINS}).`);
    return;
  }

  if (adminCount >= MAX_ADMINS) {
    console.error(`TỪ CHỐI [MAX_LIMIT_REACHED]: Hệ thống chỉ cho phép tối đa ${MAX_ADMINS} tài khoản Admin (hiện đã có ${adminCount}/${MAX_ADMINS}).`);
    console.error("Hãy dùng lệnh `npm.cmd run admin:revoke -- <email_hoặc_mã_ID>` để thu hồi bớt trước khi cấp mới.");
    process.exit(1);
  }

  // Step 3: Execute database-level security definer RPC (pass targetUser.email so it works even before 007 SQL is re-applied)
  const { data: result, error: rpcError } = await supabase.rpc("grant_admin_role", {
    p_email: targetUser.email
  });

  if (rpcError) {
    if (isMissingMigrationError(rpcError)) {
      console.error(`Chưa có hàm grant_admin_role. Hãy chạy ${MIGRATION_FILE} trong Supabase SQL Editor trước.`);
      process.exit(1);
    }
    console.error(`TỪ CHỐI: ${rpcError.message}`);
    process.exit(1);
  }

  console.log(`THÀNH CÔNG: Đã cấp quyền Quản trị viên (Admin) cho [ID: ${targetUser.user_code}] ${result.email} (${result.full_name || "N/A"}).`);
  console.log(`Số lượng Admin hiện tại: ${result.admin_count}/${result.max_admins}`);
}

async function revokeAdmin(targetIdentifier) {
  const isCode = /^[0-9]{7,8}$/.test(targetIdentifier);
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetIdentifier);
  if (!targetIdentifier || (!isCode && !isEmail)) {
    console.error("Vui lòng nhập địa chỉ email hoặc mã ID 8 chữ số hợp lệ. Ví dụ: npm.cmd run admin:revoke -- 81047992");
    process.exit(1);
  }

  const users = await fetchUsersForCli();
  const targetUser = users.find((u) => u.email.toLowerCase() === targetIdentifier || u.user_code === targetIdentifier);
  if (!targetUser) {
    console.error(`KHÔNG THỂ THU HỒI: Không tìm thấy tài khoản với "${targetIdentifier}".`);
    process.exit(1);
  }

  const { data: result, error: rpcError } = await supabase.rpc("revoke_admin_role", {
    p_email: targetUser.email
  });

  if (rpcError) {
    if (isMissingMigrationError(rpcError)) {
      console.error(`Chưa có hàm revoke_admin_role. Hãy chạy ${MIGRATION_FILE} trong Supabase SQL Editor trước.`);
      process.exit(1);
    }
    console.error(`KHÔNG THỂ THU HỒI: ${rpcError.message}`);
    process.exit(1);
  }

  console.log(`THÀNH CÔNG: Đã thu hồi quyền Quản trị viên của [ID: ${targetUser.user_code}] ${result.email}.`);
  console.log(`Số lượng Admin hiện tại: ${result.admin_count}/${result.max_admins}`);
}

try {
  if (action === "list") {
    await listAdmins();
  } else if (action === "grant") {
    await grantAdmin(email);
  } else if (action === "revoke") {
    await revokeAdmin(email);
  } else {
    usage();
    process.exitCode = 1;
  }
} catch (error) {
  console.error("Lỗi khi thực thi lệnh quản trị:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

