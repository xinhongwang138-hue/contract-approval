export type OcrResult = {
  text: string;
  confidence: number;
  pages: number;
};

export interface OcrProvider {
  recognize(input: {
    storageKey: string;
    mime: string;
  }): Promise<OcrResult>;
}

// TODO(interface only): OCR 解析不在本期范围，仅保留识别适配契约。
