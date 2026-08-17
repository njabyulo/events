import { expect, test, vi } from "vitest";
import {
  createRulesService,
  RoutingConflictError,
  RoutingValidationError,
  type RuleRecord,
  type RulesRepository,
} from "../../../src/routing/index.js";

function rule(overrides: Partial<RuleRecord> = {}): RuleRecord {
  return {
    id: "1",
    name: "github.career",
    enabled: true,
    currentVersion: 1,
    version: {
      ruleId: "1",
      version: 1,
      pattern: { source: ["github"] },
      priority: "normal",
      createdAt: "2026-08-16T12:00:00.000Z",
    },
    targetIds: [],
    validationError: null,
    invalidAt: null,
    createdAt: "2026-08-16T12:00:00.000Z",
    updatedAt: "2026-08-16T12:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function repository(stored = rule()): RulesRepository {
  return {
    listRules: vi.fn(async () => [stored]),
    getRule: vi.fn(async (id) => id === stored.id ? stored : null),
    getRuleVersion: vi.fn(async () => stored.version),
    listRuleVersions: vi.fn(async () => [stored.version]),
    createRule: vi.fn(async (input) => rule({
      name: input.name,
      enabled: input.enabled,
      version: { ...stored.version, pattern: input.pattern, priority: input.priority },
    })),
    updateRule: vi.fn(async () => stored),
    deleteRule: vi.fn(async () => true),
    attachTarget: vi.fn(async () => true),
    detachTarget: vi.fn(async () => true),
  };
}

test("rule creation validates the pattern before persistence", async () => {
  const rulesRepository = repository();
  const service = createRulesService({ rulesRepository });

  await expect(service.createRule({
    name: "github.invalid",
    pattern: { source: [{ suffix: "hub" }] },
  })).rejects.toBeInstanceOf(RoutingValidationError);
  expect(rulesRepository.createRule).not.toHaveBeenCalled();
});

test("the protected fallback cannot be edited or have targets detached", async () => {
  const rulesRepository = repository(rule({
    id: "99",
    name: "system.unclassified",
    targetIds: ["98"],
  }));
  const service = createRulesService({ rulesRepository });

  await expect(service.updateRule("99", { enabled: false }))
    .rejects.toBeInstanceOf(RoutingConflictError);
  await expect(service.detachTarget("99", "98"))
    .rejects.toBeInstanceOf(RoutingConflictError);
  expect(rulesRepository.updateRule).not.toHaveBeenCalled();
  expect(rulesRepository.detachTarget).not.toHaveBeenCalled();
});
