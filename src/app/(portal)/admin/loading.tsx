import { SkeletonPage } from "@/components/ui/Skeleton";

/**
 * Covers every /admin/* route. Before this existed, navigating to an admin
 * page showed the previous page frozen for several seconds with no
 * indication anything was happening -- these pages do real cross-region
 * database work on every render.
 *
 * One shared shell rather than a bespoke skeleton per route: the admin
 * pages share a title-block / controls / table-in-a-card structure, and a
 * per-route skeleton would be one more thing to keep in sync with a
 * redesign for very little gain.
 */
export default function AdminLoading() {
  return <SkeletonPage />;
}
