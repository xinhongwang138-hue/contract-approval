export type ClauseFinding = {
  clause: string;
  severity: "info" | "warning" | "risk";
  message: string;
};

export interface ClauseReviewer {
  review(input: {
    contractId: string;
    bodyMarkdown: string;
    fieldValues: Record<string, unknown>;
  }): Promise<ClauseFinding[]>;
}

// TODO(interface only): AI 条款审查不在本期范围，仅保留审查适配契约。
