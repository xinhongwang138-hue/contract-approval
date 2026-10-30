"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Archive,
  BarChart3,
  Bell,
  Building2,
  FileStack,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Network,
  ScrollText,
  ShieldCheck,
  Stamp,
  Users,
  UserCog,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { logoutAction } from "@/server/actions/auth";
import type { SessionUser } from "@/server/auth/session";
import type { PermissionKey } from "@/shared/permissions";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  permissions?: PermissionKey[];
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    label: "工作",
    items: [
      { href: "/", label: "工作台", icon: LayoutDashboard },
      { href: "/contracts", label: "合同管理", icon: FileText, permissions: ["contract.read"] },
      { href: "/seals", label: "用印管理", icon: Stamp, permissions: ["contract.seal"] },
      { href: "/archive", label: "合同归档", icon: Archive, permissions: ["contract.archive"] },
      { href: "/notifications", label: "消息通知", icon: Bell },
    ],
  },
  {
    label: "分析",
    items: [
      {
        href: "/reports/efficiency",
        label: "效率报表",
        icon: BarChart3,
        permissions: ["report.read"],
      },
      { href: "/audit", label: "审计日志", icon: ScrollText, permissions: ["audit.read"] },
    ],
  },
  {
    label: "管理",
    items: [
      {
        href: "/admin/flows",
        label: "审批流程",
        icon: Workflow,
        permissions: ["flow.create", "flow.publish", "flow.manage"],
      },
      { href: "/admin/templates", label: "合同模板", icon: FileStack, permissions: ["flow.manage"] },
      { href: "/admin/parties", label: "相对方", icon: Building2, permissions: ["contract.create"] },
      { href: "/admin/departments", label: "部门", icon: Network, permissions: ["system.user.manage"] },
      { href: "/admin/users", label: "用户", icon: Users, permissions: ["system.user.manage"] },
      { href: "/admin/roles", label: "角色权限", icon: ShieldCheck, permissions: ["system.role.manage"] },
      { href: "/admin/delegates", label: "审批委托", icon: UserCog, permissions: ["contract.approve"] },
    ],
  },
];

function visibleGroups(permissions: readonly PermissionKey[]): NavGroup[] {
  const granted = new Set(permissions);
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => !item.permissions || item.permissions.some((key) => granted.has(key)),
    ),
  })).filter((group) => group.items.length > 0);
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({
  pathname,
  groups,
}: {
  pathname: string;
  groups: NavGroup[];
}) {
  return (
    <nav className="space-y-6 px-3 py-4">
      {groups.map((group) => (
        <div key={group.label} className="space-y-1">
          <p className="px-3 pb-1 text-xs font-medium tracking-wide text-muted-foreground">
            {group.label}
          </p>
          {group.items.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function BrandHeader() {
  return (
    <div className="flex h-14 items-center border-b px-5">
      <Link href="/" className="flex items-center gap-2 font-semibold">
        <FileStack className="size-5" />
        合同审批系统
      </Link>
    </div>
  );
}

export function AppShell({
  user,
  permissions,
  children,
}: {
  user: SessionUser;
  permissions: PermissionKey[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const groups = visibleGroups(permissions);

  // 1fr 的默认 min-width 是 auto，宽表会把整列顶出视口；minmax(0,1fr) 才让表格自己横向滚
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="hidden border-r bg-sidebar lg:block">
        <BrandHeader />
        <NavLinks pathname={pathname} groups={groups} />
      </aside>

      <div className="flex min-h-screen flex-col">
        <header className="flex h-14 items-center gap-3 border-b bg-background px-4 lg:px-8">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden">
                <Menu className="size-5" />
                <span className="sr-only">打开导航</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 bg-sidebar p-0">
              <SheetHeader className="border-b">
                <SheetTitle>合同审批系统</SheetTitle>
              </SheetHeader>
              <div onClick={() => setMobileOpen(false)}>
                <NavLinks pathname={pathname} groups={groups} />
              </div>
            </SheetContent>
          </Sheet>

          <div className="ml-auto flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-medium leading-tight">{user.name}</p>
              <p className="text-xs text-muted-foreground leading-tight">
                {user.email}
              </p>
            </div>
            <form action={logoutAction}>
              <Button variant="ghost" size="icon" type="submit">
                <LogOut className="size-4" />
                <span className="sr-only">退出登录</span>
              </Button>
            </form>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
