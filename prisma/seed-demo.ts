import type { Prisma } from "../src/generated/prisma/client";
import { hashPassword } from "../src/server/auth/password";
import { prisma } from "../src/server/db/client";
import { startFlowInstance } from "../src/server/flow/engine";
import { validateFlowDefinition } from "../src/server/flow/validate";
import type { FlowDefinition } from "../src/shared/flow-definition";

const ADMIN_EMAIL = "admin@example.com";
const USER_PASSWORD = process.env.SEED_USER_PASSWORD ?? "User@12345";

const DEMO_DEPARTMENTS = [
  { name: "技术中心", path: "/hq/tech", parentPath: "/hq", sortOrder: 10 },
  { name: "法务合规部", path: "/hq/legal", parentPath: "/hq", sortOrder: 20 },
  { name: "基础运维部", path: "/hq/tech/infra", parentPath: "/hq/tech", sortOrder: 11 },
];

const DEMO_USERS = [
  {
    email: "zhangming@example.com",
    name: "张明",
    role: "manager",
    departmentPath: "/hq/tech",
    managerEmail: ADMIN_EMAIL,
    managesDepartment: "/hq/tech",
  },
  {
    email: "wangfang@example.com",
    name: "王芳",
    role: "legal",
    departmentPath: "/hq/legal",
    managerEmail: ADMIN_EMAIL,
    managesDepartment: "/hq/legal",
  },
  {
    email: "lihua@example.com",
    name: "李华",
    role: "manager",
    departmentPath: "/hq/tech/infra",
    managerEmail: "zhangming@example.com",
    managesDepartment: "/hq/tech/infra",
  },
  {
    email: "chenchen@example.com",
    name: "陈晨",
    role: "employee",
    departmentPath: "/hq/tech/infra",
    managerEmail: "lihua@example.com",
    managesDepartment: null,
  },
  {
    email: "zhaolei@example.com",
    name: "赵磊",
    role: "employee",
    departmentPath: "/hq/tech",
    managerEmail: "zhangming@example.com",
    managesDepartment: null,
  },
];

type SeedNode = Record<string, unknown> & { id: string; name: string; type: string };

const DEMO_FLOWS: {
  code: string;
  name: string;
  category: string;
  templateCode: string | null;
  nodes: SeedNode[];
}[] = [
  {
    code: "PURCHASE_STANDARD",
    name: "采购合同标准流程",
    category: "采购",
    templateCode: "PURCHASE",
    nodes: [
      { id: "start", type: "start", name: "发起", next: "amount" },
      {
        id: "amount",
        type: "condition",
        name: "金额分流",
        branches: [
          {
            id: "big",
            name: "50 万以上走法务与总经理",
            when: { left: "contract.amount", op: "gte", right: 500000 },
            next: "legal",
          },
          { id: "normal", name: "50 万以下只走部门主管", when: null, next: "dept" },
        ],
      },
      {
        id: "legal",
        type: "approval",
        name: "法务审核",
        assignee: { kind: "role", key: "legal" },
        mode: "any",
        requiredOpinionOn: ["reject"],
        reject: { policy: "to_initiator" },
        next: "ceo",
      },
      {
        id: "ceo",
        type: "approval",
        name: "总经理审批",
        assignee: { kind: "role", key: "admin" },
        mode: "all",
        minApproveRatio: 1,
        reject: { policy: "to_initiator" },
        next: "seal",
      },
      {
        id: "dept",
        type: "approval",
        name: "部门主管审批",
        assignee: { kind: "dept_manager", level: 1 },
        mode: "any",
        reject: { policy: "to_initiator" },
        timeout: { hours: 24, action: "remind" },
        capabilities: {
          addSign: ["before", "after", "parallel"],
          transfer: true,
          return: true,
          delegate: true,
        },
        next: "seal",
      },
      {
        id: "seal",
        type: "action",
        name: "生成用印申请",
        kind: "create_seal_record",
        payload: { sealType: "contract", copies: 2 },
        next: "end",
      },
      { id: "end", type: "end", name: "结束", result: "approved" },
    ],
  },
  {
    code: "SALES_FAST",
    name: "销售合同快速流程",
    category: "销售",
    templateCode: "SALES",
    nodes: [
      { id: "start", type: "start", name: "发起", next: "dept" },
      {
        id: "dept",
        type: "approval",
        name: "部门主管审批",
        assignee: { kind: "dept_manager", level: 1 },
        mode: "any",
        reject: { policy: "to_initiator" },
        capabilities: {
          addSign: ["before"],
          transfer: true,
          return: true,
          delegate: false,
        },
        next: "notify",
      },
      {
        id: "notify",
        type: "action",
        name: "通知销售负责人",
        kind: "notify",
        payload: { title: "销售合同审批通过", body: "请安排交付与开票" },
        next: "end",
      },
      { id: "end", type: "end", name: "结束", result: "approved" },
    ],
  },
  {
    code: "SERVICE_THREE_LEVEL",
    name: "服务合同三级审批",
    category: "服务",
    templateCode: null,
    nodes: [
      { id: "start", type: "start", name: "发起", next: "leader" },
      {
        id: "leader",
        type: "approval",
        name: "组长初审",
        assignee: { kind: "user", ids: ["__placeholder__"] },
        mode: "any",
        next: "legal",
      },
      {
        id: "legal",
        type: "approval",
        name: "法务复核",
        assignee: { kind: "role", key: "legal" },
        mode: "any",
        next: "admin",
      },
      {
        id: "admin",
        type: "approval",
        name: "管理员终审",
        assignee: { kind: "role", key: "admin" },
        mode: "all",
        minApproveRatio: 1,
        next: "end",
      },
      { id: "end", type: "end", name: "结束", result: "approved" },
    ],
  },
];

