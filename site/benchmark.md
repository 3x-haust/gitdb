| Scenario | Previous writes/s | Current writes/s | Change | Write ms change | Join ms change |
| --- | ---: | ---: | ---: | ---: | ---: |
| local plaintext throttled visible snapshots | 173.14 | 2562.73 | +1380.15% | +93.24% | +90.04% |
| local encrypted mutation log | 328.09 | 2571.34 | +683.73% | +87.24% | +79.91% |
| postgres facade over local encrypted | 253.05 | 1683.91 | +565.45% | +84.97% | +88.30% |
