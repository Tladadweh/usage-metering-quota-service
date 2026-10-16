
import {
  describe,
  expect,
  it,
} from "vitest";

import { randomUUID } from "node:crypto";

const BASE_URL =
  process.env.TEST_API_URL ?? "http://localhost:3000";

interface ApiResponse {
  status: number;
  body: any;
}

interface Account {
  id: string;
  apiKey: string;
}

interface User {
  id: string;
}

async function api(
  method: string,
  path: string,
  body?: unknown,
  apiKey?: string
): Promise<ApiResponse> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...(apiKey ? { "X-API-Key": apiKey } : {}),
    },
    ...(body !== undefined
      ? { body: JSON.stringify(body) }
      : {}),
    signal: AbortSignal.timeout(30000),
  });

  return {
    status: response.status,
    body: await response.json(),
  };
}

async function getPlan(
  name: string,
  planType: "ACCOUNT" | "USER"
): Promise<string> {
  const response = await api("GET", "/plans");

  expect(response.status).toBe(200);

  const plan = response.body.plans.find(
    (p: any) =>
      p.name === name &&
      p.planType === planType
  );

  expect(plan).toBeDefined();

  return plan.id;
}

async function createAccount(): Promise<Account> {
  const starterId = await getPlan("Starter", "ACCOUNT");

  const response = await api("POST", "/accounts", {
    name: `Reliability-${randomUUID()}`,
    planId: starterId,
  });

  expect(response.status).toBe(201);

  return {
    id: response.body.account.id,
    apiKey: response.body.apiKey,
  };
}

async function createUser(account: Account): Promise<User> {
  const basicId = await getPlan("Basic", "USER");

  const response = await api(
    "POST",
    "/users",
    {
      externalUserId: `user-${randomUUID()}`,
      planId: basicId,
    },
    account.apiKey
  );

  expect(response.status).toBe(201);

  return { id: response.body.user.id };
}

async function customPlan(
  account: Account,
  planType: "ACCOUNT" | "USER",
  monthlyAllowance: number,
  maxUnitsPerRequest: number
): Promise<string> {
  const response = await api(
    "POST",
    "/plans",
    {
      name: `Custom-${randomUUID()}`,
      planType,
      monthlyAllowance,
      maxUnitsPerRequest,
    },
    account.apiKey
  );

  expect(response.status).toBe(201);

  return response.body.plan.id;
}

async function setAccountPlan(
  account: Account,
  planId: string
): Promise<void> {
  const response = await api(
    "PUT",
    "/accounts/plan",
    { planId },
    account.apiKey
  );

  expect(response.status).toBe(200);
}

async function setUserPlan(
  account: Account,
  userId: string,
  planId: string
): Promise<void> {
  const response = await api(
    "PUT",
    `/users/${userId}/plan`,
    { planId },
    account.apiKey
  );

  expect(response.status).toBe(200);
}

async function consume(
  account: Account,
  userId: string,
  units: number,
  requestId = randomUUID()
): Promise<ApiResponse> {
  return api(
    "POST",
    "/consumption",
    { userId, units, requestId },
    account.apiKey
  );
}

async function accountUsage(
  account: Account
): Promise<bigint> {
  const response = await api(
    "GET",
    "/usage/account",
    undefined,
    account.apiKey
  );

  expect(response.status).toBe(200);

  return BigInt(response.body.account.usage.consumed);
}

