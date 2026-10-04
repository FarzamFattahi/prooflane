export type Rect = { x: number; y: number; width: number; height: number };
export type ImagePixels = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};
export type CompareOptions = {
  threshold: number;
  minRegionPixels: number;
  ignores: Rect[];
};
export type ChangeRegion = Rect & { id: string; pixels: number };
export type Comparison = {
  width: number;
  height: number;
  changedPixels: number;
  comparedPixels: number;
  ignoredPixels: number;
  changedPercent: number;
  regions: ChangeRegion[];
  omittedRegions: number;
  omittedPixels: number;
  mask: Uint8Array;
  durationMs: number;
};
export type LoadedImage = ImagePixels & { name: string; url: string };
export type Decision = "unreviewed" | "expected" | "fix";
export type Review = { decision: Decision; note: string };
export type WorkerRequest = {
  id: number;
  baseline: ImagePixels;
  candidate: ImagePixels;
  options: CompareOptions;
};
export type WorkerResponse = {
  id: number;
  result?: Comparison;
  error?: string;
};
