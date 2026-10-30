# 合同审批系统

面向企业法务与业务部门的合同全生命周期系统：起草 → 可配置多级审批 → 用印 → 履行 → 到期预警 → 变更 → 归档，
配套管理端的组织架构、权限、模板、审批流可视化配置、审计查询与效率报表。

本仓库是可直接运行的完整实现，不是演示骨架：迁移、种子、鉴权、流程引擎、测试与文档齐备。

---

## 1. 技术栈

| 层 | 选型 |
| --- | --- |
| 框架 | Next.js 16.4.3（App Router + Turbopack）、React 19、TypeScript 5.9 strict（`noUncheckedIndexedAccess`、禁 `any`） |
| 数据库 | PostgreSQL 16（docker-compose）+ Prisma 7.10.1（driver adapter `@prisma/adapter-pg`） |
| 样式/UI | Tailwind CSS v4 + shadcn/ui（Radix） |
| 校验 | zod 4，全部 schema 在 `src/shared/schemas/` |
| 认证 | Better Auth 1.7.14（邮箱密码）+ 自研 RBAC（角色 / 权限点 / 数据范围） |
| 数值 | 金额一律 `Decimal(18,2)` + decimal.js，禁止浮点 |
| 时间 | 存 UTC，展示 Asia/Shanghai（`src/shared/datetime.ts`） |
| 测试 | Vitest（单测 + 集成，独立 `contract_test` 库）、Playwright（端到端） |

---

## 2. 快速开始

```bash
cp .env.example .env          # 至少把 BETTER_AUTH_SECRET 换掉
npm install
npm run db:up                 # 起 Postgres 16（容器名 contract-approval-db）
npm run verify                # 重置迁移 + 种子 + 构建 + 全量测试
npm run dev                   # http://127.0.0.1:3000
```

单独使用：

```bash
npm run db:migrate   # prisma migrate dev
npm run db:seed      # 主数据 + 演示数据（幂等，可反复跑）
npm run test         # Vitest 单测 + 集成
npm run test:e2e     # Playwright（自动起 :3100 dev server）
npm run worker       # 审批超时 + 合同到期预警轮询
```

> 内存紧张的机器上构建可加 `NEXT_BUILD_WORKERS=2 npm run build`：Next 默认按 CPU 起多个构建
> worker，每个一份 V8 堆，静态页生成阶段容易 OOM。

---

## 3. 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | — | 应用角色 `contract_app`（只有 DML，无 DDL） |
| `MIGRATE_DATABASE_URL` | — | 属主角色 `contract_owner`，仅迁移用 |
| `TEST_DATABASE_URL` / `TEST_MIGRATE_DATABASE_URL` | — | 集成测试独立库 `contract_test` |
| `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` | — | 会话签名密钥与站点地址 |
| `STORAGE_DIR` | `./storage` | 附件落盘目录（运行时数据，不入库） |
| `LOG_LEVEL` | `info` | pino 级别 |
| `WORKER_INTERVAL_MS` | `300000` | 扫描周期（5 分钟） |
| `WORKER_BATCH_LIMIT` | `200` | 单轮最多处理条数 |
| `CONTRACT_EXPIRY_WARNING_DAYS` | `30,7` | 到期预警阈值，逗号分隔；每个阈值对每份合同只触发一次 |
| `CONTRACT_EXPORT_MAX_ROWS` | `10000` | 台账导出行数上限，超出直接报错而不是截断 |
| `WEBHOOK_ALLOWED_HOSTS` | 空 | 流程 webhook 的 SSRF 白名单；**留空时一律拒绝外呼** |
| `SEED_ADMIN_PASSWORD` / `SEED_USER_PASSWORD` | `Admin@12345` / `User@12345` | 种子账号口令 |
| `NO_PROXY` | — | 本机若设 HTTP 代理，跑测试前需包含 `localhost,127.0.0.1` |

---

## 4. 演示账号（`npm run db:seed`）

| 邮箱 | 口令 | 角色 | 部门 | 上级 |
| --- | --- | --- | --- | --- |
| `admin@example.com` | `Admin@12345` | 系统管理员（all） | 总公司 | — |
| `zhangming@example.com` | `User@12345` | 部门主管（dept_and_sub） | 技术中心 | 系统管理员 |
| `lihua@example.com` | `User@12345` | 部门主管（dept_and_sub） | 基础运维部 | 张明 |
| `wangfang@example.com` | `User@12345` | 法务（all） | 法务合规部 | 系统管理员 |
| `chenchen@example.com` | `User@12345` | 普通员工（self） | 基础运维部 | 李华 |
| `zhaolei@example.com` | `User@12345` | 普通员工（self） | 技术中心 | 张明 |

