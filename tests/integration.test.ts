
import {
  describe,
  expect,
  it,
} from "vitest";

import { randomUUID } from "node:crypto";

const BASE_URL =
  process.env.TEST_API_URL ?? "http://localhost:3000";

type JsonObject = Record<string, any>;

interface ApiResponse {
  status: number;
  body: JsonObject;
}

interface TestAccount {
  id: string;
  apiKey: string;
  planId: string;
}

interface TestUser {
  id: string;
  externalUserId: string;
}

async function request(
  method: string,
  path: string,
  body?: JsonObject,
  apiKey?: string
): Promise<ApiResponse> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...(apiKey
        ? { "X-API-Key": apiKey }
        : {}),
    },
    ...(body !== undefined
      ? { body: JSON.stringify(body) }
      : {}),
    signal: AbortSignal.timeout(15000),
  });

  return {
    status: response.status,
    body: (await response.json()) as JsonObject,
  };
}

async function predefinedPlan(
  name: string,
  type: "ACCOUNT" | "USER"
): Promise<string> {
  const response = await request("GET", "/plans");

  expect(response.status).toBe(200);

  const plan = response.body.plans.find(
    (item: JsonObject) =>
      item.name === name &&
      item.planType === type
  );

  expect(plan).toBeDefined();

  return plan.id as string;
}

async function createAccount(): Promise<TestAccount> {
  const planId = await predefinedPlan(
    "Starter",
    "ACCOUNT"
  );

  const response = await request("POST", "/accounts", {
    name: `Integration Test ${randomUUID()}`,
    planId,
  });

  expect(response.status).toBe(201);
  expect(response.body.apiKey).toMatch(/^[a-f0-9]{64}$/);

  return {
    id: response.body.account.id,
    apiKey: response.body.apiKey,
    planId,
  };
}

async function createUser(
  account: TestAccount,
  planName: "Basic" | "Premium" = "Basic"
): Promise<TestUser> {
  const planId = await predefinedPlan(
    planName,
    "USER"
  );

  const externalUserId = `test-${randomUUID()}`;

  const response = await request(
    "POST",
    "/users",
    {
      externalUserId,
      planId,
    },
    account.apiKey
  );

  expect(response.status).toBe(201);

  return {
    id: response.body.user.id,
    externalUserId,
  };
}

async function createCustomPlan(
  account: TestAccount,
  type: "ACCOUNT" | "USER",
  monthlyAllowance: number,
  maxUnitsPerRequest: number
): Promise<string> {
  const response = await request(
    "POST",
    "/plans",
    {
      name: `Test Plan ${randomUUID()}`,
      planType: type,
      monthlyAllowance,
      maxUnitsPerRequest,
    },
    account.apiKey
  );

  expect(response.status).toBe(201);

  return response.body.plan.id as string;
}

async function assignAccountPlan(
  account: TestAccount,
  planId: string
): Promise<void> {
  const response = await request(
    "PUT",
    "/accounts/plan",
    { planId },
    account.apiKey
  );

  expect(response.status).toBe(200);
}

async function assignUserPlan(
  account: TestAccount,
  userId: string,
  planId: string
): Promise<void> {
  const response = await request(
    "PUT",
    `/users/${userId}/plan`,
    { planId },
    account.apiKey
  );

  expect(response.status).toBe(200);
}

async function consume(
  account: TestAccount,
  userId: string,
  units: number,
  requestId: string = randomUUID()
): Promise<ApiResponse> {
  return request(
    "POST",
    "/consumption",
    { userId, units, requestId },
    account.apiKey
  );
}

