import { describe, expect, it } from "vitest";
import {
  PERMISSION_DEFINITIONS,
  PERMISSION_KEYS,
  ROLE_DEFINITIONS,
  ROLE_KEYS,
} from "@/shared/permissions";

describe("权限定义", () => {
  it("权限 key 唯一且都有中文说明", () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
    for (const key of PERMISSION_KEYS) {
      expect(PERMISSION_DEFINITIONS[key].name.length).toBeGreaterThan(0);
      expect(PERMISSION_DEFINITIONS[key].group.length).toBeGreaterThan(0);
    }
  });

  it("角色授予的权限都来自权限白名单", () => {
    const allowed = new Set<string>(PERMISSION_KEYS);
    for (const role of ROLE_DEFINITIONS) {
      for (const permission of role.permissions) {
        expect(allowed.has(permission)).toBe(true);
      }
    }
  });

  it("系统管理员拥有全部权限，普通员工只有自助权限", () => {
    const admin = ROLE_DEFINITIONS.find((role) => role.key === ROLE_KEYS.admin);
    const employee = ROLE_DEFINITIONS.find(
      (role) => role.key === ROLE_KEYS.employee,
    );
    expect(admin?.permissions).toEqual(PERMISSION_KEYS);
    expect(employee?.permissions).not.toContain("contract.approve");
    expect(employee?.scope).toBe("self");
  });

  it("角色 key 唯一", () => {
    const keys = ROLE_DEFINITIONS.map((role) => role.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