describe("Reliability and Edge Cases", () => {

  it(
    "consumes only once for 20 concurrent identical requests",
    async () => {
      const account = await createAccount();
      const user = await createUser(account);

      const requestId = randomUUID();

      const responses = await Promise.all(
        Array.from({ length: 20 }, () =>
          consume(account, user.id, 10, requestId)
        )
      );

      expect(responses.every(
        (r) => r.status === 200
      )).toBe(true);

      expect(responses.every(
        (r) => r.body.accepted === true
      )).toBe(true);

      const originals = responses.filter(
        (r) => r.body.replayed === false
      );

      const replays = responses.filter(
        (r) => r.body.replayed === true
      );

      expect(originals).toHaveLength(1);
      expect(replays).toHaveLength(19);

      expect(await accountUsage(account)).toBe(10n);

      const history = await api(
        "GET",
        "/history",
        undefined,
        account.apiKey
      );

      expect(history.body.total).toBe(1);
    },
    60000
  );

  it("replays rejected requests without consuming units", async () => {
    const account = await createAccount();
    const user = await createUser(account);
    const requestId = randomUUID();

    // Basic allows a maximum of 20 per request.
    const first = await consume(
      account,
      user.id,
      25,
      requestId
    );

    expect(first.status).toBe(200);
    expect(first.body.accepted).toBe(false);
    expect(first.body.replayed).toBe(false);
    expect(first.body.rejectionScope).toBe("USER");

    const replay = await consume(
      account,
      user.id,
      25,
      requestId
    );

    expect(replay.status).toBe(200);
    expect(replay.body.accepted).toBe(false);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.rejectionRule).toBe(
      "MAX_PER_REQUEST"
    );

    expect(await accountUsage(account)).toBe(0n);
  });

  it("applies shared custom plan updates to both users", async () => {
    const account = await createAccount();
    const firstUser = await createUser(account);
    const secondUser = await createUser(account);

    const planId = await customPlan(
      account,
      "USER",
      100,
      10
    );

    await setUserPlan(account, firstUser.id, planId);
    await setUserPlan(account, secondUser.id, planId);

    const firstRejection = await consume(
      account,
      firstUser.id,
      25
    );

    const secondRejection = await consume(
      account,
      secondUser.id,
      25
    );

    expect(firstRejection.body.accepted).toBe(false);
    expect(secondRejection.body.accepted).toBe(false);

    const updated = await api(
      "PATCH",
      `/plans/${planId}`,
      { maxUnitsPerRequest: 30 },
      account.apiKey
    );

    expect(updated.status).toBe(200);

    const firstAccepted = await consume(
      account,
      firstUser.id,
      25
    );

    const secondAccepted = await consume(
      account,
      secondUser.id,
      25
    );

    expect(firstAccepted.body.accepted).toBe(true);
    expect(secondAccepted.body.accepted).toBe(true);

    expect(await accountUsage(account)).toBe(50n);
  });

  it(
    "keeps consumption consistent during an account plan update",
    async () => {
      const account = await createAccount();
      const user = await createUser(account);

      const planId = await customPlan(
        account,
        "ACCOUNT",
        100,
        20
      );

      await setAccountPlan(account, planId);

      const requests = Array.from(
        { length: 20 },
        () => consume(account, user.id, 10)
      );

      const planUpdate = api(
        "PATCH",
        `/plans/${planId}`,
        { monthlyAllowance: 30 },
        account.apiKey
      );

      const [results, updated] = await Promise.all([
        Promise.all(requests),
        planUpdate,
      ]);

      expect(updated.status).toBe(200);

      expect(results.every(
        (r) => r.status === 200
      )).toBe(true);

      const accepted = results.filter(
        (r) => r.body.accepted === true
      ).length;

      const consumed = await accountUsage(account);

      // Requests that committed before the limit was
      // reduced remain valid. Usage is never reset.
      expect(consumed).toBe(BigInt(accepted * 10));
      expect(consumed).toBeLessThanOrEqual(100n);

      // After the update, new requests must respect
      // the new monthly allowance of 30.
      const afterUpdate = await consume(
        account,
        user.id,
        10
      );

      if (consumed >= 30n) {
        expect(afterUpdate.body.accepted).toBe(false);
        expect(afterUpdate.body.rejectionScope).toBe(
          "ACCOUNT"
        );
        expect(await accountUsage(account)).toBe(
          consumed
        );
      } else {
        expect(afterUpdate.body.accepted).toBe(true);
        expect(await accountUsage(account)).toBe(
          consumed + 10n
        );
      }
    },
    60000
  );

  it("does not change counters for invalid requests", async () => {
    const account = await createAccount();
    const user = await createUser(account);

    const invalidUnits = [0, -5, 1.5, "10", null];

    for (const units of invalidUnits) {
      const response = await api(
        "POST",
        "/consumption",
        {
          userId: user.id,
          units,
          requestId: randomUUID(),
        },
        account.apiKey
      );

      expect(response.status).toBe(400);
    }

    const invalidUser = await api(
      "POST",
      "/consumption",
      {
        userId: randomUUID(),
        units: 10,
        requestId: randomUUID(),
      },
      account.apiKey
    );

    expect(invalidUser.status).toBe(404);
    expect(await accountUsage(account)).toBe(0n);

    const history = await api(
      "GET",
      "/history",
      undefined,
      account.apiKey
    );

    expect(history.body.total).toBe(0);
  });

  it("rejects invalid months and isolates user history", async () => {
    const firstAccount = await createAccount();
    const secondAccount = await createAccount();
    const user = await createUser(firstAccount);

    const invalidMonth = await api(
      "GET",
      "/usage/account?month=2026-13",
      undefined,
      firstAccount.apiKey
    );

    expect(invalidMonth.status).toBe(400);

    const invalidHistory = await api(
      "GET",
      "/history?page=0&limit=10",
      undefined,
      firstAccount.apiKey
    );

    expect(invalidHistory.status).toBe(400);

    const foreignHistory = await api(
      "GET",
      `/history?userId=${user.id}`,
      undefined,
      secondAccount.apiKey
    );

    expect(foreignHistory.status).toBe(404);

    const foreignUsage = await api(
      "GET",
      `/usage/users/${user.id}`,
      undefined,
      secondAccount.apiKey
    );

    expect(foreignUsage.status).toBe(404);
  });

});
