import {
  createReplaysService,
  createRouterService,
  createRulesService,
  createTargetsService,
} from "core/routing";
import { routingRepo } from "database/routing";
import { rulesRepo } from "database/rules";
import { targetsRepo } from "database/targets";
import { routerConfig } from "./routing.config.js";
import {
  ReplaysHandlers,
  RulesHandlers,
  TargetsHandlers,
} from "./routing.handlers.js";

export const routerService = createRouterService({
  routingRepository: routingRepo,
  leaseMs: routerConfig.leaseMs,
  retryBaseMs: routerConfig.retryBaseMs,
  retryMaxMs: routerConfig.retryMaxMs,
  schedule: {
    timeZone: routerConfig.timeZone,
    quietHoursStart: routerConfig.quietHoursStart,
    quietHoursEnd: routerConfig.quietHoursEnd,
  },
});

export const rulesService = createRulesService({ rulesRepository: rulesRepo });

export const targetsService = createTargetsService({
  targetsRepository: targetsRepo,
  smsReadiness: routerConfig.smsReadiness,
});

export const replaysService = createReplaysService({
  routingRepository: routingRepo,
  routerService,
});

export const rulesHandlers = new RulesHandlers(rulesService);
export const targetsHandlers = new TargetsHandlers(targetsService);
export const replaysHandlers = new ReplaysHandlers(replaysService);
