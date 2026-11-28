import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { viewerOf } from "@/lib/accessAdmin";
import AccessDashboard from "./AccessDashboard";
import FeedbackButton from "../FeedbackButton";
import "./access.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "ACCESS · COMMAND CENTER" };

/** /access (R-2159 M3): owner + access admins change access; other Portal admins see it read-only; everyone else 404.
 *  Every API route behind it checks again on its own (lib/accessAdmin.ts guard). */
export default async function AccessPage() {
  const viewer = await viewerOf(await auth());
  if (!viewer) notFound();
  return (
    <>
      <AccessDashboard can={viewer.can} isOwner={viewer.isOwner} />
      <FeedbackButton page="/access" />
    </>
  );
}
