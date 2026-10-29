export type ErpContractPayload = {
  contractNo: string;
  title: string;
  amount: string;
  currency: string;
  partyName: string;
  signedAt: string;
};

export interface ErpSyncProvider {
  pushContract(payload: ErpContractPayload): Promise<{ remoteId: string }>;
  pullVoucher(contractNo: string): Promise<unknown | null>;
}

// TODO(interface only): ERP/OA 双向同步不在本期范围，仅保留同步适配契约。
