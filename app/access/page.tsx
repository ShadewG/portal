import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { viewerOf } from "@/lib/accessAdmin";
import AccessDashboard from "./AccessDashboard";
import "./access.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Access · Home" };

/** /access (R-2159 M3): owner + access admins change access; other Portal admins see it read-only; everyone else goes
 *  to the one no-access page (X6, was a bare 404) where they can ask to become an access admin (owner answers).
 *  Every API route behind it checks again on its own (lib/accessAdmin.ts guard). */
export default async function AccessPage() {
  const viewer = await viewerOf(await auth());
  if (!viewer) redirect("/no-access?want=portal.access-admin");
  return <AccessDashboard can={viewer.can} isOwner={viewer.isOwner} />;
}
