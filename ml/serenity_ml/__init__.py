"""Serenity ML worker: repeat-purchase scoring, demand forecasts and basket pairs.

Every model is compared with simple baselines on held-out time windows; the baseline ships
when the model does not beat it. Outputs are predictions, kept apart from ledger figures.
"""

CODE_VERSION = "0.1.0"
