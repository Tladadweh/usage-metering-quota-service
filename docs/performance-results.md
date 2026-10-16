
# Performance Test Results

## Project

Usage Metering and Quota Service

## Test Date

2026-10-17 (local time)

## Objective

Evaluate the latency, throughput, and correctness of the consumption API under concurrent requests.

The test checks that all successful requests are recorded exactly once at both the account and user levels.

## Test Environment

- Local Windows development machine
- Docker Desktop
- TypeScript / Express backend
- PostgreSQL 16
- Grafana k6 executed inside Docker
- Backend and database communicating through Docker Compose networking

Hardware specifications and allocated Docker resources were not recorded.

## Test Configuration

| Parameter | Value |
|-----------|-------|
| Tool | Grafana k6 |
| Scenario | shared-iterations |
| Virtual Users | 20 |
| Consumption Iterations | 500 |
| Units Per Request | 1 |
| Maximum Test Duration | 3 minutes |
| Endpoint | POST /consumption |
| Account Monthly Quota | 100,000 |
| User Monthly Quota | 100,000 |

A dedicated account and user were created for the test.

Large quota limits ensured that valid quota rejections would not be confused with technical failures.

## Observed Results

### Consumption Requests

| Metric | Result |
|--------|--------|
| Total consumption requests | 500 |
| Successful checks | 500 |
| Failed checks | 0 |
| Consumption error rate | 0.00% |
| Interrupted iterations | 0 |
| Throughput | 194.12 iterations/sec |

### Consumption Latency

| Metric | Result |
|--------|--------|
| Average | 98.84 ms |
| Minimum | 33.95 ms |
| Median | 94.86 ms |
| Maximum | 213.79 ms |
| p90 | 114.85 ms |
| p95 | 136.15 ms |

### Overall HTTP Metrics

| Metric | Result |
|--------|--------|
| Total HTTP requests | 509 |
| HTTP request failure rate | 0.00% |
| Average HTTP duration | 97.19 ms |
| p95 HTTP duration | 135.62 ms |
| HTTP throughput | 197.62 requests/sec |

The total HTTP request count includes setup, consumption, and final verification requests.

## Threshold Evaluation

| Threshold | Actual | Result |
|-----------|--------|--------|
| checks rate == 100% | 100.00% | PASS |
| consumption errors == 0% | 0.00% | PASS |
| consumption p95 < 1000 ms | 136.15 ms | PASS |

The 1000 ms p95 threshold is a project-defined testing target, not an externally specified Foothill acceptance criterion.

## Database Correctness Verification

The test queried account and user usage after all consumption iterations.

Observed results:

| Counter | Expected | Actual |
|---------|----------|--------|
| Account consumption | 500 | 500 |
| User consumption | 500 | 500 |

The test reported:

PASS: All expected units were recorded correctly.

No missing units or quota inconsistencies were observed in this run.

## Interpretation

The service successfully processed all 500 consumption requests with 20 virtual users in this test.

No application-level consumption errors were observed.

Account and user counters matched the expected total exactly.

The measured consumption p95 latency was below the project's defined 1000 ms target.

## Limitations

These results represent one local test run.

They do not establish:

- Maximum sustainable production throughput.
- Performance at hundreds or thousands of virtual users.
- Performance across distributed API instances.
- Long-duration stability.
- Performance under database hardware saturation.
- Behavior during infrastructure failures.
- Production capacity requirements.

The design serializes operations on the same account using PostgreSQL row-level locking. This may become a throughput bottleneck under heavier single-account workloads.

## Reproduction

Start the application:

```bash
docker compose up -d
```

Run the load test:

```bash
docker compose -f compose.yaml -f compose.perf.yaml run --rm k6
```

Review:

- consumption_errors
- consumption_latency
- checks
- http_req_duration
- http_reqs
- persisted account and user usage

Each run creates a new test account and does not reuse consumption counters from earlier runs.

## Conclusion

The tested workload completed successfully, with 500 accepted consumption requests, zero observed failures, and correct persistent usage totals.

Further load profiles and production-like environments would be required for capacity planning.
