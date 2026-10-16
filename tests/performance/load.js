
import http from "k6/http";
import { check, fail } from "k6";
import { Trend, Rate } from "k6/metrics";
import exec from "k6/execution";

const BASE_URL =
  __ENV.API_URL || "http://api:3000";

const TOTAL_REQUESTS = 500;
const UNITS_PER_REQUEST = 1;

const consumptionLatency = new Trend(
  "consumption_latency",
  true
);

const consumptionErrors = new Rate(
  "consumption_errors"
);

export const options = {
  scenarios: {
    quota_load: {
      executor: "shared-iterations",
      vus: 20,
      iterations: TOTAL_REQUESTS,
      maxDuration: "3m",
    },
  },

  thresholds: {
    checks: ["rate==1"],
    consumption_errors: ["rate==0"],
    consumption_latency: ["p(95)<1000"],
  },
};

function api(
  method,
  path,
  body = null,
  apiKey = null
) {
  const headers = {};

  if (body !== null) {
    headers["Content-Type"] = "application/json";
  }

  if (apiKey !== null) {
    headers["X-API-Key"] = apiKey;
  }

  const response = http.request(
    method,
    `${BASE_URL}${path}`,
    body === null ? null : JSON.stringify(body),
    {
      headers,
      timeout: "30s",
      tags: {
        endpoint: path,
      },
    }
  );

  let data = {};

  try {
    data = response.json();
  } catch (_) {
    // Keep the response status available for diagnostics.
  }

  return {
    status: response.status,
    data,
    duration: response.timings.duration,
    raw: response,
  };
}

function requireSuccess(
  method,
  path,
  body = null,
  apiKey = null
) {
  const result = api(
    method,
    path,
    body,
    apiKey
  );

  if (
    result.status < 200 ||
    result.status >= 300
  ) {
    fail(
      `${method} ${path} failed: ` +
      `${result.status} ${JSON.stringify(result.data)}`
    );
  }

  return result.data;
}

function findPlan(plans, name, type) {
  const plan = plans.find(
    (item) =>
      item.name === name &&
      item.planType === type
  );

  if (!plan) {
    fail(`Required plan not found: ${name}`);
  }

  return plan.id;
}

export function setup() {
  console.log("Preparing performance test account...");

  const plansResponse = requireSuccess(
    "GET",
    "/plans"
  );

  const starterId = findPlan(
    plansResponse.plans,
    "Starter",
    "ACCOUNT"
  );

  const basicId = findPlan(
    plansResponse.plans,
    "Basic",
    "USER"
  );

  const runId =
    `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;

  const accountResponse = requireSuccess(
    "POST",
    "/accounts",
    {
      name: `Performance Test ${runId}`,
      planId: starterId,
    }
  );

  const apiKey = accountResponse.apiKey;

  const userResponse = requireSuccess(
    "POST",
    "/users",
    {
      externalUserId: `load-user-${runId}`,
      planId: basicId,
    },
    apiKey
  );

  const userId = userResponse.user.id;

  // High quotas prevent legitimate quota rejection
  // from being confused with a technical failure.
  const accountPlan = requireSuccess(
    "POST",
    "/plans",
    {
      name: `Load Account ${runId}`,
      planType: "ACCOUNT",
      monthlyAllowance: 100000,
      maxUnitsPerRequest: 100,
    },
    apiKey
  );

  const userPlan = requireSuccess(
    "POST",
    "/plans",
    {
      name: `Load User ${runId}`,
      planType: "USER",
      monthlyAllowance: 100000,
      maxUnitsPerRequest: 100,
    },
    apiKey
  );

  requireSuccess(
    "PUT",
    "/accounts/plan",
    { planId: accountPlan.plan.id },
    apiKey
  );

  requireSuccess(
    "PUT",
    `/users/${userId}/plan`,
    { planId: userPlan.plan.id },
    apiKey
  );

  console.log("Performance test setup completed.");

  return {
    apiKey,
    userId,
    runId,
  };
}

export default function (data) {
  const iteration =
    exec.scenario.iterationInTest;

  const requestId =
    `load-${data.runId}-${iteration}`;

  const response = api(
    "POST",
    "/consumption",
    {
      userId: data.userId,
      units: UNITS_PER_REQUEST,
      requestId,
    },
    data.apiKey
  );

  consumptionLatency.add(response.duration);

  const valid =
    response.status === 200 &&
    response.data.accepted === true &&
    response.data.replayed === false &&
    response.data.requestId === requestId;

  check(response.raw, {
    "consumption accepted successfully": () => valid,
  });

  consumptionErrors.add(!valid);
}


export function teardown(data) {
  console.log("Checking persisted account and user usage...");

  const account = requireSuccess(
    "GET",
    "/usage/account",
    null,
    data.apiKey
  );

  const user = requireSuccess(
    "GET",
    `/usage/users/${data.userId}`,
    null,
    data.apiKey
  );

  const accountConsumed = Number(
    account.account.usage.consumed
  );

  const userConsumed = Number(
    user.user.usage.consumed
  );

  const expected =
    TOTAL_REQUESTS * UNITS_PER_REQUEST;

  console.log(`Expected usage: ${expected}`);
  console.log(`Account consumed: ${accountConsumed}`);
  console.log(`User consumed: ${userConsumed}`);

  if (
    accountConsumed !== expected ||
    userConsumed !== expected
  ) {
    fail(
      "PERFORMANCE TEST FAILED: " +
      "Persisted usage does not match expected usage."
    );
  }

  console.log(
    "PASS: All expected units were recorded correctly."
  );
}

