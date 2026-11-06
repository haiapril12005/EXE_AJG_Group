import type { NextFunction, Request, Response } from "express";
import { fromSupabaseUrl } from "@supabase/server";
import { verifyAuth } from "@supabase/server/core";
import { config } from "./config";
import { HttpError } from "./errors";

export interface AuthenticatedRequest extends Request {
  userId?: string;
}

export async function requireAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const header = req.header("authorization");
    if (!header?.startsWith("Bearer ")) {
      throw new HttpError(401, "Authentication required");
    }

    const headers = new Headers({ authorization: header });
    const apiKey = req.header("apikey");
    if (apiKey) headers.set("apikey", apiKey);
    const request = new Request("http://localhost/", {
      method: req.method,
      headers
    });
    const { data, error } = await verifyAuth(request, {
      auth: "user",
      audience: "authenticated",
      issuer: fromSupabaseUrl(config.SUPABASE_URL),
      env: {
        url: config.SUPABASE_URL,
        publishableKeys: { default: config.SUPABASE_PUBLISHABLE_KEY },
        secretKeys: { default: config.SUPABASE_SECRET_KEY },
        jwks: new URL(config.SUPABASE_JWKS_URL)
      }
    });
    if (error) {
      throw new HttpError(error.status === 500 ? 503 : 401, error.message);
    }
    if (!data.userClaims?.id) throw new HttpError(401, "Invalid or expired access token");
    req.userId = data.userClaims.id;
    next();
  } catch (error) {
    next(error);
  }
}
