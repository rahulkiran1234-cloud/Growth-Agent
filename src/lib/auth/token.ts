import { createHash } from "node:crypto";

/** Only this hash of the cookie token is stored in the database. */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
