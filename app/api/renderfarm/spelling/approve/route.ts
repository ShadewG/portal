import { spellingRelay } from "@/lib/renderfarmSpellingRelay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 250;

export async function POST(req: Request) {
  return spellingRelay(req, "approve");
}
