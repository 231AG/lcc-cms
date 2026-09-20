import { Preloader } from "@/components/ui/Preloader";

/** Covers /portal and everything under it -- the student's dashboard,
 *  grades and grade sheets. These had no loader at all, so a student
 *  tapping a menu item saw the page they had just left, unchanged, until
 *  the new one arrived. */
export default function PortalLoading() {
  return <Preloader />;
}