type SeedContract = {
  no: string;
  title: string;
  template: "PURCHASE" | "SALES";
  type: "purchase" | "sales" | "service";
  partyA: string;
  partyB: string;
  amount: string;
  status: "draft" | "approving" | "to_seal" | "active" | "rejected" | "archived";
  flow?: string;
  creator: string;
  department: string;
  signDate: string;
  startDate: string;
  endDate: string;
  body: string;
  form: Record<string, unknown>;
  seal?: {
    sealType: "contract" | "company";
    copies: number;
    pickedAt: string | null;
    returnedAt: string | null;
  };
  milestones?: { kind: SeedMilestoneKind; at: string; note?: string }[];
  cc?: string;
};

const PARTY_A = "91310000MA1FL0XX1A";
const PARTY_B = "91330100MA2GL1YY2B";
const PARTY_C = "91110108MA01ABCD3X";

type SeedMilestoneKind =
  | "sealed"
  | "effective"
  | "paid"
  | "expired"
  | "archived"
  | "terminated"
  | "expiry_warning";

const DEMO_CONTRACTS: SeedContract[] = [
  {
    no: "HT-PURCHASE-202610-9001",
    title: "办公终端采购（草稿）",
    template: "PURCHASE",
    type: "purchase",
    partyA: PARTY_A,
    partyB: PARTY_B,
    amount: "88000.00",
    status: "draft",
    creator: "chenchen@example.com",
    department: "/hq/tech/infra",
    signDate: "2026-10-12",
    startDate: "2026-10-20",
    endDate: "2027-10-19",
    body: "## 办公终端采购\n\n50 台开发机，三年质保，到货后 15 个工作日内完成验收。",
    form: {
      supplyName: "办公终端 50 台",
      deliveryDays: 20,
      deliveryDate: "2026-11-10",
      payMethod: "月结30天",
    },
  },
  {
    no: "HT-PURCHASE-202610-9002",
    title: "数据库集群扩容（审批中）",
    template: "PURCHASE",
    type: "purchase",
    partyA: PARTY_A,
    partyB: PARTY_B,
    amount: "680000.00",
    status: "approving",
    flow: "PURCHASE_STANDARD",
    creator: "chenchen@example.com",
    department: "/hq/tech/infra",
    signDate: "2026-10-18",
    startDate: "2026-11-01",
    endDate: "2027-10-31",
    body: "## 数据库集群扩容\n\n12 个数据节点 + 三年原厂服务，含迁移实施。",
    form: {
      supplyName: "数据库集群扩容",
      deliveryDays: 45,
      deliveryDate: "2026-12-15",
      payMethod: "月结60天",
    },
  },
  {
    no: "HT-PURCHASE-202610-9003",
    title: "机房巡检服务（待用印）",
    template: "PURCHASE",
    type: "service",
    partyA: PARTY_A,
    partyB: PARTY_C,
    amount: "260000.00",
    status: "to_seal",
    creator: "zhangming@example.com",
    department: "/hq/tech",
    signDate: "2026-09-28",
    startDate: "2026-10-01",
    endDate: "2027-09-30",
    body: "## 机房巡检服务\n\n每月两次现场巡检，含整改跟踪。",
    form: {
      supplyName: "机房巡检服务",
      deliveryDays: 30,
      deliveryDate: "2026-10-31",
      payMethod: "现结",
      acceptanceNote: "现场验收单签署后三个工作日内付款。",
    },
    seal: { sealType: "contract", copies: 2, pickedAt: null, returnedAt: null },
  },
  {
    no: "HT-PURCHASE-202610-9004",
    title: "网络安全评估（履行中）",
    template: "PURCHASE",
    type: "service",
    partyA: PARTY_A,
    partyB: PARTY_C,
    amount: "150000.00",
    status: "active",
    creator: "chenchen@example.com",
    department: "/hq/tech/infra",
    signDate: "2026-08-20",
    startDate: "2026-09-01",
    endDate: "2026-12-31",
    body: "## 网络安全评估\n\n渗透测试、整改建议与复测一次。",
    form: {
      supplyName: "网络安全评估",
      deliveryDays: 15,
      deliveryDate: "2026-09-15",
      payMethod: "月结30天",
    },
    seal: {
      sealType: "company",
      copies: 1,
      pickedAt: "2026-08-26",
      returnedAt: "2026-08-28",
    },
    milestones: [
      { kind: "sealed", at: "2026-08-26" },
      { kind: "effective", at: "2026-08-28" },
    ],
  },
  {
    no: "HT-SALES-202610-9005",
    title: "华东渠道经销合同（已驳回）",
    template: "SALES",
    type: "sales",
    partyA: PARTY_A,
    partyB: PARTY_B,
    amount: "460000.00",
    status: "rejected",
    creator: "zhaolei@example.com",
    department: "/hq/tech",
    signDate: "2026-10-20",
    startDate: "2026-11-01",
    endDate: "2027-10-31",
    body: "## 华东渠道经销\n\n年度框架协议，返点随季度销量浮动。",
    form: {
      region: "华东",
      channel: "经销",
      rebateRate: 12,
      deliveryAddress: "上海市静安区某路 8 号",
    },
  },
  {
    no: "HT-SALES-202610-9006",
    title: "直销服务合同（已归档）",
    template: "SALES",
    type: "sales",
    partyA: PARTY_A,
    partyB: PARTY_C,
    amount: "96000.00",
    status: "archived",
    creator: "zhaolei@example.com",
    department: "/hq/tech",
    signDate: "2025-11-10",
    startDate: "2025-12-01",
    endDate: "2026-11-30",
    body: "## 直销服务\n\n一年期运维订阅，含 7×12 响应。",
    form: {
      region: "华北",
      channel: "直销",
      deliveryAddress: "北京市海淀区中关村大街 1 号",
    },
    cc: "wangfang@example.com",
    milestones: [
      { kind: "sealed", at: "2025-11-18" },
      { kind: "effective", at: "2025-11-20" },
      {
        kind: "archived",
        at: "2026-10-09",
        note: "履行完毕，纸质件移交档案室 A-2026-118",
      },
    ],
  },
];