describe("Usage Metering and Quota Service", () => {

  it("checks API and database health", async () => {
    const response = await request("GET", "/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
      database: "connected",
    });
  });

  it("creates accounts and validates API keys", async () => {
    const account = await createAccount();

    const valid = await request(
      "GET",
      "/accounts/me",
      undefined,
      account.apiKey
    );

    expect(valid.status).toBe(200);
    expect(valid.body.account.id).toBe(account.id);

    const missing = await request(
      "GET",
      "/accounts/me"
    );

    expect(missing.status).toBe(401);

    const invalid = await request(
      "GET",
      "/accounts/me",
      undefined,
      "a".repeat(64)
    );

    expect(invalid.status).toBe(401);
  });

  it("isolates users and plans between accounts", async () => {
    const first = await createAccount();
    const second = await createAccount();

    const user = await createUser(first);

    const forbiddenUser = await request(
      "GET",
      `/users/${user.id}`,
      undefined,
      second.apiKey
    );

    expect(forbiddenUser.status).toBe(404);

    const forbiddenUsage = await request(
      "GET",
      `/usage/users/${user.id}`,
      undefined,
      second.apiKey
    );

    expect(forbiddenUsage.status).toBe(404);

    const foreignConsumption = await consume(
      second,
      user.id,
      5
    );

    expect(foreignConsumption.status).toBe(404);

    const customPlan = await createCustomPlan(
      first,
      "USER",
      100,
      10
    );

    const forbiddenPlanUpdate = await request(
      "PATCH",
      `/plans/${customPlan}`,
      { monthlyAllowance: 200 },
      second.apiKey
    );

    expect(forbiddenPlanUpdate.status).toBe(404);

    const forbiddenPlanAssignment = await request(
      "PUT",
      "/accounts/plan",
      { planId: customPlan },
      second.apiKey
    );

    expect(forbiddenPlanAssignment.status).toBe(400);

    const forbiddenUserAssignment = await request(
      "PUT",
      `/users/${user.id}/plan`,
      { planId: customPlan },
      second.apiKey
    );

    expect(forbiddenUserAssignment.status).toBe(404);

    const foreignHistory = await request(
      "GET",
      `/history?userId=${user.id}`,
      undefined,
      second.apiKey
    );

    expect(foreignHistory.status).toBe(404);
  });

  it("accepts usage and rejects user per-request limits", async () => {
    const account = await createAccount();
    const user = await createUser(account);

    const accepted = await consume(
      account,
      user.id,
      10
    );

    expect(accepted.status).toBe(200);
    expect(accepted.body.accepted).toBe(true);
    expect(accepted.body.replayed).toBe(false);

    const rejected = await consume(
      account,
      user.id,
      25
    );

    expect(rejected.status).toBe(200);
    expect(rejected.body.accepted).toBe(false);
    expect(rejected.body.rejectionScope).toBe("USER");
    expect(rejected.body.rejectionRule).toBe(
      "MAX_PER_REQUEST"
    );

    const usage = await request(
      "GET",
      `/usage/users/${user.id}`,
      undefined,
      account.apiKey
    );

    expect(usage.status).toBe(200);
    expect(usage.body.user.usage.consumed).toBe("10");
    expect(usage.body.user.usage.remaining).toBe("990");
  });

  it("preserves idempotency and rejects conflicting retries", async () => {
    const account = await createAccount();
    const user = await createUser(account);

    const requestId = randomUUID();

    const first = await consume(
      account,
      user.id,
      10,
      requestId
    );

    expect(first.status).toBe(200);
    expect(first.body.accepted).toBe(true);
    expect(first.body.replayed).toBe(false);

    const retry = await consume(
      account,
      user.id,
      10,
      requestId
    );

    expect(retry.status).toBe(200);
    expect(retry.body.accepted).toBe(true);
    expect(retry.body.replayed).toBe(true);

    const conflict = await consume(
      account,
      user.id,
      11,
      requestId
    );

    expect(conflict.status).toBe(409);

    const usage = await request(
      "GET",
      "/usage/account",
      undefined,
      account.apiKey
    );

    expect(usage.body.account.usage.consumed).toBe("10");

    const history = await request(
      "GET",
      "/history",
      undefined,
      account.apiKey
    );

    expect(history.body.total).toBe(1);
  });

  it("preserves consumption when changing plan limits", async () => {
    const account = await createAccount();
    const user = await createUser(account);

    const planId = await createCustomPlan(
      account,
      "USER",
      20,
      15
    );

    await assignUserPlan(account, user.id, planId);

    const first = await consume(
      account,
      user.id,
      15
    );

    expect(first.body.accepted).toBe(true);

    const overLimit = await consume(
      account,
      user.id,
      10
    );

    expect(overLimit.body.accepted).toBe(false);
    expect(overLimit.body.rejectionRule).toBe(
      "MONTHLY_ALLOWANCE"
    );

    const updated = await request(
      "PATCH",
      `/plans/${planId}`,
      {
        monthlyAllowance: 40,
        maxUnitsPerRequest: 20,
      },
      account.apiKey
    );

    expect(updated.status).toBe(200);

    const afterUpdate = await consume(
      account,
      user.id,
      10
    );

    expect(afterUpdate.body.accepted).toBe(true);

    const usage = await request(
      "GET",
      `/usage/users/${user.id}`,
      undefined,
      account.apiKey
    );

    expect(usage.body.user.usage.consumed).toBe("25");
    expect(usage.body.user.usage.remaining).toBe("15");

    const reduced = await request(
      "PATCH",
      `/plans/${planId}`,
      { monthlyAllowance: 10 },
      account.apiKey
    );

    expect(reduced.status).toBe(200);

    const afterReduction = await request(
      "GET",
      `/usage/users/${user.id}`,
      undefined,
      account.apiKey
    );

    expect(afterReduction.body.user.usage.remaining).toBe(
      "0"
    );

    const rejected = await consume(
      account,
      user.id,
      1
    );

    expect(rejected.body.accepted).toBe(false);
    expect(rejected.body.rejectionScope).toBe("USER");
    expect(rejected.body.rejectionRule).toBe(
      "MONTHLY_ALLOWANCE"
    );
  });

  it("tracks shared account usage independently of users", async () => {
    const account = await createAccount();

    const basic = await createUser(account, "Basic");
    const premium = await createUser(account, "Premium");

    const planId = await createCustomPlan(
      account,
      "ACCOUNT",
      30,
      100
    );

    await assignAccountPlan(account, planId);

    const first = await consume(
      account,
      basic.id,
      10
    );

    const second = await consume(
      account,
      premium.id,
      20
    );

    expect(first.body.accepted).toBe(true);
    expect(second.body.accepted).toBe(true);

    const rejected = await consume(
      account,
      premium.id,
      5
    );

    expect(rejected.body.accepted).toBe(false);
    expect(rejected.body.rejectionScope).toBe("ACCOUNT");
    expect(rejected.body.rejectionRule).toBe(
      "MONTHLY_ALLOWANCE"
    );

    const accountUsage = await request(
      "GET",
      "/usage/account",
      undefined,
      account.apiKey
    );

    const basicUsage = await request(
      "GET",
      `/usage/users/${basic.id}`,
      undefined,
      account.apiKey
    );

    const premiumUsage = await request(
      "GET",
      `/usage/users/${premium.id}`,
      undefined,
      account.apiKey
    );

    expect(accountUsage.body.account.usage.consumed).toBe(
      "30"
    );
    expect(basicUsage.body.user.usage.consumed).toBe("10");
    expect(premiumUsage.body.user.usage.consumed).toBe("20");
  });

  it("returns paginated history and previous month usage", async () => {
    const account = await createAccount();
    const user = await createUser(account);

    for (let i = 0; i < 5; i++) {
      const result = await consume(
        account,
        user.id,
        1
      );

      expect(result.body.accepted).toBe(true);
    }

    const pageOne = await request(
      "GET",
      "/history?page=1&limit=2",
      undefined,
      account.apiKey
    );

    const pageTwo = await request(
      "GET",
      "/history?page=2&limit=2",
      undefined,
      account.apiKey
    );

    expect(pageOne.status).toBe(200);
    expect(pageTwo.status).toBe(200);

    expect(pageOne.body.total).toBe(5);
    expect(pageOne.body.totalPages).toBe(3);
    expect(pageOne.body.requests).toHaveLength(2);
    expect(pageTwo.body.requests).toHaveLength(2);

    const firstIds = pageOne.body.requests.map(
      (item: JsonObject) => item.id
    );

    const secondIds = pageTwo.body.requests.map(
      (item: JsonObject) => item.id
    );

    for (const id of secondIds) {
      expect(firstIds).not.toContain(id);
    }

    const previousMonth = new Date();
    previousMonth.setUTCDate(1);
    previousMonth.setUTCMonth(
      previousMonth.getUTCMonth() - 1
    );

    const month = previousMonth
      .toISOString()
      .slice(0, 7);

    const previousUsage = await request(
      "GET",
      `/usage/account?month=${month}`,
      undefined,
      account.apiKey
    );

    expect(previousUsage.status).toBe(200);
    expect(previousUsage.body.account.usage.consumed).toBe(
      "0"
    );
  });

  it(
    "prevents concurrent requests from exceeding account quota",
    async () => {
      const account = await createAccount();
      const user = await createUser(account);

      const planId = await createCustomPlan(
        account,
        "ACCOUNT",
        100,
        20
      );

      await assignAccountPlan(account, planId);

      const requests = Array.from(
        { length: 20 },
        () => consume(account, user.id, 10)
      );

      const results = await Promise.all(requests);

      const accepted = results.filter(
        (result) => result.body.accepted === true
      );

      const rejected = results.filter(
        (result) => result.body.accepted === false
      );

      expect(results.every(
        (result) => result.status === 200
      )).toBe(true);

      expect(accepted).toHaveLength(10);
      expect(rejected).toHaveLength(10);

      expect(rejected.every(
        (result) =>
          result.body.rejectionScope === "ACCOUNT" &&
          result.body.rejectionRule === "MONTHLY_ALLOWANCE"
      )).toBe(true);

      const usage = await request(
        "GET",
        "/usage/account",
        undefined,
        account.apiKey
      );

      expect(usage.body.account.usage.consumed).toBe("100");
      expect(usage.body.account.usage.remaining).toBe("0");
    },
    30000
  );

});
