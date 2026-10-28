import { toPublic } from "@/lib/auth/accounts";
import { requireUser } from "@/lib/auth/guard";
import { handle, json } from "@/lib/http";

export const GET = handle(async (request: Request) => json({ account: toPublic(await requireUser(request)) }));
