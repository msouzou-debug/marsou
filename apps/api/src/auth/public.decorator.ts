import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC = "ecapital:public";

/**
 * Marks a route that needs no token. In M0 that is GET /health and, while
 * DEV_AUTH is on, the route that hands out development tokens. Nothing else.
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);