部门树三级：`总公司 /hq` → `技术中心 /hq/tech`、`法务合规部 /hq/legal` → `基础运维部 /hq/tech/infra`。
模板两个：`PURCHASE` 采购合同（含条件字段「现结验收说明」）、`SALES` 销售合同。
流程三个（均已发布 v1）：
`PURCHASE_STANDARD` 按金额分流——≥50 万走「法务审核 → 总经理审批」，50 万以下只走「部门主管审批」，
通过后自动生成用印申请；`SALES_FAST`（主管审批 → 通知）；`SERVICE_THREE_LEVEL`（组长 → 法务 → 管理员会签）。

合同六份覆盖各状态：草稿、审批中、待用印、履行中（有用印记录与里程碑）、已驳回、已归档（抄送王芳）。
「审批中」那份金额 68 万，走的是大额分支，所以待办在**王芳（法务）**手上，同意后轮到系统管理员（总经理）；
想看小额分支，把那份 8.8 万的草稿（陈晨发起）直接提交即可，它会落到**李华（部门主管）**。

---

## 5. 目录与模块

```
src/
  app/(app)/          工作台、合同、审批、用印、归档、通知、报表、审计、管理端
  app/api/            /api/auth、/api/files/[id]（附件下载鉴权）、/api/exports/contracts、/api/health
  proxy.ts            会话校验（白名单仅 /login 与 /api/health）
  components/         layout / contract / ui（shadcn）
  server/
    auth/             会话、AccessContext、权限与数据范围
    db/               Prisma 客户端（driver adapter）
    flow/             流程引擎：engine / assignee / expression / validate / join / webhook / idempotency
    services/         contract / contract-export / approval / approval-view / flow / lifecycle / delegate / notification / audit-log / report
    actions/          Server Actions（提交、决策、委托、通知、用印、归档、导出）
    integrations/     扩展点接口（仅 interface + TODO，无假实现）
  shared/             zod schema、状态机、流程定义类型、权限表、金额与时间工具
prisma/               schema.prisma、migrations、seed.ts + seed-demo.ts
scripts/worker.ts     审批超时 + 到期预警
tests/                unit / integration / e2e + helpers
```

一条合同的生命周期：
`draft →（提交，跑审批人解析与图校验）pending → approving →（引擎节点推进）approved → to_seal →
sealed（登记取件）→ active（登记归还，合同生效）→ archived（归档，转只读）`，
中途可 `rejected`（改后重提）、`withdrawn`（无人处理时撤回）、`amended` / `expired` / `terminated`。
状态迁移表在 `src/shared/state-machines.ts`，非法迁移抛 `ILLEGAL_TRANSITION`。

---

## 6. 审批流引擎语义（规格 §4.4）

| # | 规则 | 实现 |
| --- | --- | --- |
| 1 | 节点进入即建 `FlowNodeRun` + 每审批人一条 `FlowTask` + 站内信 + 事件日志 | `engine.ts` `enterNode` |
| 2 | 或签：任一人通过即过，其余任务置 `cancelled` | `mode: "any"` 分支 |
| 3 | 会签：按 `minApproveRatio` 提前通过；`ratio < 1` 时阈值为 `floor(ratio*n)+1`；任一人驳回立即驳回 | `mode: "all"` + `join.ts` |
| 4 | 依次审批：同一时刻只有一条活动任务 | `mode: "sequential"` + `sequenceIndex` |
| 5 | 并行 fork / join：分支各自推进，join 按 `awaitingCount` 汇聚 | `join.ts` |
| 6 | 驳回策略 `to_initiator` / `to_prev` / `to_node:<id>` / `terminate` | `rejectTo()`，退回后合同 stage 置 `returned` |
| 7 | 加签：前/后/并，记录 `originTaskId`，加签人不推动主节点 | `addSignToTask` + `finishAddSignRun` |
| 8 | 转签：任务改派，原任务置 `transferred` | `transferTask` |
| 9 | 撤回：仅在任何人处理之前允许 | `withdrawInstance` |
| 10 | 超时：worker 每 5 分钟扫描，幂等（`IdempotencyKey`），动作 remind / auto_approve / auto_reject / transfer_to_manager | `processDueTasks` |
| 11 | 并发决策：乐观锁 + 3 次重试，重复决策返回 409 `TASK_ALREADY_DECIDED` | `runWithFlowRetry` + `updateMany` 状态守卫 |
| 12 | 实例只认冻结的 `definitionSnapshot`，后续发布新版本不影响在途 | `startFlowInstance` 落快照 |
| 13 | 发布前静态校验：空审批人、成环、不可达、fork 无 join、驳回目标不存在等 | `flow/validate.ts` |

