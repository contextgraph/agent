# Workspace Performance Benchmarks

**Date:** 2025-11-20T19:00:07.783Z
**Iterations per test:** 5

## Summary

Performance measurements for git operations across different repository sizes.

## Results by Repository

### is (small)

*Simple npm package (~1MB)*

| Operation | Avg Time | Min | Max | Disk Usage |
|-----------|----------|-----|-----|------------|
| clone (cold) | 1.58s | 1.28s | 2.05s | N/A |
| pull (no changes) | 0.74s | 0.57s | 0.98s | 1.97 MB |
| concurrent clone (3x) | 4.78s | 4.64s | 5.21s | N/A |

### lodash (medium)

*Popular utility library (~10-20MB)*

| Operation | Avg Time | Min | Max | Disk Usage |
|-----------|----------|-----|-----|------------|
| clone (cold) | 1.53s | 1.51s | 1.58s | N/A |
| pull (no changes) | 0.95s | 0.64s | 1.07s | 5.20 MB |
| concurrent clone (3x) | 4.99s | 4.66s | 6.24s | N/A |

### typescript (large)

*Large compiler project (~100MB+)*

| Operation | Avg Time | Min | Max | Disk Usage |
|-----------|----------|-----|-----|------------|
| clone (cold) | 15.30s | 13.48s | 20.93s | N/A |
| pull (no changes) | 0.78s | 0.60s | 1.05s | N/A |
| concurrent clone (3x) | 35.36s | 30.15s | 41.68s | N/A |

## Analysis

### Key Findings

**Clone Performance:**
- Small repos: ~1.6s average
- Medium repos: ~1.5s average (1.0x slower)
- Large repos: ~15.3s average (9.7x slower)

**Pull Performance (no changes):**
- is: ~0.74s
- lodash: ~0.95s
- typescript: ~0.78s

**Concurrent Operations:**
- is: ~4.8s for 3 parallel clones
- lodash: ~5.0s for 3 parallel clones
- typescript: ~35.4s for 3 parallel clones

### Recommendations

Based on these measurements:

1. **Temporary workspaces** are suitable when:
   - Repository is small to medium (<50MB)
   - Clone time is acceptable (< 5-10 seconds)
   - Operations are infrequent or one-off

2. **Persistent workspaces** are better when:
   - Repository is large (>50MB)
   - Multiple operations expected on same repo
   - Clone time significantly impacts user experience

3. **Hybrid approach** considerations:
   - Cache recently used repos in persistent storage
   - Use temporary workspaces for first-time or rarely accessed repos
   - Implement TTL-based cleanup for persistent workspaces

## Raw Data

```json
[
  {
    "repo": "is",
    "size": "small",
    "operation": "clone (cold)",
    "iterations": [
      1275.123458,
      1527.96775,
      1495.8627499999998,
      1546.8923750000004,
      2050.355125
    ],
    "average": 1579.2402916,
    "min": 1275.123458,
    "max": 2050.355125
  },
  {
    "repo": "is",
    "size": "small",
    "operation": "pull (no changes)",
    "iterations": [
      975.3781249999993,
      588.6797499999993,
      977.7752919999984,
      568.4208330000001,
      587.8539170000004
    ],
    "average": 739.6215833999995,
    "min": 568.4208330000001,
    "max": 977.7752919999984,
    "diskUsage": 2067256
  },
  {
    "repo": "is",
    "size": "small",
    "operation": "concurrent clone (3x)",
    "iterations": [
      4642.889583,
      4702.603666999999,
      5205.570749999999,
      4709.977375000002,
      4659.1317500000005
    ],
    "average": 4784.034625,
    "min": 4642.889583,
    "max": 5205.570749999999
  },
  {
    "repo": "lodash",
    "size": "medium",
    "operation": "clone (cold)",
    "iterations": [
      1576.9929580000025,
      1539.041290999994,
      1505.2415839999958,
      1537.8705410000039,
      1509.239042000001
    ],
    "average": 1533.6770831999995,
    "min": 1505.2415839999958,
    "max": 1576.9929580000025
  },
  {
    "repo": "lodash",
    "size": "medium",
    "operation": "pull (no changes)",
    "iterations": [
      976.8951669999951,
      1070.2132079999938,
      1030.0176250000004,
      1024.7269579999993,
      636.3093329999974
    ],
    "average": 947.6324581999972,
    "min": 636.3093329999974,
    "max": 1070.2132079999938,
    "diskUsage": 5453271
  },
  {
    "repo": "lodash",
    "size": "medium",
    "operation": "concurrent clone (3x)",
    "iterations": [
      4659.973375000001,
      4686.165790999999,
      4683.035708000003,
      4670.819999999992,
      6236.167707999994
    ],
    "average": 4987.232516399998,
    "min": 4659.973375000001,
    "max": 6236.167707999994
  },
  {
    "repo": "typescript",
    "size": "large",
    "operation": "clone (cold)",
    "iterations": [
      14432.285457999998,
      14101.553165999998,
      13483.418875000003,
      20929.153416999994,
      13568.85954200002
    ],
    "average": 15303.054091600003,
    "min": 13483.418875000003,
    "max": 20929.153416999994
  },
  {
    "repo": "typescript",
    "size": "large",
    "operation": "pull (no changes)",
    "iterations": [
      687.2962920000136,
      602.5833749999874,
      954.0136660000135,
      1053.0767920000071,
      620.8419170000125
    ],
    "average": 783.5624084000068,
    "min": 602.5833749999874,
    "max": 1053.0767920000071,
    "diskUsage": 0
  },
  {
    "repo": "typescript",
    "size": "large",
    "operation": "concurrent clone (3x)",
    "iterations": [
      33862.00899999999,
      41681.32741699999,
      33264.89275,
      30147.997040999995,
      37837.498792
    ],
    "average": 35358.744999999995,
    "min": 30147.997040999995,
    "max": 41681.32741699999
  }
]
```
