export type ESignEnvelopeStatus =
  | "draft"
  | "sent"
  | "signed"
  | "declined"
  | "voided";

export type ESignSigner = {
  name: string;
  email: string;
  role: "party_a" | "party_b" | "witness";
};

export type ESignEnvelope = {
  envelopeId: string;
  status: ESignEnvelopeStatus;
  signedAt: string | null;
};

export interface ESignProvider {
  createEnvelope(input: {
    contractId: string;
    documentStorageKey: string;
    signers: ESignSigner[];
  }): Promise<ESignEnvelope>;
  getEnvelope(envelopeId: string): Promise<ESignEnvelope>;
}

// TODO(interface only): 电子签章第三方对接不在本期范围，仅保留供应商适配契约。
