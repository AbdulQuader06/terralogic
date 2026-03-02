import type { SiteAnalysis } from "@shared/schema";

export interface IStorage {
  getAnalysis(key: string): Promise<SiteAnalysis | undefined>;
  saveAnalysis(key: string, analysis: SiteAnalysis): Promise<void>;
}

export class MemStorage implements IStorage {
  private analyses: Map<string, SiteAnalysis>;

  constructor() {
    this.analyses = new Map();
  }

  async getAnalysis(key: string): Promise<SiteAnalysis | undefined> {
    return this.analyses.get(key);
  }

  async saveAnalysis(key: string, analysis: SiteAnalysis): Promise<void> {
    this.analyses.set(key, analysis);
  }
}

export const storage = new MemStorage();