async function ensureCredential(userId: string, password: string): Promise<void> {
  const existing = await prisma.account.findFirst({
    where: { userId, providerId: "credential" },
  });
  if (existing) {
    return;
  }
  await prisma.account.create({
    data: {
      userId,
      accountId: userId,
      providerId: "credential",
      password: await hashPassword(password),
    },
  });
}

async function seedDepartments(adminId: string): Promise<Map<string, string>> {
  const hq = await prisma.department.findUniqueOrThrow({ where: { path: "/hq" } });
  const byPath = new Map<string, string>([[hq.path, hq.id]]);

  // 父级必须先于子级存在，按路径深度排序
  const ordered = [...DEMO_DEPARTMENTS].sort(
    (a, b) => a.path.split("/").length - b.path.split("/").length,
  );

  for (const item of ordered) {
    const parentId = byPath.get(item.parentPath);
    if (!parentId) {
      throw new Error(`部门父级不存在：${item.parentPath}`);
    }
    const row = await prisma.department.upsert({
      where: { path: item.path },
      update: {
        name: item.name,
        parentId,
        sortOrder: item.sortOrder,
        deletedAt: null,
        updatedBy: adminId,
      },
      create: {
        name: item.name,
        path: item.path,
        parentId,
        sortOrder: item.sortOrder,
        createdBy: adminId,
      },
    });
    byPath.set(row.path, row.id);
  }
  return byPath;
}

