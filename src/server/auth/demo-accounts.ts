/**
 * 演示快捷登录的账号目录。
 *
 * 口令只出现在服务端：浏览器点按钮时只提交邮箱，由 Server Action 取出本文件里的
 * 口令替用户完成一次真实的 better-auth 邮箱口令登录。这样既省去手动输入，
 * 又不会把口令写进前端 bundle。
 *
 * 口令默认值与 prisma/seed.ts、prisma/seed-demo.ts 保持一致；若把种子口令换成别的，
 * 只要同步设置 SEED_ADMIN_PASSWORD / SEED_USER_PASSWORD，快捷登录就不会失效。
 */

const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin@12345";
const USER_PASSWORD = process.env.SEED_USER_PASSWORD ?? "User@12345";

export type DemoAccount = {
  email: string;
  /** 显示名：管理员用岗位名，其余用姓名，与 README 演示账号表一致 */
  name: string;
  roleLabel: string;
  deptLabel: string;
  /** 数据权限范围，方便访客挑账号演示「看不到别人的合同」 */
  scopeLabel: string;
  password: string;
};

/** 可安全下发到浏览器的那部分字段 */
export type PublicDemoAccount = Omit<DemoAccount, "password">;

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    email: "admin@example.com",
    name: "系统管理员",
    roleLabel: "管理员",
    deptLabel: "总公司",
    scopeLabel: "全部数据",
    password: ADMIN_PASSWORD,
  },
  {
    email: "zhangming@example.com",
    name: "张明",
    roleLabel: "部门主管",
    deptLabel: "技术中心",
    scopeLabel: "本部门及下级",
    password: USER_PASSWORD,
  },
  {
    email: "lihua@example.com",
    name: "李华",
    roleLabel: "部门主管",
    deptLabel: "基础运维部",
    scopeLabel: "本部门及下级",
    password: USER_PASSWORD,
  },
  {
    email: "wangfang@example.com",
    name: "王芳",
    roleLabel: "法务",
    deptLabel: "法务合规部",
    scopeLabel: "全部数据",
    password: USER_PASSWORD,
  },
  {
    email: "chenchen@example.com",
    name: "陈晨",
    roleLabel: "普通员工",
    deptLabel: "基础运维部",
    scopeLabel: "仅本人",
    password: USER_PASSWORD,
  },
  {
    email: "zhaolei@example.com",
    name: "赵磊",
    roleLabel: "普通员工",
    deptLabel: "技术中心",
    scopeLabel: "仅本人",
    password: USER_PASSWORD,
  },
];

/**
 * 只在白名单里找账号，绝不拿前端传来的任意邮箱直接登录 ——
 * 否则快捷登录就等于「任意账号免密登录」的后门。
 */
export function findDemoAccount(email: string): DemoAccount | undefined {
  const normalized = email.trim().toLowerCase();
  return DEMO_ACCOUNTS.find((account) => account.email === normalized);
}

/**
 * 快捷登录开关：
 * - `DEMO_LOGIN=on` / `1` / `true`：强制开启（部署到线上做演示时用）
 * - `DEMO_LOGIN=off` / `0` / `false`：强制关闭
 * - 不设置：开发环境开启、生产环境关闭，避免线上留一个免密入口
 */
export function demoLoginEnabled(): boolean {
  const flag = process.env.DEMO_LOGIN?.trim().toLowerCase();
  if (flag === "off" || flag === "0" || flag === "false") return false;
  if (flag === "on" || flag === "1" || flag === "true") return true;
  return process.env.NODE_ENV !== "production";
}

/** 剥掉口令，供客户端渲染 */
export function toPublicDemoAccount(account: DemoAccount): PublicDemoAccount {
  return {
    email: account.email,
    name: account.name,
    roleLabel: account.roleLabel,
    deptLabel: account.deptLabel,
    scopeLabel: account.scopeLabel,
  };
}
