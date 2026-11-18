import { NextResponse } from "next/server";
import { getProviderCatalog } from "@/lib/provider-catalog";

export const runtime = "nodejs";
export async function GET() { return NextResponse.json(getProviderCatalog()); }
