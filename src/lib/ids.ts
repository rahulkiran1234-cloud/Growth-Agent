const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route ids go straight into SQL: reject anything that isn't a UUID before touching the database. */
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID.test(s);

export const notFound = () => Response.json({ error: "Not found" }, { status: 404 });
