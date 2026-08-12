"use client";

// recharts is ~120 KB gzipped and was eagerly bundled into every page that shows a chart (the sheet,
// expenses, finance, analysis…), bloating first load. The charts are secondary/below-the-fold, so we
// code-split recharts out via next/dynamic (ssr:false) — the page paints and hydrates without it, and
// each chart loads its own chunk on demand, showing a light skeleton meanwhile. The public API is
// unchanged: server pages still `import { MoneyFlowDonut } from "@/components/Charts"`.
import dynamic from "next/dynamic";

const Skeleton = ({ h = "h-48" }: { h?: string }) => <div className={`w-full ${h} animate-pulse rounded-lg bg-slate-100`} />;

export const TrendChart = dynamic(() => import("./ChartsImpl").then((m) => m.TrendChart), { ssr: false, loading: () => <Skeleton h="h-40" /> });
export const BucketTrend = dynamic(() => import("./ChartsImpl").then((m) => m.BucketTrend), { ssr: false, loading: () => <Skeleton h="h-40" /> });
export const SpendBars = dynamic(() => import("./ChartsImpl").then((m) => m.SpendBars), { ssr: false, loading: () => <Skeleton h="h-40" /> });
export const CategoryBars = dynamic(() => import("./ChartsImpl").then((m) => m.CategoryBars), { ssr: false, loading: () => <Skeleton h="h-48" /> });
export const CategoryRangeChart = dynamic(() => import("./ChartsImpl").then((m) => m.CategoryRangeChart), { ssr: false, loading: () => <Skeleton h="h-64" /> });
export const MoneyFlowDonut = dynamic(() => import("./ChartsImpl").then((m) => m.MoneyFlowDonut), { ssr: false, loading: () => <Skeleton h="h-48" /> });
export const SplitPie = dynamic(() => import("./ChartsImpl").then((m) => m.SplitPie), { ssr: false, loading: () => <Skeleton h="h-48" /> });