async function seedUsers(departments: Map<string, string>): Promise<Map<string, string>> {
  const byEmail = new Map<string, string>();
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
  byEmail.set(admin.email, admin.id);

  // 上级引用了同批用户，所以边解析边创建：谁的上级已入库就先建谁
  async function upsertSeedUser(item: (typeof DEMO_USERS)[number]): Promise<void> {
    const departmentId = departments.get(item.departmentPath);
    const managerUserId = byEmail.get(item.managerEmail);
    if (!departmentId || !managerUserId) {
      throw new Error(`用户 ${item.email} 的部门或上级未就绪`);
    }
    const role = await prisma.role.findUniqueOrThrow({ where: { key: item.role } });
    const user = await prisma.user.upsert({
      where: { email: item.email },
      update: {
        name: item.name,
        departmentId,
        managerUserId,
        status: "active",
        deletedAt: null,
      },
      create: {
        name: item.name,
        email: item.email,
        emailVerified: true,
        departmentId,
        managerUserId,
        status: "active",
      },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: { deletedAt: null },
      create: { userId: user.id, roleId: role.id },
    });
    await ensureCredential(user.id, USER_PASSWORD);
    byEmail.set(item.email, user.id);
  }

  const pending = [...DEMO_USERS];
  while (pending.length > 0) {
    const index = pending.findIndex((user) => byEmail.has(user.managerEmail));
    if (index < 0) {
      throw new Error(
        `种子用户的上级关系存在环：${pending.map((user) => user.email).join(",")}`,
      );
    }
    const [ready] = pending.splice(index, 1);
    if (ready) {
      await upsertSeedUser(ready);
    }
  }

  for (const item of DEMO_USERS) {
    if (!item.managesDepartment) {
      continue;
    }
    const departmentId = departments.get(item.managesDepartment);
    const userId = byEmail.get(item.email);
    if (departmentId && userId) {
      await prisma.department.update({
        where: { id: departmentId },
        data: { managerUserId: userId },
      });
    }
  }

  return byEmail;
}

type SeededFlow = { flowId: string; versionId: string; definition: FlowDefinition };

