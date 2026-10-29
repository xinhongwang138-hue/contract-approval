"use client";

import { useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchUsersAction, type UserOption } from "@/server/actions/user-search";

export function UserPicker({
  id,
  selected,
  onChange,
  initialUsers = [],
  multi,
  disabled,
  max = 10,
}: {
  id: string;
  selected: UserOption[];
  onChange: (next: UserOption[]) => void;
  initialUsers?: UserOption[];
  multi: boolean;
  disabled?: boolean;
  max?: number;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserOption[]>(initialUsers);
  const [searched, setSearched] = useState(false);
  const [searching, startSearching] = useTransition();

  const selectedIds = new Set(selected.map((user) => user.id));

  function runSearch(): void {
    startSearching(async () => {
      const result = await searchUsersAction(query);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setResults(result.data);
      setSearched(true);
    });
  }

  function toggle(user: UserOption, checked: boolean): void {
    if (checked) {
      if (selectedIds.has(user.id)) {
        return;
      }
      if (!multi) {
        onChange([user]);
        return;
      }
      if (selected.length >= max) {
        toast.error(`最多选择 ${max} 人`);
        return;
      }
      onChange([...selected, user]);
      return;
    }
    onChange(selected.filter((item) => item.id !== user.id));
  }

  return (
    <div className="space-y-2">
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {selected.map((user) => (
            <Badge key={user.id} variant="secondary" className="gap-1">
              {user.name}
              {user.departmentName ? ` · ${user.departmentName}` : ""}
              {!disabled ? (
                <button
                  type="button"
                  aria-label={`移除 ${user.name}`}
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => toggle(user, false)}
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </Badge>
          ))}
        </div>
      ) : null}

      <div className="flex gap-2">
        <Input
          id={id}
          value={query}
          placeholder="输入姓名或邮箱，回车搜索"
          disabled={disabled}
          className="h-8"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              runSearch();
            }
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || searching}
          onClick={runSearch}
        >
          <Search className="size-3.5" />
          {searching ? "搜索中…" : "搜索"}
        </Button>
      </div>

      <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
        {results.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">
            {searched ? "没有匹配的有效账号。" : "输入姓名或邮箱后回车搜索。"}
          </p>
        ) : null}
        {results.map((user) => (
          <label key={user.id} className="flex items-center gap-2 text-sm">
            <input
              type={multi ? "checkbox" : "radio"}
              name={multi ? undefined : `${id}-single`}
              className="size-4 accent-primary"
              disabled={disabled}
              checked={selectedIds.has(user.id)}
              onChange={(event) => toggle(user, event.target.checked)}
            />
            <span className="truncate">{user.name}</span>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              {user.departmentName ?? "未分配部门"}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
