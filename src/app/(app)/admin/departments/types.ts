export type DepartmentRow = {
  id: string;
  name: string;
  parentId: string | null;
  path: string;
  sortOrder: number;
  managerId: string | null;
  managerName: string | null;
  userCount: number;
  level: number;
};
