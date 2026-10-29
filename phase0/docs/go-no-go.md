# Phase 0 go / no-go

Run on footage the model was never trained or tuned on, from phones in the capture guide.

| Measure | Go | Marginal (needs more data) | No-go |
|---|---|---|---|
| Shuttle recall, behind-baseline, 120 fps | >= 90% | 75-90% | < 75% |
| Median landing error | <= 25 cm | 25-50 cm | > 50 cm |
| Points won by the correct side | >= 90% | 80-90% | < 80% |
| Sustained speed on mid-range Android (later, Phase 1) | >= 30 fps at INT8 | 15-30 fps | < 15 fps |

Marginal means plan a data-collection and fine-tuning sprint before Phase 1. No-go means rethink the product, for example score by rally audio and a single tap to confirm.