async function seedFlows(
  users: Map<string, string>,
  adminId: string,
): Promise<Map<string, SeededFlow>> {
  const result = new Map<string, SeededFlow>();
  const leaderId = users.get("lihua@example.com");
  if (!leaderId) {
    throw new Error("缺少李华，服务合同流程无法指定审批人");
  }

  for (const flow of DEMO_FLOWS) {
    const nodes = flow.nodes.map((node) =>
      node.id === "leader"
        ? { ...node, assignee: { kind: "user", ids: [leaderId] } }
        : node,
    );
    const definition = { schemaVersion: 1, entry: "start", nodes };

    const errors = validateFlowDefinition(definition).filter(
      (issue) => issue.level === "error",
    );
    if (errors.length > 0) {
      throw new Error(
        `种子流程 ${flow.code} 校验未通过：${errors.map((issue) => issue.message).join("；")}`,
      );
    }

    const row = await prisma.approvalFlow.upsert({
      where: { code: flow.code },
      update: {
        name: flow.name,
        category: flow.category,
        draftDefinition: definition as Prisma.InputJsonValue,
        deletedAt: null,
        updatedBy: adminId,
      },
      create: {
        code: flow.code,
        name: flow.name,
        category: flow.category,
        draftDefinition: definition as Prisma.InputJsonValue,
        createdBy: adminId,
      },
    });

    const version = await prisma.approvalFlowVersion.upsert({
      where: { flowId_version: { flowId: row.id, version: 1 } },
      update: {
        definition: definition as Prisma.InputJsonValue,
        status: "active",
        publishedBy: adminId,
        deletedAt: null,
      },
      create: {
        flowId: row.id,
        version: 1,
        definition: definition as Prisma.InputJsonValue,
        publishedBy: adminId,
        status: "active",
      },
    });

    await prisma.approvalFlow.update({
      where: { id: row.id },
      data: { latestVersion: 1 },
    });

    if (flow.templateCode) {
      await prisma.contractTemplate.updateMany({
        where: { code: flow.templateCode },
        data: { flowId: row.id },
      });
    }

    result.set(flow.code, {
      flowId: row.id,
      versionId: version.id,
      definition: definition as unknown as FlowDefinition,
    });
  }
  return result;
}