幂等键统一走 `src/server/flow/idempotency.ts` 的 `claimOnce()`（`INSERT … ON CONFLICT DO NOTHING`）。
**不要改回 try/catch P2002**：Postgres 交互事务里唯一键冲突会把整个事务标记为 aborted，
之后每条语句都报 `25P02`，worker 的整轮扫描会静默回滚或直接失败。

---

## 7. 安全模型

- **鉴权只在服务端**：`requirePermission(userId, key)`、`requireContractAccess(userId, contractId, action)`
  叠加数据范围。UI 隐藏按钮只是体验，不是安全边界。
- **数据范围进 SQL**：`buildContractScope()` 生成 `where` 片段，列表与详情都注入同一份条件，
  不存在「查全量再过滤」。`self` 覆盖本人发起 / 参与 / 被抄送 / 有待办；`dept_and_sub` 用
  `Department.path` 前缀匹配子树。
- **审批资格**：仅当存在归属自己的 `pending` `FlowTask` 才能操作该节点，其余 403。
  委托代审时 `operatorId`（真实操作人）与 `actorId`（任务归属人）分开记录，
  `FlowTask.decidedBy` 与 `FlowEventLog.actorId` 写实际点按钮的人。
- **只追加审计**：`AuditLog` / `FlowEventLog` 由迁移 `REVOKE UPDATE, DELETE, TRUNCATE`，
  应用角色只有 INSERT。
- **附件**：扩展名 + MIME 双白名单（pdf/doc/docx/xls/xlsx/png/jpg）、单文件 ≤20 MB、
  文件名 sanitize、存储 key 随机 uuid；下载走 `/api/files/[id]`，未登录 401、越权 403。
- **注入防护**：Prisma 参数化；原生 SQL 只用 `$queryRaw`/`$executeRaw` 模板参数；
  排序字段白名单映射（`buildContractListOrderBy`）。
- **会话与登录**：HttpOnly + SameSite=Lax + Secure Cookie；连续 5 次失败锁 15 分钟（`LoginAttempt`）；
  密码 argon2；停用用户后其会话立即失效。
- **Server Action**：依赖 Next 内建 CSRF 保护，并在 `requirePermission` 之前校验会话。
- **导出**：CSV 带 UTF-8 BOM 与 RFC4180 转义，`=`/`+`/`-`/`@`/制表符开头的内容加前缀，防公式注入。
- **webhook**：主机白名单 + 5 秒超时，非 2xx 视为失败；白名单为空时一律拒绝，避免 SSRF。

---

## 8. 测试

```bash
npm run test        # Vitest：单测（纯函数/状态机/表达式/导出编码）+ 集成（真库 contract_test）
npm run test:e2e    # Playwright：登录、管理端、起草、流程配置、审批全链路、用印归档、报表审计、导出下载
```

集成测试跑在独立的 `contract_test` 库上（每次 `migrate reset`），串行执行以免相互干扰；
append-only 表由 `tests/helpers/db.ts` 用属主角色清理。

已覆盖的关键验收点：
会签 / 或签 / 比例通过语义、金额条件分支、定义快照不可变、加签与转签、
50 并发抢同一任务（1 成功 49 个 `TASK_ALREADY_DECIDED`）、并行分支驳回、
空审批人静态校验、越权 403、归档后只读、非法迁移抛错、审计表禁改禁删、
附件 401/403 与伪装文件拒绝、100 并发取合同编号、超时扫描幂等、
到期预警按阈值分桶幂等、台账导出的转义与公式防护、xlsx 可被独立读取器打开。

---

## 9. 明确未做（只留接口，无假实现）

电子签章第三方对接、OCR 解析、AI 条款审查、多租户 SaaS、财务凭证、ERP/OA 双向同步、移动端原生 App。
接口定义在 `src/server/integrations/`：

- `esign.ts` — 签章供应商适配
- `ocr.ts` — 合同文本识别
- `ai-review.ts` — 条款审查
- `erp.ts` — 外部系统同步

均只有 `interface` + `TODO(interface only)` 注释，没有任何伪装成实现的代码。
