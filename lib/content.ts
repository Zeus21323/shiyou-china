export interface ScenicArea {
  id: string;
  name: string;
  city: string;
  district: string;
  grade: '4A' | '5A';
  gradeAsOf: string;
  sourceId: string;
}
export interface Work {
  id: string;
  title: string;
  author: string;
  dynasty: string;
  genre: '诗' | '词' | '文' | '诗词';
  body: string;
  sourceUrl: string;
  relation: string;
  evidence: string;
  evidenceUrl?: string;
  scenicId: string;
  verification?: 'verified' | 'candidate' | 'regional';
  sourceFile?: string;
  sourceRow?: number;
}
export interface Catalog {
  asOf: string;
  sourceUrl: string;
  scenicAreas: ScenicArea[];
}
