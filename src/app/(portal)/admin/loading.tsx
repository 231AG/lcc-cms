import { Preloader } from "@/components/ui/Preloader";

/**
 * Covers every /admin/* route. Before this existed, navigating to an admin
 * page showed the previous page frozen for several seconds with no
 * indication anything was happening -- these pages do real cross-region
 * database work on every render.
 *
 * One shared pre-loader rather than a bespoke skeleton per route: the
 * skeletons that used to live here had to be kept in step with every
 * redesign of the page behind them, and drifted from it anyway.
 */
export default function AdminLoading() {
  return <Preloader />;
}