async function seedContracts(
  users: Map<string, string>,
  departments: Map<string, string>,
  flows: Map<string, SeededFlow>,
  adminId: string,
): Promise<void> {
  const templates = await prisma.contractTemplate.findMany({
    where: { code: { in: ["PURCHASE", "SALES"] } },
    select: { id: true, code: true, category: true },
  });
  const templateByCode = new Map(templates.map((item) => [item.code, item]));

  const types = await prisma.contractType.findMany({
    where: { key: { in: ["purchase", "sales", "service"] } },
    select: { id: true, key: true },
  });
  const typeByKey = new Map(types.map((item) => [item.key, item.id]));

  const usccs = [...new Set(DEMO_CONTRACTS.flatMap((item) => [item.partyA, item.partyB]))];
  const parties = await prisma.party.findMany({
    where: { uscc: { in: usccs } },
    select: { id: true, uscc: true, name: true },
  });
  const partyByUscc = new Map(parties.map((item) => [item.uscc, item]));

  for (const item of DEMO_CONTRACTS) {
    const template = templateByCode.get(item.template);
    const typeId = typeByKey.get(item.type);
    const partyA = partyByUscc.get(item.partyA);
    const partyB = partyByUscc.get(item.partyB);
    const creatorId = users.get(item.creator);
    const departmentId = departments.get(item.department);
    if (!template || !typeId || !partyA || !partyB || !creatorId || !departmentId) {
      throw new Error(`种子合同 ${item.no} 的主数据缺失`);
    }

    const contract = await prisma.contract.upsert({
      where: { no: item.no },
      update: {
        title: item.title,
        amount: item.amount,
        formData: item.form as Prisma.InputJsonValue,
        ownerDepartmentId: departmentId,
        updatedBy: adminId,
      },
      create: {
        no: item.no,
        title: item.title,
        templateId: template.id,
        typeId,
        partyAId: partyA.id,
        partyBId: partyB.id,
        amount: item.amount,
        currency: "CNY",
        signDate: new Date(`${item.signDate}T00:00:00.000Z`),
        startDate: new Date(`${item.startDate}T00:00:00.000Z`),
        endDate: new Date(`${item.endDate}T00:00:00.000Z`),
        status: item.status,
        formData: item.form as Prisma.InputJsonValue,
        ownerDepartmentId: departmentId,
        createdBy: creatorId,
      },
    });

    await prisma.contractVersion.upsert({
      where: { contractId_version: { contractId: contract.id, version: 1 } },
      update: { bodyMarkdown: item.body },
      create: {
        contractId: contract.id,
        version: 1,
        bodyMarkdown: item.body,
        changeSummary: "初始版本",
        createdBy: creatorId,
      },
    });

    if (item.seal) {
      const data = {
        copies: item.seal.copies,
        applicantId: creatorId,
        appliedAt: new Date(`${item.signDate}T02:00:00.000Z`),
        pickedAt: item.seal.pickedAt ? new Date(`${item.seal.pickedAt}T02:00:00.000Z`) : null,
        returnedAt: item.seal.returnedAt
          ? new Date(`${item.seal.returnedAt}T02:00:00.000Z`)
          : null,
        notaryNo: item.seal.returnedAt ? `YZ-2026-${item.no.slice(-4)}` : null,
      };
      const existing = await prisma.sealRecord.findFirst({
        where: { contractId: contract.id, sealType: item.seal.sealType },
        select: { id: true },
      });
      if (existing) {
        await prisma.sealRecord.update({ where: { id: existing.id }, data });
      } else {
        await prisma.sealRecord.create({
          data: { contractId: contract.id, sealType: item.seal.sealType, ...data },
        });
      }
    }

    for (const milestone of item.milestones ?? []) {
      const existing = await prisma.contractMilestone.findFirst({
        where: { contractId: contract.id, kind: milestone.kind },
        select: { id: true },
      });
      if (existing) {
        continue;
      }
      await prisma.contractMilestone.create({
        data: {
          contractId: contract.id,
          kind: milestone.kind,
          at: new Date(`${milestone.at}T02:00:00.000Z`),
          note: milestone.note ?? null,
          operatorId: adminId,
          createdBy: adminId,
        },
      });
    }

    if (item.cc) {
      const ccUserId = users.get(item.cc);
      if (ccUserId) {
        await prisma.contractParticipant.upsert({
          where: {
            contractId_userId_kind: {
              contractId: contract.id,
              userId: ccUserId,
              kind: "cc",
            },
          },
          update: {},
          create: { contractId: contract.id, userId: ccUserId, kind: "cc" },
        });
      }
    }

    // 「审批中」那份走真实引擎，工作台与待办中心才有可操作的任务
    if (item.status === "approving" && item.flow) {
      const flow = flows.get(item.flow);
      if (!flow) {
        throw new Error(`种子合同 ${item.no} 找不到流程 ${item.flow}`);
      }
      const running = await prisma.flowInstance.findFirst({
        where: { contractId: contract.id, status: "running", deletedAt: null },
        select: { id: true },
      });
      if (running) {
        continue;
      }

      await prisma.contract.update({
        where: { id: contract.id },
        data: { status: "draft" },
      });
      await prisma.$transaction((tx) =>
        startFlowInstance(tx, {
          contractId: contract.id,
          flowId: flow.flowId,
          flowVersionId: flow.versionId,
          definition: flow.definition,
          initiatorId: creatorId,
          context: {
            contract: {
              id: contract.id,
              no: contract.no,
              title: contract.title,
              amount: Number(item.amount),
              currency: "CNY",
              category: template.category,
              typeKey: item.type,
              templateCode: template.code,
              partyA: partyA.name,
              partyB: partyB.name,
              signDate: item.signDate,
              startDate: item.startDate,
              endDate: item.endDate,
              days: 365,
            },
            form: item.form,
            initiator: { id: creatorId, departmentId, managerUserId: "" },
          },
        }),
      );
    }
  }
}

export async function seedDemoWorld(adminId: string): Promise<void> {
  const departments = await seedDepartments(adminId);
  const users = await seedUsers(departments);
  const flows = await seedFlows(users, adminId);
  await seedContracts(users, departments, flows, adminId);
}
